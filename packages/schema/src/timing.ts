import type { AlertEvent, LutData, SubtitleCue, TimedMessage } from './model.js';

export function viewerCountAt(badge: { viewerCount: number; beats?: { t: number; count: number }[] }, time: number): number {
  let count = badge.viewerCount;
  let at = -1;
  for (const beat of badge.beats ?? []) {
    if (beat.t <= time + 0.001 && beat.t >= at) {
      at = beat.t;
      count = beat.count;
    }
  }
  return count;
}

export function formatViewers(count: number): string {
  return new Intl.NumberFormat('es-AR').format(Math.max(0, Math.round(count)));
}

export function layerRotation(layer: { animation: string; transform: { rotate: number } }, time: number): number {
  const spin = layer.animation === 'spin' ? (time * 120) % 360 : 0;
  return layer.transform.rotate + spin;
}

export function isLayerActiveAt(layer: { visible: boolean; timeRange: { start: number; end: number } | null }, t: number): boolean {
  if (!layer.visible) return false;
  const range = layer.timeRange;
  if (!range) return true;
  if (range.start <= range.end) return t >= range.start && t <= range.end;
  return t >= range.start || t <= range.end;
}

export function chatMessagesAt(messages: TimedMessage[], t: number): TimedMessage[] {
  return messages.filter((message) => message.t <= t + 0.001).sort((a, b) => a.t - b.t);
}

export function activeAlert(events: AlertEvent[], t: number): AlertEvent | null {
  let current: AlertEvent | null = null;
  for (const event of events) {
    if (t >= event.t && t < event.t + event.duration && (!current || event.t >= current.t)) current = event;
  }
  return current;
}

export function activeSubtitle(cues: SubtitleCue[], t: number): SubtitleCue | null {
  return cues.find((cue) => t >= cue.start && t <= cue.end) ?? null;
}

/**
 * Misma cadena de filtros CSS que el preview y el export.
 * intensityScale deja que la opacidad de la capa atenúe el LUT en el export.
 */
export function buildLutFilter(lut: LutData, intensityScale = 1): string {
  const intensity = lut.intensity * intensityScale;
  const parts: string[] = [];
  switch (lut.preset) {
    case 'sepia':
      parts.push(`sepia(${intensity}%)`);
      break;
    case 'contrast':
      parts.push(`contrast(${100 + intensity}%)`);
      break;
    case 'vintage':
      parts.push(`sepia(${intensity * 0.8}%) contrast(120%) saturate(80%)`);
      break;
    case 'noir':
      parts.push(`grayscale(${intensity}%) contrast(150%)`);
      break;
    case 'cyberpunk':
      parts.push(`hue-rotate(${intensity * 1.5}deg) saturate(200%)`);
      break;
    default:
      break;
  }
  const manual = lut.manual;
  if (manual.brightness !== 100) parts.push(`brightness(${manual.brightness}%)`);
  if (manual.contrast !== 100) parts.push(`contrast(${manual.contrast}%)`);
  if (manual.saturate !== 100) parts.push(`saturate(${manual.saturate}%)`);
  if (manual.sepia > 0) parts.push(`sepia(${manual.sepia}%)`);
  if (manual.grayscale > 0) parts.push(`grayscale(${manual.grayscale}%)`);
  if (manual.hueRotate > 0) parts.push(`hue-rotate(${manual.hueRotate}deg)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export function cuesFromSegments(segments: { start: number; end: number; text: string }[]): { text: string; start: number; end: number }[] {
  const cues: { text: string; start: number; end: number }[] = [];
  for (const segment of segments) {
    const words = segment.text.split(/\s+/).map((word) => word.trim()).filter(Boolean);
    if (!words.length) continue;
    const start = Math.max(0, segment.start);
    const end = Math.max(start + 0.2, segment.end);
    const chunk = 8;
    const parts = Math.ceil(words.length / chunk);
    const span = end - start;
    for (let index = 0; index < parts; index += 1) {
      const text = words.slice(index * chunk, (index + 1) * chunk).join(' ');
      cues.push({
        text,
        start: round(start + span * (index / parts)),
        end: round(start + span * ((index + 1) / parts)),
      });
    }
  }
  return cues;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
