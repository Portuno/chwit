import type {
  AlertInput,
  LayerPatch,
  LayerType,
  LutData,
  ManualMessageInput,
  Project,
  SectorInput,
  SectorPatch,
} from '@chiwt/schema';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ProjectResponse = { project: Project; message?: string; assetId?: string };

function resolveApiOrigin(): string {
  const configured = (import.meta.env.VITE_CHWIT_API as string | undefined)?.trim().replace(/\/$/, '') ?? '';
  if (import.meta.env.DEV) return configured || 'http://127.0.0.1:8787';
  if (/^https:\/\//i.test(configured) && !/localhost|127\.0\.0\.1|\[::1\]/.test(configured)) return configured;
  return '';
}

const API_ORIGIN = resolveApiOrigin();

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

function apiUnreachable(): ApiError {
  if (!API_ORIGIN) return new ApiError('La API de Chiwt no respondió en este sitio.', 0);
  return new ApiError(`La API de Chiwt no responde en ${API_ORIGIN}. Iniciá el servidor con pnpm dev.`, 0);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(url), init);
  } catch {
    throw apiUnreachable();
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data.error === 'string' ? data.error : `Error ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
};

const FILE_MIME: Record<string, string> = {
  ...VIDEO_MIME,
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  opus: 'audio/opus',
};

export function mediaKind(file: File): 'video' | 'audio' | 'image' | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext in VIDEO_MIME) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff', 'aif', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return null;
}

function upload<T>(path: string, file: File, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(path));
    xhr.setRequestHeader('content-type', contentType(file));
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = data && typeof data.error === 'string' ? data.error : `Error ${xhr.status}`;
        reject(new ApiError(message, xhr.status));
        return;
      }
      resolve(data as T);
    };
    xhr.onerror = () => reject(new ApiError('No se pudo subir el archivo.', 0));
    xhr.onabort = () => reject(new ApiError('Se canceló la subida.', 0));
    xhr.send(file);
  });
}

function parseJson(raw: string): { error?: string } | null {
  try {
    return JSON.parse(raw) as { error?: string };
  } catch {
    return null;
  }
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_MIME[ext] ?? 'application/octet-stream';
}

function contentType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  return mimeFromName(file.name);
}

export const api = {
  health: () => request<{ status: string; nan: boolean }>('/api/healthz'),
  list: () => request<{ projects: { id: string; name: string; revision: number; updatedAt: string; duration: number; hasVideo: boolean }[] }>('/api/projects'),
  create: (name: string) => request<ProjectResponse>('/api/projects', json({ name })),
  get: (id: string) => request<ProjectResponse>(`/api/projects/${id}`),
  remove: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  uploadVideo: (id: string, file: File, onProgress?: (percent: number) => void) => upload<ProjectResponse>(`/api/projects/${id}/video`, file, onProgress),
  uploadAsset: (id: string, file: File, onProgress?: (percent: number) => void) => upload<ProjectResponse>(`/api/projects/${id}/assets`, file, onProgress),
  renameVideo: (id: string, fileName: string) => request<ProjectResponse>(`/api/projects/${id}/video`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName }),
  }),
  renameAsset: (id: string, assetId: string, name: string) => request<ProjectResponse>(`/api/projects/${id}/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }),
  removeAsset: (id: string, assetId: string) => request<ProjectResponse>(`/api/projects/${id}/assets/${assetId}`, { method: 'DELETE' }),
  useAssetAsVideo: (id: string, assetId: string) => request<ProjectResponse>(`/api/projects/${id}/assets/${assetId}/use-as-video`, { method: 'POST' }),
  linkLogo: (id: string, body: { assetId?: string; start?: number; end?: number | null; spin?: boolean; rotate?: number }) => request<ProjectResponse>(`/api/projects/${id}/logo`, json(body)),
  addLayer: (id: string, type: LayerType) => request<ProjectResponse>(`/api/projects/${id}/layers`, json({ type })),
  patchLayer: (id: string, layerId: string, patch: LayerPatch) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }),
  removeLayer: (id: string, layerId: string) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}`, { method: 'DELETE' }),
  addMessages: (id: string, layerId: string, messages: ManualMessageInput[]) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/messages`, json({ messages })),
  patchMessage: (id: string, layerId: string, messageId: string, patch: { text?: string; username?: string; color?: string; t?: number; locked?: boolean }) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }),
  removeMessage: (id: string, layerId: string, messageId: string) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/messages/${messageId}`, { method: 'DELETE' }),
  lockMessages: (id: string, layerId: string, body: { from: number; to: number; locked: boolean }) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/messages/lock`, json(body)),
  addSector: (id: string, layerId: string, sector: SectorInput) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/sectors`, json(sector)),
  patchSector: (id: string, layerId: string, sectorId: string, patch: SectorPatch) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/sectors/${sectorId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }),
  removeSector: (id: string, layerId: string, sectorId: string) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/sectors/${sectorId}`, { method: 'DELETE' }),
  generateChat: (id: string, layerId: string, body: { sectorId?: string; instruction?: string }) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/generate-chat`, json(body)),
  scheduleAlerts: (id: string, layerId: string, events: AlertInput[], mode: 'append' | 'replace') => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/alerts`, json({ events, mode })),
  removeAlert: (id: string, layerId: string, eventId: string) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/alerts/${eventId}`, { method: 'DELETE' }),
  generateAlerts: (id: string, layerId: string, body: { count?: number; instruction?: string }) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/generate-alerts`, json(body)),
  setCues: (id: string, layerId: string, cues: { id?: string; text: string; start: number; end: number }[]) => request<ProjectResponse>(`/api/projects/${id}/layers/${layerId}/subtitle-cues`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cues }),
  }),
  transcribe: (id: string, force = false) => request<ProjectResponse>(`/api/projects/${id}/transcribe`, json({ force })),
  prompt: (id: string, prompt: string, history: { role: 'user' | 'agent'; text: string }[] = []) => request<ProjectResponse>(`/api/projects/${id}/prompt`, json({ prompt, history })),
  livestream: (id: string, body: { lut?: LutData['preset']; ratePerMinute?: number; instruction?: string }) => request<ProjectResponse>(`/api/projects/${id}/livestream`, json(body)),
};
