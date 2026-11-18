import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { summarizeProject, type Project } from '@chiwt/schema';
import { z } from 'zod';

const apiBase = process.env.CHWIT_API?.trim() || 'http://127.0.0.1:8787';

type Payload = { project?: Project; projects?: unknown; message?: string; error?: string };

async function call(path: string, init?: RequestInit): Promise<Payload> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, init);
  } catch {
    throw new Error(`La API de Chiwt no responde en ${apiBase}. Iniciá el servidor con pnpm dev.`);
  }
  const data = await response.json().catch(() => null) as Payload | null;
  if (!response.ok) throw new Error(data?.error || `Error ${response.status}`);
  return data ?? {};
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function result(payload: Payload, extra?: Record<string, unknown>) {
  const summary = payload.project ? summarizeProject(payload.project) : undefined;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ message: payload.message, ...extra, project: summary, projects: payload.projects }, null, 2),
    }],
  };
}

function fail(error: unknown) {
  return { isError: true as const, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Error' }] };
}

async function tool<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    return fail(error);
  }
}

const server = new McpServer({ name: 'chiwt', version: '0.1.0' });

server.registerTool('chiwt_list_projects', {
  description: 'Lista los proyectos de Chiwt.',
  inputSchema: {},
}, async () => tool(async () => result(await call('/api/projects'))));

server.registerTool('chiwt_create_project', {
  description: 'Crea un proyecto vacío de Chiwt.',
  inputSchema: { name: z.string().optional() },
}, async ({ name }) => tool(async () => result(await call('/api/projects', json({ name })))));

server.registerTool('chiwt_get_project', {
  description: 'Devuelve un resumen del proyecto: capas, sectores de chat, ratio y las últimas líneas.',
  inputSchema: { projectId: z.string() },
}, async ({ projectId }) => tool(async () => result(await call(`/api/projects/${projectId}`))));

server.registerTool('chiwt_get_chat', {
  description: 'Devuelve los mensajes de una capa de chat, opcionalmente entre dos segundos del video.',
  inputSchema: { projectId: z.string(), layerId: z.string(), from: z.number().optional(), to: z.number().optional() },
}, async ({ projectId, layerId, from, to }) => tool(async () => {
  const data = await call(`/api/projects/${projectId}`);
  const layer = data.project?.layers.find((item) => item.id === layerId);
  if (!layer?.chat) throw new Error('No existe ese chat.');
  const messages = layer.chat.messages.filter((message) => (from == null || message.t >= from) && (to == null || message.t <= to));
  return { content: [{ type: 'text' as const, text: JSON.stringify({ messages, sectors: layer.chat.sectors, defaultRatePerMinute: layer.chat.defaultRatePerMinute, instruction: layer.chat.instruction }, null, 2) }] };
}));

server.registerTool('chiwt_import_video', {
  description: 'Copia un video local al proyecto. path es una ruta absoluta del disco.',
  inputSchema: { projectId: z.string(), path: z.string() },
}, async ({ projectId, path }) => tool(async () => result(await call(`/api/projects/${projectId}/video/import`, json({ path })))));

server.registerTool('chiwt_add_layer', {
  description: 'Agrega una capa: live-badge, chat, alert, lower-third, watermark (logo), qr, lut o subtitle.',
  inputSchema: {
    projectId: z.string(),
    type: z.enum(['live-badge', 'chat', 'alert', 'lower-third', 'watermark', 'qr', 'lut', 'subtitle']),
    name: z.string().optional(),
  },
}, async ({ projectId, type, name }) => tool(async () => result(await call(`/api/projects/${projectId}/layers`, json({ type, name })))));

server.registerTool('chiwt_update_layer', {
  description: 'Edita una capa. position y size van en porcentaje del cuadro. timeRange null la hace visible siempre.',
  inputSchema: {
    projectId: z.string(),
    layerId: z.string(),
    name: z.string().optional(),
    visible: z.boolean().optional(),
    opacity: z.number().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    size: z.object({ width: z.number(), height: z.number() }).optional(),
    timeRange: z.object({ start: z.number(), end: z.number() }).nullable().optional(),
    animation: z.enum(['none', 'blink', 'pulse', 'fade-in', 'slide-in', 'spin']).optional(),
    rotate: z.number().optional(),
    watermarkAssetId: z.string().nullable().optional(),
    defaultRatePerMinute: z.number().optional(),
    instruction: z.string().optional(),
    qrTarget: z.string().optional(),
  },
}, async ({ projectId, layerId, rotate, ...patch }) => tool(async () => {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  if (rotate != null) {
    const current = await call(`/api/projects/${projectId}`);
    const layer = current.project?.layers.find((item) => item.id === layerId);
    body.transform = { scale: layer?.transform.scale ?? 1, rotate };
  }
  return result(await call(`/api/projects/${projectId}/layers/${layerId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}));

server.registerTool('chiwt_rename_video', {
  description: 'Cambia el nombre visible de un video. Sin assetId renombra el de la línea de tiempo. Con assetId, un video ya incorporado al proyecto.',
  inputSchema: { projectId: z.string(), name: z.string(), assetId: z.string().optional() },
}, async ({ projectId, name, assetId }) => tool(async () => {
  if (assetId) {
    return result(await call(`/api/projects/${projectId}/assets/${assetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }));
  }
  return result(await call(`/api/projects/${projectId}/video`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: name }) }));
}));

server.registerTool('chiwt_incorporate', {
  description: 'Copia una imagen, un video o un audio local a la biblioteca del proyecto. path es una ruta absoluta. Queda vinculado a ese proyecto.',
  inputSchema: { projectId: z.string(), path: z.string() },
}, async ({ projectId, path }) => tool(async () => result(await call(`/api/projects/${projectId}/assets/import`, json({ path })))));

server.registerTool('chiwt_link_logo', {
  description: 'Vincula una imagen ya incorporada al logo del proyecto. start y end, en segundos, limitan cuándo se ve. spin true lo hace rotar. Si no hay capa de logo, la crea.',
  inputSchema: {
    projectId: z.string(),
    assetId: z.string().optional(),
    start: z.number().optional(),
    end: z.number().nullable().optional(),
    spin: z.boolean().optional(),
    rotate: z.number().optional(),
  },
}, async ({ projectId, ...body }) => tool(async () => result(await call(`/api/projects/${projectId}/logo`, json(body)))));

server.registerTool('chiwt_remove_layer', {
  description: 'Elimina una capa.',
  inputSchema: { projectId: z.string(), layerId: z.string() },
}, async ({ projectId, layerId }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}`, { method: 'DELETE' }))));

server.registerTool('chiwt_apply_livestream', {
  description: 'Agrega, si faltan, LUT, badge de vivo, chat y capa de alertas para que el video parezca un livestream.',
  inputSchema: {
    projectId: z.string(),
    lut: z.enum(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk']).optional(),
    ratePerMinute: z.number().optional(),
    instruction: z.string().optional(),
  },
}, async ({ projectId, ...body }) => tool(async () => result(await call(`/api/projects/${projectId}/livestream`, json(body)))));

server.registerTool('chiwt_set_chat_rate', {
  description: 'Cambia el ratio de mensajes por minuto de un chat o de un sector.',
  inputSchema: { projectId: z.string(), layerId: z.string(), ratePerMinute: z.number(), sectorId: z.string().optional() },
}, async ({ projectId, layerId, ratePerMinute, sectorId }) => tool(async () => {
  if (sectorId) return result(await call(`/api/projects/${projectId}/layers/${layerId}/sectors/${sectorId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ratePerMinute }) }));
  return result(await call(`/api/projects/${projectId}/layers/${layerId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultRatePerMinute: ratePerMinute }) }));
}));

server.registerTool('chiwt_add_chat_sector', {
  description: 'Crea un sector de chat. end null cubre hasta el final del video. La instrucción se guarda para regeneraciones futuras.',
  inputSchema: {
    projectId: z.string(),
    layerId: z.string(),
    name: z.string(),
    start: z.number(),
    end: z.number().nullable(),
    instruction: z.string().optional(),
    ratePerMinute: z.number(),
  },
}, async ({ projectId, layerId, ...sector }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}/sectors`, json(sector)))));

server.registerTool('chiwt_update_chat_sector', {
  description: 'Reescribe la instrucción, el ratio o los límites de un sector. No regenera los mensajes.',
  inputSchema: {
    projectId: z.string(),
    layerId: z.string(),
    sectorId: z.string(),
    name: z.string().optional(),
    start: z.number().optional(),
    end: z.number().nullable().optional(),
    instruction: z.string().optional(),
    ratePerMinute: z.number().optional(),
  },
}, async ({ projectId, layerId, sectorId, ...patch }) => tool(async () => {
  const body = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return result(await call(`/api/projects/${projectId}/layers/${layerId}/sectors/${sectorId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}));

server.registerTool('chiwt_add_manual_messages', {
  description: 'Inserta mensajes de chat escritos a mano. Quedan bloqueados y sobreviven a una regeneración.',
  inputSchema: {
    projectId: z.string(),
    layerId: z.string(),
    messages: z.array(z.object({
      t: z.number(),
      username: z.string(),
      text: z.string(),
      color: z.string().optional(),
    })).min(1),
  },
}, async ({ projectId, layerId, messages }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}/messages`, json({ messages })))));

server.registerTool('chiwt_lock_messages', {
  description: 'Bloquea o desbloquea los mensajes de chat entre dos segundos.',
  inputSchema: { projectId: z.string(), layerId: z.string(), from: z.number(), to: z.number(), locked: z.boolean() },
}, async ({ projectId, layerId, ...body }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}/messages/lock`, json(body)))));

server.registerTool('chiwt_generate_chat', {
  description: 'Mira el video (audio y fotogramas) y genera el chat. Con sectorId solo reescribe ese tramo. Los mensajes bloqueados se conservan.',
  inputSchema: { projectId: z.string(), layerId: z.string(), sectorId: z.string().optional(), instruction: z.string().optional() },
}, async ({ projectId, layerId, sectorId, instruction }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}/generate-chat`, json({ sectorId, instruction })))));

server.registerTool('chiwt_schedule_alerts', {
  description: 'Programa alertas o donaciones en segundos del video. mode replace borra las anteriores; append las suma.',
  inputSchema: {
    projectId: z.string(),
    layerId: z.string(),
    mode: z.enum(['append', 'replace']).optional(),
    events: z.array(z.object({
      t: z.number(),
      duration: z.number().optional(),
      kind: z.enum(['sub', 'donation', 'follow']),
      name: z.string(),
      amount: z.number().nullable().optional(),
      message: z.string().nullable().optional(),
    })).min(1),
  },
}, async ({ projectId, layerId, mode, events }) => tool(async () => result(await call(`/api/projects/${projectId}/layers/${layerId}/alerts`, json({ mode: mode ?? 'append', events })))));

server.registerTool('chiwt_transcribe', {
  description: 'Transcribe el habla del video con Whisper y crea subtítulos con tiempo.',
  inputSchema: { projectId: z.string(), force: z.boolean().optional() },
}, async ({ projectId, force }) => tool(async () => result(await call(`/api/projects/${projectId}/transcribe`, json({ force: force ?? false })))));

server.registerTool('chiwt_apply_prompt', {
  description: 'Pide capas en lenguaje natural. No inventa el chat línea por línea: para eso está chiwt_generate_chat.',
  inputSchema: { projectId: z.string(), prompt: z.string() },
}, async ({ projectId, prompt }) => tool(async () => result(await call(`/api/projects/${projectId}/prompt`, json({ prompt })))));

const transport = new StdioServerTransport();
await server.connect(transport);
