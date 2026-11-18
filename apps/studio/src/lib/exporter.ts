import { activeAlert, activeSubtitle, buildLutFilter, chatMessagesAt, formatViewers, isLayerActiveAt, layerRotation, viewerCountAt, type Layer } from '@chiwt/schema';
import QRCode from 'qrcode';

export type ExportHandle = { done: Promise<void>; cancel: () => void };

export function exportVideo(
  video: HTMLVideoElement,
  layers: Layer[],
  duration: number,
  playbackRate: number,
  assetUrl: (assetId: string) => string,
  onProgress: (percent: number) => void,
): ExportHandle {
  if (!video.videoWidth || !video.videoHeight) throw new Error('El video todavía no tiene dimensiones.');
  const total = duration > 0 ? duration : video.duration;
  if (!Number.isFinite(total) || total <= 0) throw new Error('No se conoce la duración.');

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No hay contexto de canvas.');

  const stream = canvas.captureStream(30);
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (capture) {
    for (const track of capture.call(video).getAudioTracks()) stream.addTrack(track);
  }
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(Math.min(40_000_000, Math.max(8_000_000, canvas.width * canvas.height * 0.12))),
    audioBitsPerSecond: 192_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };

  let raf = 0;
  let cancelled = false;
  let settled = false;
  const originalRate = video.playbackRate;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    for (const track of stream.getTracks()) track.stop();
    video.loop = true;
    video.playbackRate = originalRate;
  };

  const done = new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    recorder.onerror = () => fail(new Error('Falló la grabación.'));
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled) {
        reject(new Error('Exportación cancelada.'));
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chiwt-livestream.webm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      resolve();
    };

    const draw = () => {
      if (cancelled) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      const time = video.currentTime;
      if (time >= total - 0.05 || video.ended) {
        onProgress(100);
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      onProgress(Math.min(99, (time / total) * 100));
      const luts = layers.filter((layer) => layer.type === 'lut' && layer.lut && isLayerActiveAt(layer, time));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = luts.length ? luts.map((layer) => buildLutFilter(layer.lut!, layer.opacity / 100)).join(' ') : 'none';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      for (const layer of layers) {
        if (layer.type === 'lut' || !isLayerActiveAt(layer, time)) continue;
        drawLayer(ctx, canvas, layer, time, images.get(layer.id) ?? null);
      }
      raf = requestAnimationFrame(draw);
    };

    const images = new Map<string, HTMLImageElement>();
    void (async () => {
      try {
        await preload(layers, assetUrl, images);
        video.pause();
        video.loop = false;
        video.playbackRate = Math.min(2, Math.max(0.25, playbackRate || 1));
        video.currentTime = 0;
        await waitSeek(video);
        if (cancelled) {
          recorder.stop();
          return;
        }
        await video.play();
        recorder.start(250);
        raf = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    })();
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}

async function preload(layers: Layer[], assetUrl: (assetId: string) => string, images: Map<string, HTMLImageElement>) {
  await Promise.all(layers.map(async (layer) => {
    const source = layer.type === 'watermark' && layer.watermark?.assetId
      ? assetUrl(layer.watermark.assetId)
      : layer.type === 'qr' && layer.qr?.target
        ? await QRCode.toDataURL(layer.qr.target, { margin: 1, width: 320 })
        : null;
    if (!source) return;
    const image = await loadImage(source);
    if (image) images.set(layer.id, image);
  }));
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function waitSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (!video.seeking && video.currentTime < 0.05) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
  });
}

function drawLayer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, layer: Layer, time: number, image: HTMLImageElement | null) {
  const unit = canvas.width / 1280;
  const x = (layer.position.x / 100) * canvas.width;
  const y = (layer.position.y / 100) * canvas.height;
  const w = (layer.size.width / 100) * canvas.width;
  const h = (layer.size.height / 100) * canvas.height;
  ctx.save();
  ctx.globalAlpha = layer.opacity / 100;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.translate(cx, cy);
  ctx.rotate((layerRotation(layer, time) * Math.PI) / 180);
  ctx.scale(layer.transform.scale, layer.transform.scale);
  ctx.translate(-cx, -cy);
  if (layer.dropShadow.enabled) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = layer.dropShadow.blur * unit;
  }
  if (layer.type !== 'watermark' && layer.type !== 'subtitle' && layer.type !== 'live-badge' && layer.background.colorA !== 'transparent') {
    roundFill(ctx, x, y, w, h, layer.borderRadius * unit, layer);
  }
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';

  if (layer.type === 'live-badge' && layer.badge) {
    const label = layer.badge.mode === 'rec' ? 'REC' : layer.badge.mode === 'viewers' ? '' : 'LIVE';
    const count = formatViewers(viewerCountAt(layer.badge, time));
    const text = layer.badge.mode === 'viewers' ? count : layer.badge.mode === 'live' ? `${label}  ${count}` : label;
    ctx.font = `800 ${15 * unit}px sans-serif`;
    const pillW = Math.min(w, ctx.measureText(text).width + 28 * unit);
    const pillH = Math.min(h, 28 * unit);
    const fill = /^#[0-9a-fA-F]{6}$/.test(layer.background.colorA) ? layer.background.colorA : '#00d0f8';
    const inkRaw = /^#[0-9a-fA-F]{6}$/.test(layer.background.colorB) ? layer.background.colorB : '#041018';
    const ink = inkRaw.toLowerCase() === fill.toLowerCase() ? '#041018' : inkRaw;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y + (h - pillH) / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2 * unit;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText(text, x + 14 * unit, y + (h - pillH) / 2 + 6 * unit);
  } else if (layer.type === 'chat' && layer.chat) {
    drawChat(ctx, x, y, w, h, unit, layer, time);
  } else if (layer.type === 'alert' && layer.alerts) {
    const event = activeAlert(layer.alerts, time);
    if (event) {
      ctx.textAlign = 'center';
      ctx.font = `800 ${26 * unit}px sans-serif`;
      ctx.fillText(event.name.toUpperCase(), x + w / 2, y + 28 * unit);
      ctx.fillStyle = '#67e8f9';
      ctx.font = `700 ${14 * unit}px sans-serif`;
      const subtitle = event.kind === 'donation' ? `DONÓ $${event.amount ?? 0}` : event.kind === 'follow' ? 'NUEVO FOLLOW' : 'NUEVO SUB';
      ctx.fillText(subtitle, x + w / 2, y + 64 * unit);
      if (event.message) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `italic ${14 * unit}px sans-serif`;
        ctx.fillText(event.message, x + w / 2, y + 90 * unit);
      }
      ctx.textAlign = 'left';
    }
  } else if (layer.type === 'lower-third' && layer.lowerThird) {
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(x, y, 8 * unit, h);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${24 * unit}px sans-serif`;
    ctx.fillText(layer.lowerThird.title, x + 20 * unit, y + h * 0.22);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 ${14 * unit}px sans-serif`;
    ctx.fillText(layer.lowerThird.subtitle.toUpperCase(), x + 20 * unit, y + h * 0.58);
  } else if (layer.type === 'watermark' && image) {
    ctx.drawImage(image, x, y, w, h);
  } else if (layer.type === 'qr' && image) {
    const pad = 8 * unit;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x + pad, y + pad, w - pad * 2, h - pad * 2);
  } else if (layer.type === 'subtitle' && layer.subtitle) {
    const cue = activeSubtitle(layer.subtitle.cues, time);
    if (cue) {
      ctx.font = `700 ${layer.subtitle.fontSize * unit}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(cue.text);
      const padX = 14 * unit;
      const boxW = Math.min(w, metrics.width + padX * 2);
      const boxH = layer.subtitle.fontSize * 1.6 * unit;
      const bx = x + (w - boxW) / 2;
      const by = y + (h - boxH) / 2;
      ctx.fillStyle = layer.subtitle.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 8 * unit);
      ctx.fill();
      ctx.fillStyle = layer.subtitle.color;
      ctx.fillText(cue.text, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  }
  ctx.restore();
}

function drawChat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, unit: number, layer: Layer, time: number) {
  const pad = 12 * unit;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const glass = ctx.createLinearGradient(x, y, x, y + h);
  glass.addColorStop(0, 'rgba(10,12,18,0.28)');
  glass.addColorStop(1, 'rgba(8,10,16,0.46)');
  ctx.fillStyle = glass;
  ctx.fillRect(x, y, w, h);
  const inputH = 26 * unit;
  const inputY = y + h - pad - inputH;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(x + pad * 0.6, inputY, w - pad * 1.2, inputH, inputH / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `500 ${14 * unit}px sans-serif`;
  ctx.fillText('Enviar mensaje...', x + pad, inputY + 6 * unit);
  const lineH = 22 * unit;
  const room = Math.max(0, Math.floor((inputY - y - pad) / lineH));
  const visible = chatMessagesAt(layer.chat?.messages ?? [], time).slice(-Math.min(12, room));
  let cursor = inputY - 8 * unit - visible.length * lineH;
  for (const message of visible) {
    ctx.font = `800 ${15 * unit}px sans-serif`;
    ctx.fillStyle = message.color;
    const name = `${message.username}  `;
    const nameWidth = ctx.measureText(name).width;
    ctx.fillText(name, x + pad, cursor);
    ctx.font = `600 ${15 * unit}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(fitText(ctx, message.text, Math.max(20, w - pad * 2 - nameWidth)), x + pad + nameWidth, cursor);
    cursor += lineH;
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}…`).width > max) next = next.slice(0, -1);
  return `${next}…`;
}

function roundFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, layer: Layer) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  if (layer.background.type === 'linear') {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    gradient.addColorStop(0, layer.background.colorA);
    gradient.addColorStop(1, layer.background.colorB);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = layer.background.colorA;
  }
  ctx.fill();
}
