import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.js';

export type FrameShot = { file: string; t: number };

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else {
        const detail = Buffer.concat(stderr).toString('utf8').trim().split('\n').slice(-4).join(' ');
        reject(new HttpError(422, detail || `${command} salió con código ${code}`));
      }
    });
  });
}

export async function probeDuration(file: string): Promise<number> {
  const output = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new HttpError(422, 'No se pudo leer la duración del video.');
  }
  return duration;
}

export async function extractAudio(videoPath: string, dest: string): Promise<boolean> {
  try {
    await run('ffmpeg', [
      '-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', '64k', dest,
    ]);
    return true;
  } catch {
    await rm(dest, { force: true });
    return false;
  }
}

export async function extractFrames(videoPath: string, outDir: string, duration: number): Promise<FrameShot[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const count = Math.min(12, Math.max(1, Math.floor(duration)));
  const step = duration / count;
  await run('ffmpeg', [
    '-y', '-i', videoPath,
    '-vf', `fps=${count / duration},scale=640:-1`,
    '-frames:v', String(count),
    path.join(outDir, 'f-%02d.jpg'),
  ]);
  const frames: FrameShot[] = [];
  for (let index = 0; index < count; index += 1) {
    const file = `f-${String(index + 1).padStart(2, '0')}.jpg`;
    frames.push({ file, t: Math.round(step * (index + 0.5) * 1000) / 1000 });
  }
  return frames;
}

export async function transcodePlayback(input: string, output: string): Promise<void> {
  await run('ffmpeg', [
    '-y', '-i', input,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart',
    output,
  ]);
}

export type FrameManifest = { videoToken: string; frames: FrameShot[] };

export async function readFrameManifest(file: string): Promise<FrameManifest | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as FrameManifest;
  } catch {
    return null;
  }
}

export async function writeFrameManifest(file: string, manifest: FrameManifest): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(manifest));
}
