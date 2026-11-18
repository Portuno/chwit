import { z } from 'zod';

export const LAYER_TYPES = [
  'live-badge',
  'chat',
  'alert',
  'lower-third',
  'watermark',
  'qr',
  'lut',
  'subtitle',
] as const;

export const LAYER_ANIMATIONS = ['none', 'blink', 'pulse', 'fade-in', 'slide-in', 'spin'] as const;
export const layerAnimationSchema = z.enum(LAYER_ANIMATIONS);

export const assetKindSchema = z.enum(['image', 'video', 'audio']);
export const assetSchema = z.object({
  file: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  name: z.string().min(1).max(160).default('Sin nombre'),
  kind: assetKindSchema.default('image'),
});
export type Asset = z.infer<typeof assetSchema>;

export const layerTypeSchema = z.enum(LAYER_TYPES);
export type LayerType = z.infer<typeof layerTypeSchema>;

export const CHAT_COLORS = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#f87171',
  '#2dd4bf',
  '#fb7185',
] as const;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function newId(): string {
  return crypto.randomUUID();
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const timedMessageSchema = z.object({
  id: z.string().uuid(),
  t: z.number().min(0),
  username: z.string().min(1).max(40),
  text: z.string().min(1).max(300),
  color: hexColor,
  sectorId: z.string().uuid().nullable(),
  locked: z.boolean(),
  source: z.enum(['manual', 'generated']),
});
export type TimedMessage = z.infer<typeof timedMessageSchema>;

export const chatSectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  start: z.number().min(0),
  end: z.number().min(0).nullable(),
  instruction: z.string().max(2000),
  ratePerMinute: z.number().min(1).max(360),
});
export type ChatSector = z.infer<typeof chatSectorSchema>;

export const chatDataSchema = z.object({
  defaultRatePerMinute: z.number().min(1).max(360),
  instruction: z.string().max(2000),
  sectors: z.array(chatSectorSchema).max(50),
  messages: z.array(timedMessageSchema).max(5000),
});
export type ChatData = z.infer<typeof chatDataSchema>;

export const alertEventSchema = z.object({
  id: z.string().uuid(),
  t: z.number().min(0),
  duration: z.number().min(0.5).max(20),
  kind: z.enum(['sub', 'donation', 'follow']),
  name: z.string().min(1).max(60),
  amount: z.number().min(0).max(1_000_000).nullable(),
  message: z.string().max(200).nullable(),
});
export type AlertEvent = z.infer<typeof alertEventSchema>;

export const backgroundSchema = z.object({
  type: z.enum(['solid', 'linear', 'radial']),
  colorA: z.string().min(1).max(40),
  colorB: z.string().min(1).max(40),
  angle: z.number().min(0).max(360),
});
export type BackgroundStyle = z.infer<typeof backgroundSchema>;

export const lutManualSchema = z.object({
  brightness: z.number().min(0).max(200),
  contrast: z.number().min(0).max(200),
  saturate: z.number().min(0).max(200),
  sepia: z.number().min(0).max(100),
  grayscale: z.number().min(0).max(100),
  hueRotate: z.number().min(0).max(360),
});
export type LutManual = z.infer<typeof lutManualSchema>;

export const LUT_MANUAL_DEFAULTS: LutManual = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sepia: 0,
  grayscale: 0,
  hueRotate: 0,
};

export const lutSchema = z.object({
  preset: z.enum(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk']),
  intensity: z.number().min(0).max(200),
  manual: lutManualSchema,
});
export type LutData = z.infer<typeof lutSchema>;

export const subtitleCueSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(500),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;

export const viewerBeatSchema = z.object({
  id: z.string().uuid(),
  t: z.number().min(0),
  count: z.number().min(0).max(10_000_000),
});
export type ViewerBeat = z.infer<typeof viewerBeatSchema>;

export const layerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  type: layerTypeSchema,
  visible: z.boolean(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  timeRange: z.object({ start: z.number().min(0), end: z.number().min(0) }).nullable(),
  opacity: z.number().min(0).max(100),
  background: backgroundSchema,
  borderRadius: z.number().min(0).max(200),
  dropShadow: z.object({ enabled: z.boolean(), blur: z.number().min(0).max(80) }),
  animation: layerAnimationSchema,
  transform: z.object({
    scale: z.number().min(0.2).max(4),
    rotate: z.number().min(-180).max(180),
  }),
  chat: chatDataSchema.nullable(),
  alerts: z.array(alertEventSchema).max(500).nullable(),
  badge: z.object({
    mode: z.enum(['live', 'rec', 'viewers']),
    viewerCount: z.number().min(0).max(10_000_000),
    beats: z.array(viewerBeatSchema).max(40).default([]),
  }).nullable(),
  lowerThird: z.object({
    title: z.string().max(80),
    subtitle: z.string().max(120),
  }).nullable(),
  watermark: z.object({ assetId: z.string().uuid().nullable() }).nullable(),
  qr: z.object({ target: z.string().max(500) }).nullable(),
  lut: lutSchema.nullable(),
  subtitle: z.object({
    cues: z.array(subtitleCueSchema).max(2000),
    fontSize: z.number().min(10).max(96),
    color: z.string().min(1).max(40),
    backgroundColor: z.string().min(1).max(40),
  }).nullable(),
});
export type Layer = z.infer<typeof layerSchema>;

export const projectSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
  duration: z.number().min(0),
  videoToken: z.string().min(1),
  video: z.object({
    fileName: z.string().min(1).max(240),
    mimeType: z.string().min(1).max(120),
    playbackFile: z.string().min(1).max(2048),
  }).nullable(),
  assets: z.record(z.string(), assetSchema),
  transcript: z.object({
    updatedAt: z.string(),
    cues: z.array(z.object({
      text: z.string().min(1).max(500),
      start: z.number().min(0),
      end: z.number().min(0),
    })).max(4000),
  }).nullable(),
  layers: z.array(layerSchema).max(24),
});
export type Project = z.infer<typeof projectSchema>;

export const manualMessageInputSchema = z.object({
  t: z.number().min(0),
  username: z.string().min(1).max(40),
  text: z.string().min(1).max(300),
  color: hexColor.optional(),
});
export type ManualMessageInput = z.infer<typeof manualMessageInputSchema>;

export const sectorInputSchema = z.object({
  name: z.string().min(1).max(80),
  start: z.number().min(0),
  end: z.number().min(0).nullable(),
  instruction: z.string().max(2000).default(''),
  ratePerMinute: z.number().min(1).max(360),
});
export type SectorInput = z.infer<typeof sectorInputSchema>;

export const sectorPatchSchema = sectorInputSchema.partial();
export type SectorPatch = z.infer<typeof sectorPatchSchema>;

export const alertInputSchema = z.object({
  t: z.number().min(0),
  duration: z.number().min(0.5).max(20).optional(),
  kind: z.enum(['sub', 'donation', 'follow']),
  name: z.string().min(1).max(60),
  amount: z.number().min(0).max(1_000_000).nullable().optional(),
  message: z.string().max(200).nullable().optional(),
});
export type AlertInput = z.infer<typeof alertInputSchema>;

export const layerPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  visible: z.boolean().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  timeRange: z.object({ start: z.number().min(0), end: z.number().min(0) }).nullable().optional(),
  opacity: z.number().min(0).max(100).optional(),
  background: backgroundSchema.optional(),
  borderRadius: z.number().min(0).max(200).optional(),
  dropShadow: z.object({ enabled: z.boolean(), blur: z.number().min(0).max(80) }).optional(),
  animation: layerAnimationSchema.optional(),
  transform: z.object({
    scale: z.number().min(0.2).max(4),
    rotate: z.number().min(-180).max(180),
  }).optional(),
  defaultRatePerMinute: z.number().min(1).max(360).optional(),
  instruction: z.string().max(2000).optional(),
  badge: z.object({
    mode: z.enum(['live', 'rec', 'viewers']),
    viewerCount: z.number().min(0).max(10_000_000),
    beats: z.array(viewerBeatSchema).max(40).optional(),
  }).optional(),
  lowerThird: z.object({
    title: z.string().max(80),
    subtitle: z.string().max(120),
  }).optional(),
  watermarkAssetId: z.string().uuid().nullable().optional(),
  qrTarget: z.string().max(500).optional(),
  lut: lutSchema.optional(),
  subtitleStyle: z.object({
    fontSize: z.number().min(10).max(96).optional(),
    color: z.string().min(1).max(40).optional(),
    backgroundColor: z.string().min(1).max(40).optional(),
  }).optional(),
}).strict();
export type LayerPatch = z.infer<typeof layerPatchSchema>;

const LAYER_LAYOUT: Record<LayerType, { position: { x: number; y: number }; size: { width: number; height: number }; name: string }> = {
  'live-badge': { name: 'En vivo', position: { x: 3, y: 4 }, size: { width: 18, height: 8 } },
  chat: { name: 'Chat', position: { x: 63, y: 3 }, size: { width: 34.5, height: 94 } },
  alert: { name: 'Alerta', position: { x: 22, y: 32 }, size: { width: 56, height: 26 } },
  'lower-third': { name: 'Zócalo', position: { x: 4, y: 76 }, size: { width: 46, height: 16 } },
  watermark: { name: 'Logo', position: { x: 78, y: 72 }, size: { width: 16, height: 20 } },
  qr: { name: 'QR', position: { x: 4, y: 58 }, size: { width: 16, height: 28 } },
  lut: { name: 'LUT', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
  subtitle: { name: 'Subtítulos', position: { x: 12, y: 80 }, size: { width: 76, height: 14 } },
};

const solid = (color: string): BackgroundStyle => ({ type: 'solid', colorA: color, colorB: color, angle: 90 });

export function createEmptyProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newId(),
    name: name.trim() || 'Sin título',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    duration: 0,
    videoToken: newId(),
    video: null,
    assets: {},
    transcript: null,
    layers: [],
  };
}

export type CreateLayerOptions = {
  name?: string;
  ratePerMinute?: number;
  instruction?: string;
  lutPreset?: LutData['preset'];
};

export function createLayer(type: LayerType, options: CreateLayerOptions = {}): Layer {
  const layout = LAYER_LAYOUT[type];
  const rate = options.ratePerMinute ?? 12;
  const layer: Layer = {
    id: newId(),
    name: options.name?.trim() || layout.name,
    type,
    visible: true,
    position: { ...layout.position },
    size: { ...layout.size },
    timeRange: null,
    opacity: 100,
    background: type === 'live-badge' ? solid('#dc2626') : solid('#0a0a0b'),
    borderRadius: type === 'live-badge' ? 6 : 12,
    dropShadow: { enabled: type !== 'lut' && type !== 'subtitle', blur: 12 },
    animation: 'none',
    transform: { scale: 1, rotate: 0 },
    chat: null,
    alerts: null,
    badge: null,
    lowerThird: null,
    watermark: null,
    qr: null,
    lut: null,
    subtitle: null,
  };

  if (type === 'chat') {
    layer.chat = {
      defaultRatePerMinute: rate,
      instruction: options.instruction ?? '',
      sectors: [],
      messages: [],
    };
    layer.background = solid('transparent');
    layer.borderRadius = 18;
  } else if (type === 'alert') {
    layer.alerts = [];
    layer.background = solid('rgba(8,10,16,0.92)');
  } else if (type === 'live-badge') {
    layer.badge = { mode: 'live', viewerCount: 47800, beats: [] };
    layer.background = { type: 'solid', colorA: '#00d0f8', colorB: '#041018', angle: 90 };
    layer.borderRadius = 0;
    layer.dropShadow = { enabled: false, blur: 0 };
    layer.animation = 'none';
  } else if (type === 'lower-third') {
    layer.lowerThird = { title: 'Nombre', subtitle: 'En vivo' };
    layer.background = solid('rgba(8,10,16,0.88)');
  } else if (type === 'watermark') {
    layer.watermark = { assetId: null };
    layer.background = solid('transparent');
    layer.dropShadow = { enabled: false, blur: 0 };
  } else if (type === 'qr') {
    layer.qr = { target: '' };
    layer.background = solid('#ffffff');
  } else if (type === 'lut') {
    layer.lut = { preset: options.lutPreset ?? 'cyberpunk', intensity: 100, manual: { ...LUT_MANUAL_DEFAULTS } };
    layer.background = solid('transparent');
    layer.borderRadius = 0;
  } else if (type === 'subtitle') {
    layer.subtitle = {
      cues: [],
      fontSize: 28,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.55)',
    };
    layer.background = solid('transparent');
    layer.dropShadow = { enabled: false, blur: 0 };
  }

  return layerSchema.parse(clampLayer(layer));
}

export function clampLayer(layer: Layer): Layer {
  const width = clamp(layer.size.width, 4, 100);
  const height = clamp(layer.size.height, 4, 100);
  return {
    ...layer,
    position: {
      x: clamp(layer.position.x, 0, 100 - width),
      y: clamp(layer.position.y, 0, 100 - height),
    },
    size: { width, height },
    opacity: clamp(layer.opacity, 0, 100),
  };
}

export function applyLayerPatch(layer: Layer, patch: LayerPatch): Layer {
  const next: Layer = {
    ...layer,
    name: patch.name ?? layer.name,
    visible: patch.visible ?? layer.visible,
    position: patch.position ?? layer.position,
    size: patch.size ?? layer.size,
    timeRange: patch.timeRange === undefined ? layer.timeRange : patch.timeRange,
    opacity: patch.opacity ?? layer.opacity,
    background: patch.background ?? layer.background,
    borderRadius: patch.borderRadius ?? layer.borderRadius,
    dropShadow: patch.dropShadow ?? layer.dropShadow,
    animation: patch.animation ?? layer.animation,
    transform: patch.transform ?? layer.transform,
  };

  if (patch.defaultRatePerMinute != null || patch.instruction != null) {
    if (!next.chat) throw new Error('Esa capa no tiene chat.');
    next.chat = {
      ...next.chat,
      defaultRatePerMinute: patch.defaultRatePerMinute ?? next.chat.defaultRatePerMinute,
      instruction: patch.instruction ?? next.chat.instruction,
    };
  }
  if (patch.badge) {
    if (!next.badge) throw new Error('Esa capa no es una insignia.');
    next.badge = {
      mode: patch.badge.mode,
      viewerCount: patch.badge.viewerCount,
      beats: patch.badge.beats ?? next.badge.beats ?? [],
    };
  }
  if (patch.lowerThird) {
    if (!next.lowerThird) throw new Error('Esa capa no es un zócalo.');
    next.lowerThird = patch.lowerThird;
  }
  if (patch.watermarkAssetId !== undefined) {
    if (!next.watermark) throw new Error('Esa capa no es una marca de agua.');
    next.watermark = { assetId: patch.watermarkAssetId };
  }
  if (patch.qrTarget !== undefined) {
    if (!next.qr) throw new Error('Esa capa no es un QR.');
    next.qr = { target: patch.qrTarget };
  }
  if (patch.lut) {
    if (!next.lut) throw new Error('Esa capa no es un LUT.');
    next.lut = patch.lut;
  }
  if (patch.subtitleStyle && next.subtitle) {
    next.subtitle = { ...next.subtitle, ...removeUndefined(patch.subtitleStyle) };
  }

  return layerSchema.parse(clampLayer(next));
}

function removeUndefined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export function sectorInterval(sector: ChatSector, duration: number): [number, number] {
  const end = sector.end == null ? (duration > 0 ? duration : Number.POSITIVE_INFINITY) : sector.end;
  return [sector.start, end];
}

export function sectorsOverlap(sectors: ChatSector[], candidate: { id?: string; start: number; end: number | null }, duration: number): boolean {
  const next: ChatSector = {
    id: candidate.id ?? '00000000-0000-0000-0000-000000000000',
    name: 'tmp',
    start: candidate.start,
    end: candidate.end,
    instruction: '',
    ratePerMinute: 1,
  };
  const [start, end] = sectorInterval(next, duration);
  if (end <= start) return true;
  return sectors.some((sector) => {
    if (candidate.id && sector.id === candidate.id) return false;
    const [otherStart, otherEnd] = sectorInterval(sector, duration);
    return start < otherEnd && otherStart < end;
  });
}

export function chatColor(index: number, preferred?: string): string {
  if (preferred && /^#[0-9a-fA-F]{6}$/.test(preferred)) return preferred;
  return CHAT_COLORS[index % CHAT_COLORS.length] ?? '#60a5fa';
}

export function normalizeSubtitleCues(raw: { id?: string; text: string; start: number; end: number }[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const item of raw) {
    const text = item.text.trim();
    if (!text) continue;
    const start = Math.max(0, item.start);
    let end = Math.max(0, item.end);
    if (end <= start) end = start + 0.4;
    cues.push({
      id: item.id && z.string().uuid().safeParse(item.id).success ? item.id : newId(),
      text: text.slice(0, 500),
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
    });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues.slice(0, 2000);
}

export function summarizeProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    revision: project.revision,
    duration: round3(project.duration),
    hasVideo: project.video != null,
    videoFileName: project.video?.fileName ?? null,
    transcriptCues: project.transcript?.cues.length ?? 0,
    assets: Object.entries(project.assets).map(([id, asset]) => ({
      id,
      name: asset.name,
      kind: asset.kind,
      mimeType: asset.mimeType,
    })),
    layers: project.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible,
      position: layer.position,
      timeRange: layer.timeRange,
      animation: layer.animation,
      rotate: layer.transform.rotate,
      watermarkAssetId: layer.watermark?.assetId ?? null,
      chat: layer.chat
        ? {
            defaultRatePerMinute: layer.chat.defaultRatePerMinute,
            instruction: layer.chat.instruction,
            messages: layer.chat.messages.length,
            locked: layer.chat.messages.filter((message) => message.locked).length,
            recent: layer.chat.messages.slice(-8).map((message) => ({
              id: message.id,
              t: message.t,
              username: message.username,
              text: message.text,
              locked: message.locked,
              sectorId: message.sectorId,
            })),
            sectors: layer.chat.sectors.map((sector) => ({
              id: sector.id,
              name: sector.name,
              start: sector.start,
              end: sector.end,
              ratePerMinute: sector.ratePerMinute,
              instruction: sector.instruction,
            })),
          }
        : null,
      alerts: layer.alerts
        ? layer.alerts.map((event) => ({
            id: event.id,
            t: event.t,
            duration: event.duration,
            kind: event.kind,
            name: event.name,
            amount: event.amount,
            message: event.message,
          }))
        : null,
      lut: layer.lut ? { preset: layer.lut.preset, intensity: layer.lut.intensity } : null,
      badge: layer.badge,
      lowerThird: layer.lowerThird,
      qr: layer.qr,
    })),
  };
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function requireLayer(project: Project, layerId: string): Layer {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error('No existe esa capa.');
  return layer;
}
