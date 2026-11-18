import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z, type ZodType } from 'zod';
import {
  alertEventSchema,
  alertInputSchema,
  applyLayerPatch,
  assetSchema,
  clampLayer,
  createLayer,
  layerPatchSchema,
  layerSchema,
  layerTypeSchema,
  manualMessageInputSchema,
  newId,
  normalizeSubtitleCues,
  sectorInputSchema,
  sectorsOverlap,
  stampManual,
  timedMessageSchema,
  type AlertEvent,
  type Asset,
  type Project,
} from '@chiwt/schema';
import { applyLivestream, applyPrompt, generateAlerts, generateChat, transcribeProject } from './generate.js';
import { HttpError } from './http.js';
import { nanConfigured } from './nan.js';
import type { ProjectStore } from './store.js';
import { attachVideoFile, safeFile } from './videos.js';

const GB = 1024 * 1024 * 1024;
const MAX_VIDEO = 256 * GB;
const MAX_IMAGE = 1 * GB;
const MAX_AUDIO = 8 * GB;

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/webm': '.weba',
  'audio/aiff': '.aiff',
  'audio/x-aiff': '.aiff',
  'audio/opus': '.opus',
};

const EXT_KIND: Record<string, { mime: string; kind: Asset['kind'] }> = {
  '.png': { mime: 'image/png', kind: 'image' },
  '.jpg': { mime: 'image/jpeg', kind: 'image' },
  '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.webp': { mime: 'image/webp', kind: 'image' },
  '.gif': { mime: 'image/gif', kind: 'image' },
  '.mp4': { mime: 'video/mp4', kind: 'video' },
  '.webm': { mime: 'video/webm', kind: 'video' },
  '.mov': { mime: 'video/quicktime', kind: 'video' },
  '.mkv': { mime: 'video/x-matroska', kind: 'video' },
  '.avi': { mime: 'video/x-msvideo', kind: 'video' },
  '.m4v': { mime: 'video/mp4', kind: 'video' },
  '.mpg': { mime: 'video/mpeg', kind: 'video' },
  '.mpeg': { mime: 'video/mpeg', kind: 'video' },
  '.ts': { mime: 'video/mp2t', kind: 'video' },
  '.mts': { mime: 'video/mp2t', kind: 'video' },
  '.m2ts': { mime: 'video/mp2t', kind: 'video' },
  '.wmv': { mime: 'video/x-ms-wmv', kind: 'video' },
  '.flv': { mime: 'video/x-flv', kind: 'video' },
  '.mp3': { mime: 'audio/mpeg', kind: 'audio' },
  '.wav': { mime: 'audio/wav', kind: 'audio' },
  '.m4a': { mime: 'audio/mp4', kind: 'audio' },
  '.aac': { mime: 'audio/aac', kind: 'audio' },
  '.ogg': { mime: 'audio/ogg', kind: 'audio' },
  '.flac': { mime: 'audio/flac', kind: 'audio' },
  '.weba': { mime: 'audio/webm', kind: 'audio' },
  '.aiff': { mime: 'audio/aiff', kind: 'audio' },
  '.aif': { mime: 'audio/aiff', kind: 'audio' },
  '.opus': { mime: 'audio/opus', kind: 'audio' },
};

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'video/x-m4v': '.m4v',
  'video/mpeg': '.mpg',
  'video/mp2t': '.ts',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
};

export function createApp(store: ProjectStore): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Headers', 'content-type, x-filename');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Private-Network', 'true');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    console.error(error);
    return c.json({ error: 'Error interno' }, 500);
  });

  app.get('/api/healthz', (c) => c.json({ status: 'ok', nan: nanConfigured() }));

  app.get('/api/projects', async (c) => c.json({ projects: await store.list() }));

  app.post('/api/projects', async (c) => {
    const input = parse(z.object({ name: z.string().max(120).optional() }), await jsonBody(c));
    const project = await store.create(input.name ?? 'Sin título');
    return c.json({ project, message: 'Proyecto creado.' }, 201);
  });

  app.get('/api/projects/:id', async (c) => c.json({ project: await store.read(idOf(c)) }));

  app.delete('/api/projects/:id', async (c) => {
    await store.remove(idOf(c));
    return c.json({ ok: true });
  });

  app.get('/api/projects/:id/events', async (c) => {
    const id = idOf(c);
    const encoder = new TextEncoder();
    let closed = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            stop();
          }
        };
        const finish = () => {
          stop();
          try { controller.close(); } catch { /* ya cerrado */ }
        };
        try {
          send(JSON.stringify({ type: 'project', project: await store.read(id) }));
        } catch (error) {
          const message = error instanceof HttpError ? error.message : 'No se pudo abrir el proyecto.';
          send(JSON.stringify({ type: 'error', error: message }));
          finish();
          return;
        }
        if (closed) return;
        unsubscribe = store.subscribe(id, send);
        timer = setInterval(() => send(JSON.stringify({ type: 'ping' })), 15000);
        if (closed) stop();
        c.req.raw.signal.addEventListener('abort', finish);
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  app.post('/api/projects/:id/video', async (c) => {
    const id = idOf(c);
    await store.read(id);
    const ext = videoExtension(mimeOf(c), fileName(c, ''));
    if (!ext) throw new HttpError(415, 'Usá MP4, WebM, MOV, MKV o AVI.');
    rejectLength(c, MAX_VIDEO);
    const dir = store.dir(id);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.upload-${crypto.randomUUID()}${ext}`);
    const original = fileName(c, `video${ext}`);
    const named = path.extname(original).toLowerCase() === ext ? original : `${original}${ext}`;
    try {
      await writeLimited(c.req.raw.body, tmp, MAX_VIDEO);
      const project = await attachVideoFile(store, id, tmp, named, true);
      return c.json({ project, message: 'Video cargado.' });
    } finally {
      await rm(tmp, { force: true });
    }
  });

  app.post('/api/projects/:id/video/import', async (c) => {
    const id = idOf(c);
    await store.read(id);
    const input = parse(z.object({ path: z.string().min(1) }), await jsonBody(c));
    const resolved = path.resolve(input.path);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) throw new HttpError(400, 'La ruta no es un archivo de video.');
    if (info.size > MAX_VIDEO) throw new HttpError(413, tooBig(MAX_VIDEO));
    const project = await attachVideoFile(store, id, resolved, path.basename(resolved), false);
    return c.json({ project, message: 'Video importado.' });
  });

  app.patch('/api/projects/:id/video', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({ fileName: z.string() }), await jsonBody(c));
    const project = await store.update(id, (draft) => {
      if (!draft.video) throw new HttpError(400, 'Este proyecto no tiene video.');
      draft.video.fileName = displayName(input.fileName, 240);
    });
    return c.json({ project, message: 'Nombre del video actualizado.' });
  });

  app.get('/api/projects/:id/video', async (c) => {
    const project = await store.read(idOf(c));
    if (!project.video) throw new HttpError(404, 'Este proyecto no tiene video.');
    return serveFile(c, safeFile(store.dir(project.id), project.video.playbackFile), project.video.mimeType);
  });

  app.post('/api/projects/:id/assets', async (c) => {
    const id = idOf(c);
    await store.read(id);
    const named = fileName(c, 'archivo');
    const kind = classifyAsset(mimeOf(c), named);
    rejectLength(c, kind.limit);
    const assetId = newId();
    const saved = await saveAsset(store, id, assetId, c.req.raw.body, kind, named);
    return c.json({ project: saved.project, assetId, message: 'Archivo incorporado al proyecto.' });
  });

  app.post('/api/projects/:id/assets/import', async (c) => {
    const id = idOf(c);
    await store.read(id);
    const input = parse(z.object({ path: z.string().min(1) }), await jsonBody(c));
    const resolved = path.resolve(input.path);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) throw new HttpError(400, 'La ruta no es un archivo.');
    const named = path.basename(resolved);
    const kind = classifyAsset('', named);
    if (info.size > kind.limit) throw new HttpError(413, tooBig(kind.limit));
    const assetId = newId();
    const file = `${assetId}${kind.ext}`;
    const dir = path.join(store.dir(id), 'assets');
    await mkdir(dir, { recursive: true });
    await copyFile(resolved, path.join(dir, file));
    const project = await rememberAsset(store, id, assetId, file, kind.mime, kind.kind, named);
    return c.json({ project, assetId, message: 'Archivo incorporado al proyecto.' });
  });

  app.patch('/api/projects/:id/assets/:assetId', async (c) => {
    const id = idOf(c);
    const assetId = c.req.param('assetId');
    const input = parse(z.object({ name: z.string() }), await jsonBody(c));
    const project = await store.update(id, (draft) => {
      const asset = assetId ? draft.assets[assetId] : undefined;
      if (!asset) throw new HttpError(404, 'No existe ese archivo.');
      if (asset.kind !== 'video') throw new HttpError(400, 'Solo se le cambia el nombre a un video.');
      asset.name = displayName(input.name, 160);
    });
    return c.json({ project, message: 'Nombre del video actualizado.' });
  });

  app.delete('/api/projects/:id/assets/:assetId', async (c) => {
    const id = idOf(c);
    const assetId = c.req.param('assetId');
    const current = await store.read(id);
    const asset = assetId ? current.assets[assetId] : undefined;
    if (!asset) throw new HttpError(404, 'No existe ese archivo.');
    await rm(safeFile(path.join(store.dir(id), 'assets'), asset.file), { force: true });
    const project = await store.update(id, (draft) => {
      delete draft.assets[assetId];
      for (const layer of draft.layers) {
        if (layer.watermark?.assetId === assetId) layer.watermark = { assetId: null };
      }
    });
    return c.json({ project, message: 'Archivo quitado del proyecto.' });
  });

  app.post('/api/projects/:id/assets/:assetId/use-as-video', async (c) => {
    const id = idOf(c);
    const assetId = c.req.param('assetId');
    const current = await store.read(id);
    const asset = assetId ? current.assets[assetId] : undefined;
    if (!asset) throw new HttpError(404, 'No existe ese archivo.');
    if (asset.kind !== 'video') throw new HttpError(400, 'Ese archivo no es un video.');
    const ext = path.extname(asset.file);
    const named = asset.name.toLowerCase().endsWith(ext.toLowerCase()) ? asset.name : `${asset.name}${ext}`;
    const project = await attachVideoFile(store, id, safeFile(path.join(store.dir(id), 'assets'), asset.file), named, false);
    return c.json({ project, message: 'Ese video quedó como la línea de tiempo.' });
  });

  app.post('/api/projects/:id/logo', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({
      assetId: z.string().uuid().optional(),
      start: z.number().min(0).optional(),
      end: z.number().min(0).nullable().optional(),
      spin: z.boolean().optional(),
      rotate: z.number().min(-180).max(180).optional(),
    }), await jsonBody(c));
    const project = await store.update(id, (draft) => {
      applyLogo(draft, input);
    });
    return c.json({ project, message: 'Logo vinculado al proyecto.' });
  });

  app.get('/api/projects/:id/assets/:assetId', async (c) => {
    const project = await store.read(idOf(c));
    const assetId = c.req.param('assetId');
    const asset = assetId ? project.assets[assetId] : undefined;
    if (!asset) throw new HttpError(404, 'No existe ese archivo.');
    return serveFile(c, safeFile(path.join(store.dir(project.id), 'assets'), asset.file), asset.mimeType);
  });

  app.post('/api/projects/:id/layers', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({
      type: layerTypeSchema,
      name: z.string().max(80).optional(),
      ratePerMinute: z.number().min(1).max(360).optional(),
      instruction: z.string().max(2000).optional(),
      lutPreset: z.enum(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk']).optional(),
    }), await jsonBody(c));
    const project = await store.update(id, (draft) => {
      if (draft.layers.length >= 24) throw new HttpError(400, 'Máximo de 24 capas.');
      draft.layers.push(createLayer(input.type, input));
    });
    return c.json({ project, message: 'Capa agregada.' });
  });

  app.patch('/api/projects/:id/layers/:layerId', async (c) => {
    const { id, layerId } = layerIds(c);
    const patch = parse(layerPatchSchema, await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer) => {
      const next = applyLayerPatch(layer, patch);
      Object.assign(layer, next);
    });
    return c.json({ project, message: 'Capa actualizada.' });
  });

  app.delete('/api/projects/:id/layers/:layerId', async (c) => {
    const { id, layerId } = layerIds(c);
    const project = await store.update(id, (draft) => {
      const before = draft.layers.length;
      draft.layers = draft.layers.filter((layer) => layer.id !== layerId);
      if (draft.layers.length === before) throw new HttpError(404, 'No existe esa capa.');
    });
    return c.json({ project, message: 'Capa eliminada.' });
  });

  app.post('/api/projects/:id/layers/:layerId/messages', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({ messages: z.array(manualMessageInputSchema).min(1).max(200) }), await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      const stamped = input.messages.map((message, index) => stampManual(message, layer.chat!.messages.length + index));
      layer.chat.messages = [...layer.chat.messages, ...stamped].sort((a, b) => a.t - b.t).slice(0, 5000);
    });
    return c.json({ project, message: 'Mensajes manuales agregados.' });
  });

  app.patch('/api/projects/:id/layers/:layerId/messages/:messageId', async (c) => {
    const ids = messageIds(c);
    const patch = parse(z.object({
      text: z.string().min(1).max(300).optional(),
      username: z.string().min(1).max(40).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      t: z.number().min(0).optional(),
      locked: z.boolean().optional(),
    }).strict(), await jsonBody(c));
    const project = await updateLayer(store, ids.id, ids.layerId, (layer) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      const message = layer.chat.messages.find((item) => item.id === ids.messageId);
      if (!message) throw new HttpError(404, 'No existe ese mensaje.');
      if (patch.text != null) message.text = patch.text.trim();
      if (patch.username != null) message.username = patch.username.trim();
      if (patch.color) message.color = patch.color;
      if (patch.t != null) message.t = patch.t;
      if (patch.locked != null) message.locked = patch.locked;
      const parsed = timedMessageSchema.safeParse(message);
      if (!parsed.success) throw new HttpError(400, 'Mensaje inválido.');
      Object.assign(message, parsed.data);
      layer.chat.messages.sort((a, b) => a.t - b.t);
    });
    return c.json({ project, message: 'Mensaje actualizado.' });
  });

  app.delete('/api/projects/:id/layers/:layerId/messages/:messageId', async (c) => {
    const ids = messageIds(c);
    const project = await updateLayer(store, ids.id, ids.layerId, (layer) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      const before = layer.chat.messages.length;
      layer.chat.messages = layer.chat.messages.filter((message) => message.id !== ids.messageId);
      if (layer.chat.messages.length === before) throw new HttpError(404, 'No existe ese mensaje.');
    });
    return c.json({ project, message: 'Mensaje eliminado.' });
  });

  app.post('/api/projects/:id/layers/:layerId/messages/lock', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({ from: z.number().min(0), to: z.number().min(0), locked: z.boolean() }), await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      for (const message of layer.chat.messages) {
        if (message.t >= input.from && message.t <= input.to) message.locked = input.locked;
      }
    });
    return c.json({ project, message: input.locked ? 'Mensajes bloqueados.' : 'Mensajes desbloqueados.' });
  });

  app.post('/api/projects/:id/layers/:layerId/sectors', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(sectorInputSchema, await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer, draft) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      if (input.end != null && input.end <= input.start) throw new HttpError(400, 'El sector termina antes de empezar.');
      if (sectorsOverlap(layer.chat.sectors, input, draft.duration)) throw new HttpError(400, 'Ese sector se superpone con otro.');
      layer.chat.sectors.push({
        id: newId(),
        name: input.name,
        start: input.start,
        end: input.end,
        instruction: input.instruction ?? '',
        ratePerMinute: input.ratePerMinute,
      });
      layer.chat.sectors.sort((a, b) => a.start - b.start);
    });
    return c.json({ project, message: 'Sector creado.' });
  });

  app.patch('/api/projects/:id/layers/:layerId/sectors/:sectorId', async (c) => {
    const ids = sectorIds(c);
    const patch = parse(z.object({
      name: z.string().min(1).max(80).optional(),
      start: z.number().min(0).optional(),
      end: z.number().min(0).nullable().optional(),
      instruction: z.string().max(2000).optional(),
      ratePerMinute: z.number().min(1).max(360).optional(),
    }).strict(), await jsonBody(c));
    const project = await updateLayer(store, ids.id, ids.layerId, (layer, draft) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      const sector = layer.chat.sectors.find((item) => item.id === ids.sectorId);
      if (!sector) throw new HttpError(404, 'No existe ese sector.');
      const next = { ...sector, ...removeUndefined(patch) };
      if (next.end != null && next.end <= next.start) throw new HttpError(400, 'El sector termina antes de empezar.');
      if (sectorsOverlap(layer.chat.sectors, next, draft.duration)) throw new HttpError(400, 'Ese sector se superpone con otro.');
      Object.assign(sector, next);
      layer.chat.sectors.sort((a, b) => a.start - b.start);
    });
    return c.json({ project, message: 'Sector actualizado.' });
  });

  app.delete('/api/projects/:id/layers/:layerId/sectors/:sectorId', async (c) => {
    const ids = sectorIds(c);
    const project = await updateLayer(store, ids.id, ids.layerId, (layer) => {
      if (!layer.chat) throw new HttpError(400, 'Esa capa no es un chat.');
      const before = layer.chat.sectors.length;
      layer.chat.sectors = layer.chat.sectors.filter((sector) => sector.id !== ids.sectorId);
      if (layer.chat.sectors.length === before) throw new HttpError(404, 'No existe ese sector.');
    });
    return c.json({ project, message: 'Sector eliminado.' });
  });

  app.post('/api/projects/:id/layers/:layerId/generate-chat', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({
      sectorId: z.string().uuid().optional(),
      instruction: z.string().max(2000).optional(),
    }), await jsonBody(c));
    return c.json(await generateChat(store, id, layerId, input));
  });

  app.post('/api/projects/:id/layers/:layerId/alerts', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({
      mode: z.enum(['append', 'replace']).default('append'),
      events: z.array(alertInputSchema).min(1).max(200),
    }), await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer) => {
      if (!layer.alerts) throw new HttpError(400, 'Esa capa no es de alertas.');
      const events = input.events.map(toAlertEvent);
      layer.alerts = (input.mode === 'replace' ? events : [...layer.alerts, ...events])
        .sort((a, b) => a.t - b.t)
        .slice(0, 500);
    });
    return c.json({ project, message: 'Alertas programadas.' });
  });

  app.delete('/api/projects/:id/layers/:layerId/alerts/:eventId', async (c) => {
    const ids = eventIds(c);
    const project = await updateLayer(store, ids.id, ids.layerId, (layer) => {
      if (!layer.alerts) throw new HttpError(400, 'Esa capa no es de alertas.');
      const before = layer.alerts.length;
      layer.alerts = layer.alerts.filter((event) => event.id !== ids.eventId);
      if (layer.alerts.length === before) throw new HttpError(404, 'No existe esa alerta.');
    });
    return c.json({ project, message: 'Alerta eliminada.' });
  });

  app.post('/api/projects/:id/layers/:layerId/generate-alerts', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({
      count: z.number().int().min(1).max(30).optional(),
      instruction: z.string().max(2000).optional(),
    }), await jsonBody(c));
    return c.json(await generateAlerts(store, id, layerId, input));
  });

  app.put('/api/projects/:id/layers/:layerId/subtitle-cues', async (c) => {
    const { id, layerId } = layerIds(c);
    const input = parse(z.object({
      cues: z.array(z.object({
        id: z.string().uuid().optional(),
        text: z.string().max(500),
        start: z.number().min(0),
        end: z.number().min(0),
      })).max(2000),
    }), await jsonBody(c));
    const project = await updateLayer(store, id, layerId, (layer) => {
      if (!layer.subtitle) throw new HttpError(400, 'Esa capa no es de subtítulos.');
      layer.subtitle = { ...layer.subtitle, cues: normalizeSubtitleCues(input.cues) };
    });
    return c.json({ project, message: 'Subtítulos actualizados.' });
  });

  app.post('/api/projects/:id/transcribe', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({ force: z.boolean().optional() }), await jsonBody(c));
    return c.json(await transcribeProject(store, id, input.force ?? false));
  });

  app.post('/api/projects/:id/prompt', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({
      prompt: z.string().min(1).max(2000),
      history: z.array(z.object({
        role: z.enum(['user', 'agent']),
        text: z.string().max(800),
      })).max(12).optional(),
    }), await jsonBody(c));
    return c.json(await applyPrompt(store, id, input.prompt, input.history ?? []));
  });

  app.post('/api/projects/:id/livestream', async (c) => {
    const id = idOf(c);
    const input = parse(z.object({
      lut: z.enum(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk']).optional(),
      ratePerMinute: z.number().min(1).max(360).optional(),
      instruction: z.string().max(2000).optional(),
    }), await jsonBody(c));
    const project = await store.update(id, (draft) => applyLivestream(draft, input));
    return c.json({ project, message: 'Look de livestream aplicado.' });
  });

  return app;
}

function toAlertEvent(input: z.infer<typeof alertInputSchema>): AlertEvent {
  return alertEventSchema.parse({
    id: newId(),
    t: input.t,
    duration: input.duration ?? 4,
    kind: input.kind,
    name: input.name,
    amount: input.amount ?? null,
    message: input.message ?? null,
  });
}

async function updateLayer(
  store: ProjectStore,
  projectId: string,
  layerId: string,
  mutate: (layer: Project['layers'][number], project: Project) => void,
): Promise<Project> {
  return store.update(projectId, (project) => {
    const layer = project.layers.find((item) => item.id === layerId);
    if (!layer) throw new HttpError(404, 'No existe esa capa.');
    try {
      mutate(layer, project);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error) throw new HttpError(400, error.message);
      throw error;
    }
  });
}

function idOf(c: Context): string {
  return uuidParam(c, 'id');
}

function layerIds(c: Context): { id: string; layerId: string } {
  return { id: uuidParam(c, 'id'), layerId: uuidParam(c, 'layerId') };
}

function messageIds(c: Context): { id: string; layerId: string; messageId: string } {
  return { ...layerIds(c), messageId: uuidParam(c, 'messageId') };
}

function sectorIds(c: Context): { id: string; layerId: string; sectorId: string } {
  return { ...layerIds(c), sectorId: uuidParam(c, 'sectorId') };
}

function eventIds(c: Context): { id: string; layerId: string; eventId: string } {
  return { ...layerIds(c), eventId: uuidParam(c, 'eventId') };
}

function uuidParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !z.string().uuid().safeParse(value).success) throw new HttpError(400, 'Identificador inválido.');
  return value;
}

async function jsonBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.');
    throw new HttpError(400, where ? `${where}: ${issue.message}` : 'Datos inválidos.');
  }
  return result.data;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key as keyof T] = item as T[keyof T];
  }
  return out;
}

function videoExtension(mime: string, filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (EXT_KIND[ext]?.kind === 'video') return ext;
  return VIDEO_EXT[mime] ?? null;
}

function mimeOf(c: Context): string {
  return (c.req.header('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function fileName(c: Context, fallback: string): string {
  const header = c.req.header('x-filename');
  if (!header) return fallback;
  try {
    return path.basename(decodeURIComponent(header)) || fallback;
  } catch {
    return fallback;
  }
}

function tooBig(limit: number): string {
  const gb = limit / GB;
  const amount = gb >= 1 ? `${gb} GB` : `${Math.round(limit / (1024 * 1024))} MB`;
  return `El archivo es demasiado grande. El máximo es ${amount}.`;
}

function classifyAsset(mime: string, filename: string): { ext: string; mime: string; kind: Asset['kind']; limit: number } {
  const ext = path.extname(filename).toLowerCase();
  const mimeExt = IMAGE_EXT[mime] ?? VIDEO_EXT[mime] ?? AUDIO_EXT[mime];
  const chosen = (mimeExt ? EXT_KIND[mimeExt] : undefined) ?? EXT_KIND[ext];
  if (!chosen) throw new HttpError(415, 'Incorporá PNG, JPEG, WebP, GIF, MP4, WebM, MOV, MKV, AVI, MP3, WAV, M4A, AAC, OGG o FLAC.');
  const limit = chosen.kind === 'video' ? MAX_VIDEO : chosen.kind === 'audio' ? MAX_AUDIO : MAX_IMAGE;
  return { ext: mimeExt || ext, mime: mimeExt ? mime : chosen.mime, kind: chosen.kind, limit };
}

function displayName(value: string, max: number): string {
  const name = value.replace(/[\\/\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!name) throw new HttpError(400, 'El nombre no puede quedar vacío.');
  return name;
}

function assetLabel(filename: string): string {
  const base = path.basename(filename).trim();
  return (base || 'Sin nombre').slice(0, 160);
}

async function rememberAsset(store: ProjectStore, id: string, assetId: string, file: string, mime: string, kind: Asset['kind'], filename: string): Promise<Project> {
  return store.update(id, (draft) => {
    if (Object.keys(draft.assets).length >= 400) throw new HttpError(400, 'Este proyecto ya tiene 400 archivos.');
    draft.assets[assetId] = assetSchema.parse({ file, mimeType: mime, name: assetLabel(filename), kind });
  });
}

async function saveAsset(
  store: ProjectStore,
  id: string,
  assetId: string,
  body: ReadableStream<Uint8Array> | null,
  kind: { ext: string; mime: string; kind: Asset['kind']; limit: number },
  filename: string,
): Promise<{ project: Project }> {
  const file = `${assetId}${kind.ext}`;
  const dir = path.join(store.dir(id), 'assets');
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, file);
  await writeLimited(body, dest, kind.limit);
  try {
    return { project: await rememberAsset(store, id, assetId, file, kind.mime, kind.kind, filename) };
  } catch (error) {
    await rm(dest, { force: true });
    throw error;
  }
}

function applyLogo(draft: Project, input: { assetId?: string; start?: number; end?: number | null; spin?: boolean; rotate?: number }): void {
  const images = Object.entries(draft.assets).filter(([, asset]) => asset.kind === 'image');
  let layer = draft.layers.find((item) => item.type === 'watermark');
  if (!layer) {
    if (draft.layers.length >= 24) throw new HttpError(400, 'Máximo de 24 capas.');
    layer = createLayer('watermark');
    draft.layers.push(layer);
  }
  let assetId = layer.watermark?.assetId ?? null;
  if (input.assetId) {
    const asset = draft.assets[input.assetId];
    if (!asset || asset.kind !== 'image') throw new HttpError(400, 'Esa imagen no está incorporada en el proyecto.');
    assetId = input.assetId;
  } else if (!assetId) {
    if (images.length !== 1) throw new HttpError(400, 'Incorporá una imagen y elegí cuál es el logo.');
    assetId = images[0]?.[0] ?? null;
  }
  layer.watermark = { assetId };
  if (input.start != null || input.end != null) {
    if (input.end === null && input.start == null) {
      layer.timeRange = null;
    } else {
      const start = input.start ?? layer.timeRange?.start ?? 0;
      const end = input.end == null ? (draft.duration > start ? draft.duration : start + 1) : input.end;
      if (end <= start) throw new HttpError(400, 'El logo termina antes de aparecer.');
      layer.timeRange = { start, end };
    }
  }
  if (input.spin) layer.animation = 'spin';
  if (input.rotate != null) layer.transform = { ...layer.transform, rotate: input.rotate };
  const parsed = layerSchema.safeParse(clampLayer(layer));
  if (!parsed.success) throw new HttpError(400, 'No se pudo aplicar el logo.');
  Object.assign(layer, parsed.data);
}

function rejectLength(c: Context, limit: number): void {
  const length = Number(c.req.header('content-length'));
  if (Number.isFinite(length) && length > limit) throw new HttpError(413, tooBig(limit));
}

async function writeLimited(body: ReadableStream<Uint8Array> | null, dest: string, limit: number): Promise<void> {
  if (!body) throw new HttpError(400, 'Falta el archivo.');
  const out = createWriteStream(dest, { highWaterMark: 1024 * 1024 });
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new HttpError(413, tooBig(limit));
      if (!out.write(value)) await once(out, 'drain');
    }
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    await rm(dest, { force: true });
    if (error instanceof HttpError) throw error;
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOSPC') throw new HttpError(400, 'No hay espacio en el disco para guardar este archivo.');
    throw error;
  }
}

async function serveFile(c: Context, file: string, mime: string): Promise<Response> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'No está el archivo.');
  const size = info.size;
  const range = c.req.header('range');
  c.header('Accept-Ranges', 'bytes');
  c.header('Content-Type', mime);
  c.header('Cache-Control', 'no-cache');
  if (!range) {
    c.header('Content-Length', String(size));
    return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return c.body('Rango inválido', 416);
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    c.header('Content-Range', `bytes */${size}`);
    return c.body(null, 416);
  }
  end = Math.min(end, size - 1);
  c.header('Content-Range', `bytes ${start}-${end}/${size}`);
  c.header('Content-Length', String(end - start + 1));
  return c.body(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, 206);
}
