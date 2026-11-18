import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { nanConfigured } from './nan.js';
import { ProjectStore } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.CHWIT_ROOT ? path.resolve(process.env.CHWIT_ROOT) : path.resolve(here, '../../..');
dotenv.config({ path: path.join(root, '.env') });

const dataDir = path.resolve(root, process.env.CHWIT_DATA_DIR || 'data');
const port = Number(process.env.CHWIT_PORT || 8787);
const store = new ProjectStore(dataDir);
await store.init();

const server = serve({
  fetch: createApp(store).fetch,
  hostname: '127.0.0.1',
  port,
}, (info) => {
  console.log(`Chiwt API en http://127.0.0.1:${info.port}`);
  console.log(nanConfigured()
    ? 'NaN configurado.'
    : 'NaN sin clave: se puede editar a mano, la generación no va a responder.');
});

const httpServer = server as import('node:http').Server;
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;
