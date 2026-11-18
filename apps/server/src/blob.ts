import { del, get, list, put } from '@vercel/blob';
import { HttpError } from './http.js';

const PREFIX = 'chiwt/';

export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function access(): 'public' | 'private' {
  if (process.env.BLOB_STORE_ID) return 'private';
  return 'public';
}

function pathname(id: string): string {
  return `${PREFIX}${id}/project.json`;
}

export async function writeProjectBlob(id: string, json: string): Promise<void> {
  try {
    await put(pathname(id), json, {
      access: access(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'no se pudo guardar';
    throw new HttpError(500, `No se pudo guardar el proyecto: ${message}`);
  }
}

export async function readProjectBlob(id: string): Promise<string | null> {
  const result = await get(pathname(id), { access: access(), useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

export async function listProjectIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const match = /^chiwt\/([0-9a-f-]{36})\/project\.json$/.exec(blob.pathname);
      if (match?.[1]) ids.push(match[1]);
    }
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  } while (cursor);
  return ids;
}

export async function deleteProjectBlob(id: string): Promise<void> {
  await del(pathname(id));
}
