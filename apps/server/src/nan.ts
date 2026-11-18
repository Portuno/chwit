import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import OpenAI, { toFile } from 'openai';
import { HttpError } from './http.js';

export function nanConfigured(): boolean {
  return Boolean(process.env.NAN_API_KEY?.trim());
}

function client(): OpenAI {
  const apiKey = process.env.NAN_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, 'Falta NAN_API_KEY en el entorno.');
  return new OpenAI({
    apiKey,
    baseURL: process.env.NAN_BASE_URL?.trim() || 'https://api.nan.builders/v1',
  });
}

export function textModel(): string {
  return process.env.NAN_TEXT_MODEL?.trim() || 'deepseek-v4-flash';
}

export function sttModel(): string {
  return process.env.NAN_STT_MODEL?.trim() || 'whisper';
}

type ChatContent = OpenAI.Chat.ChatCompletionContentPart[];

export async function completeJson(system: string, user: ChatContent | string): Promise<unknown> {
  const ai = client();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const base = {
    model: textModel(),
    messages,
    response_format: { type: 'json_object' as const },
    max_tokens: 8000,
  };
  let response: OpenAI.Chat.ChatCompletion;
  try {
    response = await ai.chat.completions.create({ ...base, reasoning_effort: 'none' } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/reasoning/i.test(message)) throw new HttpError(502, `NaN: ${message.slice(0, 400) || 'no respondió'}`);
    try {
      response = await ai.chat.completions.create(base);
    } catch (retry) {
      const detail = retry instanceof Error ? retry.message : 'no respondió';
      throw new HttpError(502, `NaN: ${detail.slice(0, 400)}`);
    }
  }
  const text = response.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new HttpError(502, 'NaN devolvió una respuesta vacía.');
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    throw new HttpError(502, 'NaN no devolvió JSON válido.');
  }
}

export type TranscriptSegment = { start: number; end: number; text: string };

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const ai = client();
  try {
    const file = await toFile(createReadStream(audioPath), 'audio.mp3');
    const result = await ai.audio.transcriptions.create({
      model: sttModel(),
      file,
      response_format: 'verbose_json',
    });
    const verbose = result as { text?: string; duration?: number; segments?: { start?: number; end?: number; text?: string }[] };
    const segments = (verbose.segments ?? [])
      .map((segment) => ({
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        text: String(segment.text ?? '').trim(),
      }))
      .filter((segment) => segment.text && segment.end > segment.start);
    if (segments.length) return segments;
    const text = String(verbose.text ?? '').trim();
    if (!text) return [];
    const end = Number(verbose.duration ?? 0) || 1;
    return [{ start: 0, end, text }];
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const detail = error instanceof Error ? error.message : 'falló la transcripción';
    throw new HttpError(502, `NaN: ${detail.slice(0, 400)}`);
  }
}

export async function imagePart(file: string): Promise<OpenAI.Chat.ChatCompletionContentPart> {
  const bytes = await readFile(file);
  return {
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` },
  };
}
