import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';
import { ProjectStore } from './store.js';

const store = new ProjectStore('/tmp/chiwt');
const ready = store.init();
const listener = getRequestListener(createApp(store).fetch);

function apiUrl(url: string): string {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? '' : url.slice(queryAt);
  if (path === '/api' || path.startsWith('/api/')) return url;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `/api${suffix}${query}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ready;
  req.url = apiUrl(req.url || '/');
  await listener(req, res);
}
