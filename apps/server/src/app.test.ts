import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from './app.ts';
import { ProjectStore } from './store.ts';

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'chiwt-'));
  const store = new ProjectStore(dir);
  await store.init();
  const app = createApp(store);
  return { dir, app };
}

async function send(app: ReturnType<typeof createApp>, url: string, init?: RequestInit) {
  const response = await app.request(url, init);
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

test('el proyecto guarda chat manual, sectores y alertas en el tiempo', async () => {
  const { dir, app } = await setup();
  try {
    const created = await send(app, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Escena' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(created.status, 201);
    const id = created.json.project.id as string;

    const chat = await send(app, `/api/projects/${id}/layers`, {
      method: 'POST',
      body: JSON.stringify({ type: 'chat', ratePerMinute: 12 }),
      headers: { 'content-type': 'application/json' },
    });
    const layerId = chat.json.project.layers[0].id as string;
    const messages = await send(app, `/api/projects/${id}/layers/${layerId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ t: 4, username: 'ana', text: 'eso queda' }] }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(messages.json.project.layers[0].chat.messages[0].locked, true);
    assert.equal(messages.json.project.layers[0].chat.messages[0].source, 'manual');

    const sector = await send(app, `/api/projects/${id}/layers/${layerId}/sectors`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Inicio', start: 0, end: 10, ratePerMinute: 8, instruction: 'curiosos' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(sector.status, 200);
    const overlap = await send(app, `/api/projects/${id}/layers/${layerId}/sectors`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Pisa', start: 5, end: 15, ratePerMinute: 8 }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(overlap.status, 400);
    assert.match(overlap.json.error, /superpone/);

    const alert = await send(app, `/api/projects/${id}/layers`, {
      method: 'POST',
      body: JSON.stringify({ type: 'alert' }),
      headers: { 'content-type': 'application/json' },
    });
    const alertId = alert.json.project.layers.find((layer: { type: string }) => layer.type === 'alert').id as string;
    const scheduled = await send(app, `/api/projects/${id}/layers/${alertId}/alerts`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'replace', events: [{ t: 6, kind: 'donation', name: 'Leo', amount: 5, message: 'vamos' }] }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(scheduled.json.project.layers.find((layer: { id: string }) => layer.id === alertId).alerts[0].t, 6);

    const look = await send(app, `/api/projects/${id}/livestream`, {
      method: 'POST',
      body: JSON.stringify({ lut: 'noir', ratePerMinute: 18, instruction: 'fans de la película' }),
      headers: { 'content-type': 'application/json' },
    });
    const types = look.json.project.layers.map((layer: { type: string }) => layer.type);
    assert.ok(types.includes('lut'));
    assert.ok(types.includes('live-badge'));
    assert.equal(look.json.project.layers.find((layer: { type: string }) => layer.type === 'chat').chat.defaultRatePerMinute, 18);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('importar un video deja duración y se puede leer por rangos', { skip: ffmpeg.status !== 0 }, async () => {
  const { dir, app } = await setup();
  const video = path.join(dir, 'scene.mp4');
  const encoded = spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    video,
  ], { stdio: 'ignore' });
  assert.equal(encoded.status, 0);
  try {
    const created = await send(app, '/api/projects', { method: 'POST', body: '{}' });
    const id = created.json.project.id as string;
    const imported = await send(app, `/api/projects/${id}/video/import`, {
      method: 'POST',
      body: JSON.stringify({ path: video }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(imported.status, 200, imported.json?.error);
    assert.ok(imported.json.project.duration > 0.5);
    assert.equal(imported.json.project.video.mimeType, 'video/mp4');
    const renamed = await send(app, `/api/projects/${id}/video`, {
      method: 'PATCH',
      body: JSON.stringify({ fileName: '  Escena del bar  ' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(renamed.status, 200, renamed.json?.error);
    assert.equal(renamed.json.project.video.fileName, 'Escena del bar');

    const response = await app.request(`/api/projects/${id}/video`, { headers: { range: 'bytes=0-3' } });
    assert.equal(response.status, 206);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, 4);

    const events = await app.request(`/api/projects/${id}/events`);
    const reader = events.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"project"/);
    await reader.cancel();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('una imagen incorporada queda vinculada al logo y puede rotar en un tramo', async () => {
  const { dir, app } = await setup();
  try {
    const created = await send(app, '/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Logo' }),
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json.project.id as string;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const uploaded = await send(app, `/api/projects/${id}/assets`, {
      method: 'POST',
      body: png,
      headers: { 'content-type': 'image/png', 'x-filename': encodeURIComponent('mi logo.png') },
    });
    assert.equal(uploaded.status, 200, uploaded.json?.error);
    const assetId = uploaded.json.assetId as string;
    assert.equal(uploaded.json.project.assets[assetId].kind, 'image');
    assert.equal(uploaded.json.project.assets[assetId].name, 'mi logo.png');

    const logo = await send(app, `/api/projects/${id}/logo`, {
      method: 'POST',
      body: JSON.stringify({ assetId, start: 1.5, end: 3, spin: true, rotate: 12 }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(logo.status, 200, logo.json?.error);
    const layer = logo.json.project.layers.find((item: { type: string }) => item.type === 'watermark');
    assert.equal(layer.name, 'Logo');
    assert.equal(layer.watermark.assetId, assetId);
    assert.deepEqual(layer.timeRange, { start: 1.5, end: 3 });
    assert.equal(layer.animation, 'spin');
    assert.equal(layer.transform.rotate, 12);

    const clip = await send(app, `/api/projects/${id}/assets`, {
      method: 'POST',
      body: Buffer.from('no-es-un-mp4'),
      headers: { 'content-type': 'video/mp4', 'x-filename': 'clip.mp4' },
    });
    assert.equal(clip.status, 200, clip.json?.error);
    const clipId = clip.json.assetId as string;
    const clipName = await send(app, `/api/projects/${id}/assets/${clipId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Toma 1' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(clipName.status, 200, clipName.json?.error);
    assert.equal(clipName.json.project.assets[clipId].name, 'Toma 1');

    const huge = await send(app, `/api/projects/${id}/assets`, {
      method: 'POST',
      body: png,
      headers: {
        'content-type': 'image/png',
        'content-length': String(2 * 1024 * 1024 * 1024),
        'x-filename': 'grande.png',
      },
    });
    assert.equal(huge.status, 413);
    assert.match(huge.json.error, /demasiado grande/);

    const heavy = await send(app, `/api/projects/${id}/video`, {
      method: 'POST',
      body: new Uint8Array([0]),
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(Math.round(5.3 * 1024 * 1024 * 1024)),
        'x-filename': 'escena.mp4',
      },
    });
    assert.notEqual(heavy.status, 413);
    assert.notEqual(heavy.status, 415);

    const over = await send(app, `/api/projects/${id}/video`, {
      method: 'POST',
      body: new Uint8Array([0]),
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(300 * 1024 * 1024 * 1024),
        'x-filename': 'enorme.mp4',
      },
    });
    assert.equal(over.status, 413);
    assert.match(over.json.error, /256 GB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
