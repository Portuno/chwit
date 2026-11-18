import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayer, sectorsOverlap } from './model.js';
import { cuesFromSegments } from './timing.js';
import {
  generationWindows,
  mergeGeneratedMessages,
  placeGenerated,
  stampManual,
  targetMessageCount,
} from './chat.js';

test('un mensaje bloqueado sobrevive a la regeneración de su tramo', () => {
  const manual = stampManual({ t: 12, username: 'ana', text: 'esto queda', color: '#60a5fa' });
  const outside = { ...stampManual({ t: 40, username: 'leo', text: 'afuera' }), locked: false, source: 'generated' as const };
  const incoming = placeGenerated(
    [{ t: 5, username: 'kai', text: 'nuevo' }, { username: 'nio', text: 'otro' }],
    0,
    30,
    [manual.t],
    null,
  );
  const merged = mergeGeneratedMessages([manual, outside], incoming, 0, 30);
  assert.equal(merged.some((message) => message.id === manual.id && message.locked), true);
  assert.equal(merged.some((message) => message.text === 'afuera'), true);
  assert.equal(merged.some((message) => message.text === 'nuevo'), true);
  assert.equal(merged.every((message) => message.t >= 0), true);
});

test('sin sectores el video entero usa el ratio de la capa', () => {
  const layer = createLayer('chat', { ratePerMinute: 10, instruction: 'fans' });
  const windows = generationWindows(120, layer.chat!);
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.start, 0);
  assert.equal(windows[0]?.end, 120);
  assert.equal(windows[0]?.ratePerMinute, 10);
  assert.equal(targetMessageCount(10, 0, 120), 20);
});

test('un sector parte el video y conserva su instrucción', () => {
  const layer = createLayer('chat');
  layer.chat!.instruction = 'general';
  layer.chat!.sectors = [{
    id: crypto.randomUUID(),
    name: 'Clímax',
    start: 30,
    end: 50,
    instruction: 'más ácido',
    ratePerMinute: 30,
  }];
  const windows = generationWindows(60, layer.chat!);
  assert.deepEqual(windows.map((window) => [window.start, window.end, window.instruction]), [
    [0, 30, 'general'],
    [30, 50, 'más ácido'],
    [50, 60, 'general'],
  ]);
  const only = generationWindows(60, layer.chat!, layer.chat!.sectors[0]!.id);
  assert.equal(only.length, 1);
  assert.equal(only[0]?.instruction, 'más ácido');
});

test('los sectores superpuestos se rechazan', () => {
  const existing = [{
    id: crypto.randomUUID(),
    name: 'A',
    start: 0,
    end: 20,
    instruction: '',
    ratePerMinute: 8,
  }];
  assert.equal(sectorsOverlap(existing, { start: 10, end: 30 }, 60), true);
  assert.equal(sectorsOverlap(existing, { start: 20, end: 30 }, 60), false);
});

test('los subtítulos largos se parten en cues de hasta ocho palabras', () => {
  const cues = cuesFromSegments([{ start: 0, end: 4, text: 'uno dos tres cuatro cinco seis siete ocho nueve diez' }]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0]?.text.split(' ').length, 8);
  assert.equal(cues[1]?.text, 'nueve diez');
  assert.ok(cues[1]!.start >= cues[0]!.start);
});
