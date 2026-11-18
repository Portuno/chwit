import { chatColor, newId, round3, type ChatData, type ChatSector, type TimedMessage } from './model.js';

export type GenerationWindow = {
  start: number;
  end: number;
  ratePerMinute: number;
  instruction: string;
  sectorId: string | null;
};

export function resolvedEnd(sector: ChatSector, duration: number): number {
  if (sector.end == null) return duration;
  return Math.min(sector.end, duration);
}

export function generationWindows(duration: number, chat: ChatData, sectorId?: string): GenerationWindow[] {
  if (sectorId) {
    const sector = chat.sectors.find((item) => item.id === sectorId);
    if (!sector) throw new Error('No existe ese sector.');
    const start = Math.max(0, Math.min(sector.start, duration));
    const end = Math.max(start, Math.min(resolvedEnd(sector, duration), duration));
    return [{
      start,
      end,
      ratePerMinute: sector.ratePerMinute,
      instruction: sector.instruction || chat.instruction,
      sectorId: sector.id,
    }];
  }

  const sectors = [...chat.sectors].sort((a, b) => a.start - b.start);
  const windows: GenerationWindow[] = [];
  let cursor = 0;
  for (const sector of sectors) {
    const start = Math.max(0, Math.min(sector.start, duration));
    const end = Math.max(start, Math.min(resolvedEnd(sector, duration), duration));
    if (start > cursor + 0.05) {
      windows.push({
        start: cursor,
        end: start,
        ratePerMinute: chat.defaultRatePerMinute,
        instruction: chat.instruction,
        sectorId: null,
      });
    }
    if (end > start + 0.05) {
      windows.push({
        start,
        end,
        ratePerMinute: sector.ratePerMinute,
        instruction: sector.instruction || chat.instruction,
        sectorId: sector.id,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (duration - cursor > 0.05) {
    windows.push({
      start: cursor,
      end: duration,
      ratePerMinute: chat.defaultRatePerMinute,
      instruction: chat.instruction,
      sectorId: null,
    });
  }
  return windows;
}

export function targetMessageCount(ratePerMinute: number, start: number, end: number): number {
  const minutes = Math.max(0, end - start) / 60;
  if (minutes <= 0) return 0;
  return Math.max(1, Math.round(ratePerMinute * minutes));
}

export type CountedWindow = GenerationWindow & { count: number };

export function chunkWindow(window: GenerationWindow, count: number, chunkSize = 40): CountedWindow[] {
  if (count <= chunkSize) return [{ ...window, count }];
  const parts = Math.ceil(count / chunkSize);
  const span = window.end - window.start;
  const chunks: CountedWindow[] = [];
  for (let index = 0; index < parts; index += 1) {
    const size = index === parts - 1 ? count - chunkSize * (parts - 1) : chunkSize;
    chunks.push({
      ...window,
      start: window.start + span * (index / parts),
      end: window.start + span * ((index + 1) / parts),
      count: size,
    });
  }
  return chunks;
}

export type GeneratedDraft = { t?: number; username?: string; text?: string; color?: string };

export function placeGenerated(
  raw: GeneratedDraft[],
  start: number,
  end: number,
  lockedTimes: number[],
  sectorId: string | null,
): TimedMessage[] {
  const span = Math.max(0.2, end - start);
  const cleaned = raw
    .map((item) => ({
      username: String(item.username ?? '').trim().slice(0, 40),
      text: String(item.text ?? '').trim().slice(0, 300),
      color: item.color,
      t: Number(item.t),
    }))
    .filter((item) => item.username && item.text);

  const inside = cleaned.map((item) => item.t).filter((time) => Number.isFinite(time) && time >= start && time <= end);
  const sorted = [...inside].sort((a, b) => a - b);
  const spread = sorted.length >= 2 ? sorted[sorted.length - 1]! - sorted[0]! : 0;
  const useModelTimes = inside.length === cleaned.length && spread >= span * 0.45;

  return cleaned.map((item, index) => {
    let time = useModelTimes ? item.t : start + span * ((index + 0.5) / cleaned.length);
    time = Math.min(end, Math.max(start, time));
    for (const locked of lockedTimes) {
      if (Math.abs(time - locked) < 0.35) time = Math.min(end, Math.max(start, locked + 0.45));
    }
    return {
      id: newId(),
      t: round3(time),
      username: item.username,
      text: item.text,
      color: chatColor(index, item.color),
      sectorId,
      locked: false,
      source: 'generated' as const,
    };
  }).sort((a, b) => a.t - b.t);
}

export function mergeGeneratedMessages(existing: TimedMessage[], incoming: TimedMessage[], start: number, end: number): TimedMessage[] {
  const kept = existing.filter((message) => message.locked || message.t < start - 0.001 || message.t > end + 0.001);
  return [...kept, ...incoming].sort((a, b) => a.t - b.t || a.username.localeCompare(b.username));
}

export function stampManual(input: { t: number; username: string; text: string; color?: string }, index = 0): TimedMessage {
  return {
    id: newId(),
    t: round3(Math.max(0, input.t)),
    username: input.username.trim().slice(0, 40),
    text: input.text.trim().slice(0, 300),
    color: chatColor(index, input.color),
    sectorId: null,
    locked: true,
    source: 'manual',
  };
}
