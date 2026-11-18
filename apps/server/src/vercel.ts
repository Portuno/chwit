import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';
import { ProjectStore } from './store.js';

const store = new ProjectStore('/tmp/chiwt');
const ready = store.init();
const listener = getRequestListener(createApp(store).fetch);

function apiUrl(url: string): string {
  const parsed = new URL(url, 'http://chiwt.local');
  const forwarded = parsed.searchParams.get('__path');
  if (forwarded) {
    parsed.searchParams.delete('__path');
    const suffix = forwarded.startsWith('/') ? forwarded : `/${forwarded}`;
    const path = suffix === '/api' || suffix.startsWith('/api/') ? suffix : `/api${suffix}`;
    const query = parsed.searchParams.toString();
    return query ? `${path}?${query}` : path;
  }
  const path = parsed.pathname;
  if (path === '/api' || path.startsWith('/api/')) return url;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `/api${suffix}${parsed.search}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ready;
  req.url = apiUrl(req.url || '/');
  await listener(req, res);
}
