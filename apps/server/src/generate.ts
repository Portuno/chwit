import path from 'node:path';
import {
  alertEventSchema,
  applyLayerPatch,
  chunkWindow,
  clampLayer,
  createLayer,
  cuesFromSegments,
  generationWindows,
  layerSchema,
  mergeGeneratedMessages,
  normalizeSubtitleCues,
  placeGenerated,
  round3,
  targetMessageCount,
  LAYER_ANIMATIONS,
  type AlertEvent,
  type ChatData,
  type Layer,
  type LayerPatch,
  type LayerType,
  type LutData,
  type Project,
} from '@chiwt/schema';
import { asHttp, HttpError } from './http.js';
import { extractAudio, extractFrames, readFrameManifest, writeFrameManifest, type FrameShot } from './media.js';
import { completeJson, imagePart, transcribeAudio } from './nan.js';
import type { ProjectStore } from './store.js';
import { playbackPath } from './videos.js';

const busy = new Set<string>();

async function exclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(projectId)) throw new HttpError(409, 'Ya hay una generación en curso para este proyecto.');
  busy.add(projectId);
  try {
    return await fn();
  } finally {
    busy.delete(projectId);
  }
}

const CHAT_SYSTEM = [
  'Generás el chat de un livestream que está mirando este video en el momento, sin saber lo que viene.',
  'Respondé únicamente con un objeto JSON de la forma {"messages":[{"t":0,"username":"ana_luz","text":"se le cayó el vaso","color":"#60a5fa"}]}',
  'Cada mensaje reacciona a una frase que YA terminó de decirse, o a algo que ya se ve en el fotograma. Nunca anuncies, adivines ni comentes un nombre, una cifra o un tema antes de que aparezca en la frase indicada.',
  'El público es cálido y curioso: se engancha, acompaña, pregunta o marca un detalle. Puede haber un desacuerdo respetuoso.',
  'Prohibido el tono burlón, la cargada, el sarcasmo cruel, el insulto y tratar de tontos a los que hablan. No hagas que todos se rían de la escena.',
  'Prohibido el saludo genérico, el "buen video", el "qué episodio" y repetir la misma reacción.',
  'text en el idioma del diálogo, como chat de verdad, entre 4 y 14 palabras.',
  'username parece una persona, minúsculas y guiones bajos, sin espacios. Colores hex bien distintos y claros sobre fondo oscuro.',
  'No narres en tercera persona. No repitas los mensajes bloqueados.',
  't va dentro del rango pedido, nunca antes de que termine la frase que comentan.',
].join(' ');

export async function generateChat(
  store: ProjectStore,
  projectId: string,
  layerId: string,
  options: { sectorId?: string; instruction?: string },
): Promise<{ project: Project; message: string }> {
  return exclusive(projectId, async () => {
    let project = await store.read(projectId);
    const layer = requireChat(project, layerId);
    if (!project.video || project.duration <= 0) throw new HttpError(400, 'Cargá un video antes de generar el chat.');
    project = await ensureTranscript(store, project, false);
    const frames = await ensureFrames(store, project);
    const chat = withInstruction(layer.chat!, options.sectorId, options.instruction);
    const windows = windowsOrThrow(project.duration, chat, options.sectorId);
    let produced = 0;

    let saved = project;
    for (const window of windows) {
      const locked = layer.chat!.messages.filter((message) => message.locked && message.t >= window.start - 0.001 && message.t <= window.end + 0.001);
      const slots = Math.max(0, targetMessageCount(window.ratePerMinute, window.start, window.end) - locked.length);
      const drafts: ReturnType<typeof placeGenerated> = [];
      const lockedLines = locked.map((message) => `${formatTime(message.t)} ${message.username}: ${message.text}`);
      const lockedTimes = locked.map((message) => message.t);
      if (slots > 0) {
        for (const span of reactionPlan(project.transcript?.cues ?? [], window, slots)) {
          const spanDrafts = [];
          for (const chunk of chunkWindow(span, span.count, 8)) {
            let batch = await requestMessages(store, project, frames, chunk, lockedLines, span);
            if (batch.length < chunk.count) {
              const extra = await requestMessages(store, project, frames, { ...chunk, count: chunk.count - batch.length }, lockedLines, span);
              batch = [...batch, ...extra];
            }
            spanDrafts.push(...batch);
            produced += batch.length;
          }
          drafts.push(...placeGenerated(spanDrafts, span.start, span.end, lockedTimes, window.sectorId));
        }
      }
      const placed = drafts;
      saved = await store.update(projectId, (draft) => {
        const target = draft.layers.find((item) => item.id === layerId);
        if (!target?.chat) throw new HttpError(404, 'No existe ese chat.');
        rememberInstruction(target.chat, options.sectorId, options.instruction);
        target.chat.messages = mergeGeneratedMessages(target.chat.messages, placed, window.start, window.end);
      });
    }
    return { project: saved, message: produced > 0 ? `Chat generado: ${produced} mensajes nuevos.` : 'No había huecos libres para mensajes nuevos.' };
  });
}

export async function transcribeProject(store: ProjectStore, projectId: string, force: boolean): Promise<{ project: Project; message: string }> {
  return exclusive(projectId, async () => {
    const current = await store.read(projectId);
    if (!current.video) throw new HttpError(400, 'Cargá un video antes de transcribir.');
    const project = await ensureTranscript(store, current, force);
    const cues = normalizeSubtitleCues(project.transcript?.cues ?? []);
    const saved = await store.update(projectId, (draft) => {
      let layer = draft.layers.find((item) => item.type === 'subtitle');
      if (!layer) {
        if (draft.layers.length >= 24) throw new HttpError(400, 'Máximo de 24 capas.');
        layer = createLayer('subtitle', { name: 'Subtítulos' });
        draft.layers.push(layer);
      }
      if (!layer.subtitle) return;
      layer.subtitle = { ...layer.subtitle, cues };
    });
    return { project: saved, message: cues.length ? `${cues.length} subtítulos listos.` : 'No se detectó diálogo.' };
  });
}

export async function generateAlerts(
  store: ProjectStore,
  projectId: string,
  layerId: string,
  options: { count?: number; instruction?: string },
): Promise<{ project: Project; message: string }> {
  return exclusive(projectId, async () => {
    let project = await store.read(projectId);
    const layer = project.layers.find((item) => item.id === layerId);
    if (!layer?.alerts) throw new HttpError(400, 'Esa capa no es de alertas.');
    if (!project.video || project.duration <= 0) throw new HttpError(400, 'Cargá un video antes de generar alertas.');
    project = await ensureTranscript(store, project, false);
    const count = Math.min(30, Math.max(1, options.count ?? 6));
    const json = await completeJson(
      'Programás alertas de un livestream (subs, donaciones, follows) sincronizadas con un video. Respondé solo JSON {"events":[{"t":1.2,"duration":4,"kind":"donation","name":"Ana","amount":5,"message":"vamos"}]}. kind es sub, donation o follow. Los tiempos cubren todo el video. No repitas eventos existentes.',
      `Duración ${round3(project.duration)}s. Cantidad: ${count}. Instrucción: ${options.instruction?.trim() || 'reacciones de un livestream de cine'}.\nDiálogo:\n${cueText(project, 0, project.duration)}\nYa programados:\n${layer.alerts.map((event) => `${event.t}s ${event.kind} ${event.name}`).join('\n') || '(ninguno)'}`,
    );
    const events = readEvents(json).slice(0, count);
    if (!events.length) throw new HttpError(502, 'NaN no devolvió alertas usables.');
    const saved = await store.update(projectId, (draft) => {
      const target = draft.layers.find((item) => item.id === layerId);
      if (!target?.alerts) throw new HttpError(404, 'No existe esa capa de alertas.');
      target.alerts = [...target.alerts, ...events].sort((a, b) => a.t - b.t).slice(0, 500);
    });
    return { project: saved, message: `${events.length} alertas sumadas.` };
  });
}

const VIBE_SYSTEM = [
  'Sos el asistente de Chiwt, en un chat al lado del video. El usuario te pide cambios visuales y vos los hacés.',
  'Respondé únicamente con JSON {"reply":"","layers":[],"updates":[]}.',
  'reply es una frase corta en español, dicha al usuario, contando qué cambiaste. Siempre va.',
  'Si el mensaje es charla y no pide un cambio, reply y dejá layers y updates vacíos.',
  'type puede ser chat, badge, alert, lower-third, watermark, qr, lut o subtitle. watermark es un logo.',
  'position {x,y} y size {width,height} son porcentajes del cuadro, de 0 a 100.',
  'No inventes el texto del chat: para chat solo name, defaultRatePerMinute e instruction.',
  'Para cambiar espectadores de un badge que ya existe, updates con layerId y viewerCount. No crees otro badge.',
  'Para cambiar colores de una capa que ya existe, updates con layerId, fill y textColor. fill es el color que más se ve. textColor es el texto o el detalle. Los dos van en #rrggbb.',
  'layerId puede ser el id de la lista, el nombre de la capa, o "live" para el badge.',
  'La paleta del logo de Chiwt es celeste #00d0f8 y negro #041018.',
  'Si piden la estética del logo en el live y que predomine el celeste sobre el negro, el badge que ya existe queda fill #00d0f8 y textColor #041018. No des vuelta el logo, no lo rotes y no crees otro badge.',
  'Si el usuario dice hacelo, ya te dije o que no se aplicó, el pedido está en la conversación reciente.',
  'Nunca digas en reply que cambiaste algo si updates quedó vacío.',
  'updates también acepta position, size, opacity y assetId si la capa es un logo.',
  'badge nuevo usa mode live|rec|viewers y viewerCount.',
  'alert puede traer events [{t,duration,kind,name,amount,message}] con kind sub|donation|follow.',
  'lower-third usa title y subtitle. lut usa preset sepia|contrast|vintage|noir|cyberpunk e intensity.',
  'qr usa target. timeRange es {start,end} en segundos del video, o null si se ve siempre.',
  'animation puede ser none, blink, pulse, fade-in, slide-in o spin. spin rota el logo. rotate es un ángulo fijo en grados.',
  'El logo usa assetId de una imagen ya incorporada. No inventes ids.',
  'Si el pedido habla de un logo que ya está, actualizalo. Un sponsor nuevo puede ser otra capa watermark.',
  'Máximo 6 capas nuevas.',
].join(' ');

export type PromptTurn = { role: 'user' | 'agent'; text: string };

export async function applyPrompt(store: ProjectStore, projectId: string, prompt: string, history: PromptTurn[] = []): Promise<{ project: Project; message: string }> {
  return exclusive(projectId, async () => {
    const project = await store.read(projectId);
    const turns = history
      .filter((turn) => turn.text.trim())
      .slice(-8)
      .map((turn) => `${turn.role === 'user' ? 'Usuario' : 'Chiwt'}: ${turn.text.trim().slice(0, 400)}`)
      .join('\n');
    const json = await completeJson(VIBE_SYSTEM, `${projectBrief(project)}\n${turns ? `Conversación reciente:\n${turns}\n` : ''}Pedido: ${prompt}`);
    const body = json as { reply?: unknown; layers?: unknown; updates?: unknown };
    const reply = typeof body.reply === 'string' ? body.reply.trim().slice(0, 500) : '';
    const rawLayers = Array.isArray(body.layers) ? body.layers : [];
    const rawUpdates = Array.isArray(body.updates) ? body.updates : [];
    const layers = rawLayers.map((raw) => mapVibeLayer(raw, project)).filter((item): item is MappedLayer => item != null).slice(0, 6);
    const intent = liveColorIntent(prompt, turns);
    const keepStill = /no des vuelta|no lo des vuelta|no gires|no rotes/.test(`${turns}\n${prompt}`.toLowerCase());
    if (!layers.length && !rawUpdates.length && !intent) {
      return { project, message: reply || 'Decime qué querés cambiar del vivo.' };
    }
    let added = 0;
    let updated = 0;
    let painted = false;
    const saved = await store.update(projectId, (draft) => {
      for (const raw of rawUpdates) {
        if (applyVibeUpdate(draft, raw, keepStill)) updated += 1;
      }
      for (const item of layers) {
        if (absorbLogo(draft, item)) {
          updated += 1;
          continue;
        }
        if (absorbBadge(draft, item)) {
          updated += 1;
          continue;
        }
        if (draft.layers.length >= 24) throw new HttpError(400, 'Máximo de 24 capas.');
        if (item.layer.watermark && !item.layer.watermark.assetId) {
          const only = soleImage(draft);
          if (only) item.layer.watermark.assetId = only;
        }
        draft.layers.push(item.layer);
        added += 1;
      }
      if (intent && paintLive(draft, intent)) painted = true;
      if (!added && !updated && !painted) throw new HttpError(502, 'NaN no devolvió capas usables.');
    });
    const dodged = /no entend|no pude|quedo atento|qu[eé] cambio|decime concretamente/i.test(reply);
    const parts = [added ? `Se agregaron ${added} capas.` : '', updated || painted ? 'Listo, ya quedó en el video.' : ''].filter(Boolean);
    const message = painted && (dodged || !reply)
      ? 'El vivo quedó celeste, con el negro en el texto.'
      : (reply || parts.join(' '));
    return { project: saved, message };
  });
}

function projectBrief(project: Project): string {
  const assets = Object.entries(project.assets)
    .map(([id, asset]) => `${id} | ${asset.kind} | ${asset.name}`)
    .join('\n') || '(ninguno)';
  const layers = project.layers
    .map((layer) => `${layer.id} | ${layer.type} | ${layer.name} | ${layer.timeRange ? `${layer.timeRange.start}-${layer.timeRange.end}s` : 'siempre'} | asset=${layer.watermark?.assetId ?? ''} | viewers=${layer.badge?.viewerCount ?? ''} | fill=${layer.background.colorA} | text=${layer.background.colorB}`)
    .join('\n') || '(ninguna)';
  return `Duración del video: ${round3(project.duration)}s.\nIncorporados:\n${assets}\nCapas:\n${layers}`;
}

export function applyLivestream(project: Project, options: { lut?: LutData['preset']; ratePerMinute?: number; instruction?: string }): void {
  if (!project.layers.some((layer) => layer.type === 'lut')) {
    project.layers.push(createLayer('lut', { lutPreset: options.lut ?? 'cyberpunk' }));
  } else if (options.lut) {
    const lut = project.layers.find((layer) => layer.lut);
    if (lut?.lut) lut.lut = { ...lut.lut, preset: options.lut };
  }
  if (!project.layers.some((layer) => layer.type === 'live-badge')) project.layers.push(createLayer('live-badge'));
  const chat = project.layers.find((layer) => layer.chat);
  if (!chat) project.layers.push(createLayer('chat', { ratePerMinute: options.ratePerMinute, instruction: options.instruction }));
  else if (chat.chat) {
    if (options.ratePerMinute) chat.chat.defaultRatePerMinute = options.ratePerMinute;
    if (options.instruction != null) chat.chat.instruction = options.instruction;
  }
  if (!project.layers.some((layer) => layer.type === 'alert')) project.layers.push(createLayer('alert'));
  if (project.layers.length > 24) throw new HttpError(400, 'Máximo de 24 capas.');
}

async function ensureTranscript(store: ProjectStore, project: Project, force: boolean): Promise<Project> {
  if (project.transcript && !force) return project;
  const video = playbackPath(store, project);
  const audioPath = path.join(store.dir(project.id), 'audio.mp3');
  const hasAudio = await extractAudio(video, audioPath);
  const segments = hasAudio ? await transcribeAudio(audioPath) : [];
  const cues = cuesFromSegments(segments)
    .map((cue) => ({ text: cue.text.slice(0, 500), start: round3(cue.start), end: round3(Math.max(cue.end, cue.start + 0.2)) }))
    .filter((cue) => cue.text && cue.end > cue.start)
    .slice(0, 4000);
  return store.update(project.id, (draft) => {
    draft.transcript = { updatedAt: new Date().toISOString(), cues };
  });
}

async function ensureFrames(store: ProjectStore, project: Project): Promise<FrameShot[]> {
  const dir = path.join(store.dir(project.id), 'frames');
  const manifestPath = path.join(dir, 'manifest.json');
  const cached = await readFrameManifest(manifestPath);
  if (cached?.videoToken === project.videoToken && cached.frames.length) return cached.frames;
  const frames = await extractFrames(playbackPath(store, project), dir, project.duration);
  await writeFrameManifest(manifestPath, { videoToken: project.videoToken, frames });
  return frames;
}

async function requestMessages(
  store: ProjectStore,
  project: Project,
  frames: FrameShot[],
  chunk: { start: number; end: number; count: number; instruction: string },
  lockedLines: string[],
  focus?: { line: string; saidAt: number; prior: string },
) {
  const seenUntil = focus?.line ? focus.saidAt : chunk.end;
  const chosen = pickFrames(frames, seenUntil - 4, seenUntil).slice(-3);
  const about = focus?.line
    ? [
      `La frase acaba de terminar en ${round3(focus.saidAt)}s: "${focus.line}"`,
      'Reaccioná solo a esa frase o a lo que ya se ve. No adelantes el tema siguiente ni nombres a nadie que esa frase no haya nombrado.',
      focus.prior ? `Esto ya se dijo antes, no lo presentes como novedad:\n${focus.prior}` : '',
    ].filter(Boolean)
    : [
      'No hay una frase nueva. Comentá solo lo que ya se ve, sin inventar el tema de la charla.',
      `Diálogo ya dicho:\n${cueText(project, Math.max(0, chunk.start - 12), seenUntil)}`,
    ];
  const content: ({ type: 'text'; text: string } | Awaited<ReturnType<typeof imagePart>>)[] = [{
    type: 'text',
    text: [
      `Los mensajes se publican entre ${round3(chunk.start)}s y ${round3(chunk.end)}s, cuando esa frase ya se escuchó.`,
      `Generá exactamente ${chunk.count} mensajes.`,
      `Instrucción: ${chunk.instruction.trim() || 'público cálido, curioso, sin burla'}`,
      ...about,
      `Mensajes bloqueados, no los repitas:\n${lockedLines.join('\n') || '(ninguno)'}`,
    ].join('\n'),
  }];
  for (const frame of chosen) {
    content.push({ type: 'text', text: `Fotograma en t=${frame.t}s, ya visto` });
    content.push(await imagePart(path.join(store.dir(project.id), 'frames', frame.file)));
  }
  const json = await completeJson(CHAT_SYSTEM, content);
  const messages = (json as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) throw new HttpError(502, 'NaN no devolvió mensajes.');
  return messages as { t?: number; username?: string; text?: string; color?: string }[];
}

function reactionPlan(
  cues: { start: number; end: number; text: string }[],
  window: { start: number; end: number; ratePerMinute: number; instruction: string; sectorId: string | null },
  slots: number,
) {
  const mine = cues.filter((cue) => cue.end > window.start + 0.02 && cue.end <= window.end + 0.02);
  const base = { ratePerMinute: window.ratePerMinute, instruction: window.instruction, sectorId: window.sectorId };
  if (!mine.length) {
    return [{ ...base, start: window.start, end: window.end, count: slots, line: '', saidAt: window.start, prior: '' }];
  }
  const spans = mine.map((cue, index) => {
    const start = Math.min(window.end, Math.max(window.start, cue.end));
    const next = mine[index + 1]?.end ?? window.end;
    const end = Math.min(window.end, Math.max(start + 0.35, next));
    const prior = cues
      .filter((item) => item.end <= cue.start + 0.05 && item.end > cue.start - 18)
      .slice(-2)
      .map((item) => `${item.end.toFixed(1)}s ${item.text}`)
      .join('\n');
    return { ...base, start, end, line: cue.text, saidAt: cue.end, prior };
  });
  const weight = spans.map((span) => Math.max(0.35, span.end - span.start));
  const sum = weight.reduce((total, item) => total + item, 0);
  let left = slots;
  return spans.flatMap((span, index) => {
    const count = index === spans.length - 1 ? left : Math.min(left, Math.max(0, Math.round(slots * weight[index]! / sum)));
    left -= count;
    return count > 0 ? [{ ...span, count }] : [];
  });
}

function pickFrames(frames: FrameShot[], start: number, end: number): FrameShot[] {
  const inside = frames.filter((frame) => frame.t >= start - 0.4 && frame.t <= end + 0.4);
  if (inside.length) return inside;
  return [...frames].sort((a, b) => Math.abs(a.t - (start + end) / 2) - Math.abs(b.t - (start + end) / 2)).slice(0, 3);
}

function cueText(project: Project, start: number, end: number): string {
  const lines = (project.transcript?.cues ?? [])
    .filter((cue) => cue.end >= start && cue.start <= end)
    .map((cue) => `[${cue.start.toFixed(1)}-${cue.end.toFixed(1)}] ${cue.text}`);
  return lines.join('\n') || '(sin diálogo en este tramo)';
}

function withInstruction(chat: ChatData, sectorId: string | undefined, instruction: string | undefined): ChatData {
  const next = structuredClone(chat);
  rememberInstruction(next, sectorId, instruction);
  return next;
}

function rememberInstruction(chat: ChatData, sectorId: string | undefined, instruction: string | undefined): void {
  const text = instruction?.trim();
  if (!text) return;
  if (!sectorId) {
    chat.instruction = text;
    return;
  }
  const sector = chat.sectors.find((item) => item.id === sectorId);
  if (!sector) throw new HttpError(404, 'No existe ese sector.');
  sector.instruction = text;
}

function windowsOrThrow(duration: number, chat: ChatData, sectorId?: string) {
  try {
    return generationWindows(duration, chat, sectorId);
  } catch (error) {
    asHttp(error);
  }
}

function requireChat(project: Project, layerId: string): Layer {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer?.chat) throw new HttpError(404, 'No existe ese chat.');
  return layer;
}

function readEvents(json: unknown): AlertEvent[] {
  const raw = (json as { events?: unknown }).events;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => toAlert(item, index)).filter((event): event is AlertEvent => event != null);
}

function toAlert(raw: unknown, index: number): AlertEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const kind = item.kind === 'sub' || item.kind === 'follow' || item.kind === 'donation' ? item.kind : 'donation';
  const amount = Number(item.amount);
  const parsed = alertEventSchema.safeParse({
    id: crypto.randomUUID(),
    t: finite(item.t, index * 4),
    duration: finite(item.duration, 4),
    kind,
    name: String(item.name ?? 'viewer').trim().slice(0, 60) || 'viewer',
    amount: Number.isFinite(amount) ? amount : null,
    message: item.message == null ? null : String(item.message).slice(0, 200),
  });
  return parsed.success ? parsed.data : null;
}

const TYPE_MAP: Record<string, LayerType> = {
  chat: 'chat',
  badge: 'live-badge',
  'live-badge': 'live-badge',
  alert: 'alert',
  'lower-third': 'lower-third',
  lowerthird: 'lower-third',
  watermark: 'watermark',
  logo: 'watermark',
  qr: 'qr',
  lut: 'lut',
  subtitle: 'subtitle',
};

const PRESETS = new Set<LutData['preset']>(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk']);
const ANIMATIONS = new Set<string>(LAYER_ANIMATIONS);

type MappedLayer = { layer: Layer; touch: Set<string> };

function soleImage(project: Project): string | null {
  const images = Object.entries(project.assets).filter(([, asset]) => asset.kind === 'image');
  return images.length === 1 ? images[0][0] : null;
}

function resolveImageId(project: Project, raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  if (project.assets[text]?.kind === 'image') return text;
  const byName = Object.entries(project.assets).find(([, asset]) => asset.kind === 'image' && asset.name.toLowerCase() === text.toLowerCase());
  return byName?.[0] ?? null;
}

function absorbLogo(draft: Project, item: MappedLayer): boolean {
  if (item.layer.type !== 'watermark') return false;
  const existing = draft.layers.find((layer) => layer.type === 'watermark');
  if (!existing?.watermark) return false;
  if (item.touch.has('timeRange')) existing.timeRange = item.layer.timeRange;
  if (item.touch.has('animation')) existing.animation = item.layer.animation;
  if (item.touch.has('rotate')) existing.transform = { ...existing.transform, rotate: item.layer.transform.rotate };
  if (item.layer.watermark?.assetId) existing.watermark = { assetId: item.layer.watermark.assetId };
  else if (!existing.watermark.assetId) {
    const only = soleImage(draft);
    if (only) existing.watermark = { assetId: only };
  }
  return true;
}

function absorbBadge(draft: Project, item: MappedLayer): boolean {
  if (item.layer.type !== 'live-badge') return false;
  const existing = draft.layers.find((layer) => layer.type === 'live-badge');
  if (!existing?.badge || !item.layer.badge) return false;
  existing.badge = { ...existing.badge, mode: item.layer.badge.mode, viewerCount: item.layer.badge.viewerCount };
  if (item.touch.has('colors')) existing.background = item.layer.background;
  return true;
}

const LIVE_FILL = '#00d0f8';
const LIVE_INK = '#041018';

const NAMED_COLORS: { pattern: RegExp; hex: string }[] = [
  { pattern: /celeste|cyan|cian/, hex: LIVE_FILL },
  { pattern: /negro|black/, hex: LIVE_INK },
  { pattern: /blanco|white/, hex: '#ffffff' },
  { pattern: /rojo|red/, hex: '#e11d48' },
  { pattern: /verde|green/, hex: '#22c55e' },
  { pattern: /amarillo|yellow/, hex: '#facc15' },
  { pattern: /azul|blue/, hex: '#2563eb' },
];

function readColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const named = NAMED_COLORS.find((entry) => entry.pattern.test(text) && text.length < 24);
  if (named && !text.includes('#')) return named.hex;
  const hex = text.startsWith('#') ? text : `#${text}`;
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function mentionsLive(text: string): boolean {
  return /live|badge|en vivo|\bvivo\b/.test(text);
}

function paletteIntent(text: string): { fill: string; ink: string } | null {
  if (!mentionsLive(text)) return null;
  const inverted = /estét|estet|invert/.test(text) && /logo/.test(text);
  const cyanOverBlack = /celeste|cian|cyan/.test(text) && /negro|logo|estét|estet|predom|invert|color/.test(text);
  if (!inverted && !cyanOverBlack) return null;
  if (/predomi\w* el negro/.test(text)) return { fill: LIVE_INK, ink: LIVE_FILL };
  return { fill: LIVE_FILL, ink: LIVE_INK };
}

function isFollowUp(prompt: string): boolean {
  const text = prompt.trim().toLowerCase().replace(/[.!]+$/g, '');
  if (text.length > 80) return false;
  return /^(hacelo|hazlo|dale|aplicalo|hacé eso|hace eso|eso|eso mismo)$/.test(text) || /no lo hiciste|ya te dije/.test(text);
}

function liveColorIntent(prompt: string, history: string): { fill: string; ink: string } | null {
  const current = prompt.toLowerCase();
  const direct = paletteIntent(current);
  if (direct) return direct;
  if (!isFollowUp(current)) return null;
  return paletteIntent(`${history}\n${current}`);
}

function paintLive(draft: Project, intent: { fill: string; ink: string }): boolean {
  const badge = draft.layers.find((layer) => layer.type === 'live-badge');
  if (!badge) return false;
  const same = badge.background.colorA.toLowerCase() === intent.fill && badge.background.colorB.toLowerCase() === intent.ink;
  if (!same) {
    Object.assign(badge, applyLayerPatch(badge, {
      background: { type: 'solid', colorA: intent.fill, colorB: intent.ink, angle: badge.background.angle },
    }));
  }
  return true;
}

function findSpokenLayer(draft: Project, item: Record<string, unknown>): Layer | undefined {
  const hints = [item.layerId, item.id, item.name, item.target, item.type]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  for (const hint of hints) {
    const byId = draft.layers.find((layer) => layer.id === hint);
    if (byId) return byId;
    const key = hint.trim().toLowerCase();
    const byName = draft.layers.find((layer) => layer.name.toLowerCase() === key);
    if (byName) return byName;
    if (['live', 'badge', 'live-badge', 'en vivo', 'vivo', 'live badge'].includes(key)) {
      return draft.layers.find((layer) => layer.type === 'live-badge');
    }
  }
  return undefined;
}

function applyVibeUpdate(draft: Project, raw: unknown, keepLogoStill = false): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const item = raw as Record<string, unknown>;
  const layer = findSpokenLayer(draft, item);
  if (!layer) return false;
  const patch: LayerPatch = {};
  const range = readRange(item.timeRange);
  if (item.timeRange === null) patch.timeRange = null;
  else if (range) patch.timeRange = range;
  const skipMotion = keepLogoStill && layer.type === 'watermark';
  if (!skipMotion && typeof item.animation === 'string' && ANIMATIONS.has(item.animation)) patch.animation = item.animation as Layer['animation'];
  if (!skipMotion && item.spin === true) patch.animation = 'spin';
  const rotate = finiteOptional(item.rotate);
  if (!skipMotion && rotate != null) patch.transform = { ...layer.transform, rotate: Math.min(180, Math.max(-180, rotate)) };
  const assetId = resolveImageId(draft, item.assetId);
  if (assetId && layer.watermark) patch.watermarkAssetId = assetId;
  const viewers = finiteOptional(item.viewerCount);
  if (viewers != null && layer.badge) {
    patch.badge = {
      mode: layer.badge.mode,
      viewerCount: Math.min(10_000_000, Math.max(0, Math.round(viewers))),
      beats: layer.badge.beats,
    };
  }
  const fill = readColor(item.fill ?? item.color ?? item.colorA);
  const ink = readColor(item.textColor ?? item.ink ?? item.colorB);
  if (fill || ink) {
    patch.background = {
      type: 'solid',
      colorA: fill ?? (readColor(layer.background.colorA) ?? LIVE_FILL),
      colorB: ink ?? (readColor(layer.background.colorB) ?? LIVE_INK),
      angle: layer.background.angle,
    };
  }
  const position = item.position && typeof item.position === 'object' ? item.position as Record<string, unknown> : null;
  if (position) patch.position = { x: finite(position.x, layer.position.x), y: finite(position.y, layer.position.y) };
  const size = item.size && typeof item.size === 'object' ? item.size as Record<string, unknown> : null;
  if (size) patch.size = { width: Math.max(4, finite(size.width, layer.size.width)), height: Math.max(4, finite(size.height, layer.size.height)) };
  const opacity = finiteOptional(item.opacity);
  if (opacity != null) patch.opacity = Math.min(100, Math.max(0, opacity));
  if (!Object.keys(patch).length) return false;
  Object.assign(layer, applyLayerPatch(layer, patch));
  return true;
}

function readRange(value: unknown): { start: number; end: number } | null {
  if (!value || typeof value !== 'object') return null;
  const range = value as Record<string, unknown>;
  const start = finite(range.start, NaN);
  const end = finite(range.end, NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

function mapVibeLayer(raw: unknown, project: Project): MappedLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const type = TYPE_MAP[String(item.type ?? '').toLowerCase()];
  if (!type) return null;
  const lutRaw = item.lut && typeof item.lut === 'object' ? item.lut as Record<string, unknown> : {};
  const preset = PRESETS.has(lutRaw.preset as LutData['preset']) ? lutRaw.preset as LutData['preset'] : undefined;
  const layer = createLayer(type, {
    name: typeof item.name === 'string' ? item.name : undefined,
    ratePerMinute: finiteOptional(item.defaultRatePerMinute),
    instruction: typeof item.instruction === 'string' ? item.instruction : undefined,
    lutPreset: preset,
  });
  const touch = new Set<string>();
  const position = item.position && typeof item.position === 'object' ? item.position as Record<string, unknown> : null;
  if (position) layer.position = { x: finite(position.x, layer.position.x), y: finite(position.y, layer.position.y) };
  const size = item.size && typeof item.size === 'object' ? item.size as Record<string, unknown> : null;
  if (size) layer.size = { width: finite(size.width, layer.size.width), height: finite(size.height, layer.size.height) };
  if (type === 'live-badge' && item.badge && typeof item.badge === 'object') {
    const badge = item.badge as Record<string, unknown>;
    const mode = badge.mode === 'rec' || badge.mode === 'viewers' ? badge.mode : 'live';
    layer.badge = { mode, viewerCount: finite(badge.viewerCount, layer.badge?.viewerCount ?? 0), beats: layer.badge?.beats ?? [] };
  }
  if (type === 'live-badge') {
    const fill = readColor(item.fill ?? item.color ?? item.colorA);
    const ink = readColor(item.textColor ?? item.ink ?? item.colorB);
    if (fill || ink) {
      layer.background = { type: 'solid', colorA: fill ?? LIVE_FILL, colorB: ink ?? LIVE_INK, angle: 90 };
      touch.add('colors');
    }
  }
  if (type === 'lower-third') {
    layer.lowerThird = {
      title: String(item.title ?? layer.lowerThird?.title ?? '').slice(0, 80),
      subtitle: String(item.subtitle ?? layer.lowerThird?.subtitle ?? '').slice(0, 120),
    };
  }
  if (type === 'qr' && typeof item.target === 'string') layer.qr = { target: item.target.slice(0, 500) };
  if (type === 'lut' && layer.lut && typeof lutRaw.intensity === 'number') layer.lut.intensity = lutRaw.intensity;
  if (type === 'alert' && Array.isArray(item.events)) layer.alerts = item.events.slice(0, 20).map(toAlert).filter((event): event is AlertEvent => event != null);
  const range = readRange(item.timeRange);
  if (item.timeRange === null) {
    layer.timeRange = null;
    touch.add('timeRange');
  } else if (range) {
    layer.timeRange = range;
    touch.add('timeRange');
  }
  if (typeof item.animation === 'string' && ANIMATIONS.has(item.animation)) {
    layer.animation = item.animation as Layer['animation'];
    touch.add('animation');
  }
  if (item.spin === true) {
    layer.animation = 'spin';
    touch.add('animation');
  }
  const rotate = finiteOptional(item.rotate);
  if (rotate != null) {
    layer.transform = { ...layer.transform, rotate: Math.min(180, Math.max(-180, rotate)) };
    touch.add('rotate');
  }
  const assetId = resolveImageId(project, item.assetId);
  if (type === 'watermark' && assetId && layer.watermark) {
    layer.watermark = { assetId };
    touch.add('asset');
  }
  const parsed = layerSchema.safeParse(clampLayer(layer));
  return parsed.success ? { layer: parsed.data, touch } : null;
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOptional(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatTime(seconds: number): string {
  return `${round3(seconds)}s`;
}
