import { copyFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@chiwt/schema';
import { HttpError } from './http.js';
import { probeDuration, transcodePlayback } from './media.js';
import type { ProjectStore } from './store.js';

const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
};

const DIRECT_PLAYBACK = new Set(['.mp4', '.webm', '.mov']);

export function playbackPath(store: ProjectStore, project: Project): string {
  if (!project.video) throw new HttpError(400, 'Cargá un video primero.');
  return safeFile(store.dir(project.id), project.video.playbackFile);
}

export function safeFile(dir: string, fileName: string): string {
  const resolved = path.resolve(dir, path.basename(fileName));
  const root = `${path.resolve(dir)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new HttpError(400, 'Ruta inválida.');
  return resolved;
}

export async function attachVideoFile(store: ProjectStore, projectId: string, incomingPath: string, originalName: string, move = false): Promise<Project> {
  const ext = path.extname(originalName).toLowerCase();
  const mime = VIDEO_TYPES[ext];
  if (!mime) throw new HttpError(415, 'Usá MP4, WebM, MOV, MKV o AVI.');

  const dir = store.dir(projectId);
  const sourceName = `source${ext}`;
  const direct = DIRECT_PLAYBACK.has(ext);
  const playbackFile = direct ? sourceName : 'playback.mp4';
  const staged = path.join(dir, `.incoming-${crypto.randomUUID()}${ext}`);

  if (move) await moveFile(incomingPath, staged);
  else await copyFile(incomingPath, staged);

  const transcoded = direct ? null : path.join(dir, `.playback-${crypto.randomUUID()}.mp4`);
  try {
    if (transcoded) await transcodePlayback(staged, transcoded);
    const ready = transcoded ?? staged;
    const duration = await probeDuration(ready);
    await clearGeneratedMedia(dir);
    await rename(staged, path.join(dir, sourceName));
    if (transcoded) await rename(transcoded, path.join(dir, playbackFile));
    return await store.update(projectId, (project) => {
      project.video = {
        fileName: path.basename(originalName).slice(0, 240),
        mimeType: direct ? mime : 'video/mp4',
        playbackFile,
      };
      project.duration = duration;
      project.videoToken = crypto.randomUUID();
      project.transcript = null;
    });
  } catch (error) {
    await rm(staged, { force: true });
    if (transcoded) await rm(transcoded, { force: true });
    throw error;
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

async function clearGeneratedMedia(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => []);
  await Promise.all(names.map(async (name) => {
    if (name === 'frames' || name === 'audio.mp3' || name === 'playback.mp4' || name.startsWith('source.')) {
      await rm(path.join(dir, name), { recursive: true, force: true });
    }
  }));
}
