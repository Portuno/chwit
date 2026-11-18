import { activeAlert, activeSubtitle, chatMessagesAt, formatViewers, isLayerActiveAt, layerRotation, viewerCountAt, type Layer } from '@chiwt/schema';
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useStudio } from '@/lib/store';
import QRCode from 'qrcode';

type Props = {
  layer: Layer;
  projectId: string;
  currentTime: number;
  selected: boolean;
  frameRef: RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (box: { x: number; y: number; width: number; height: number }) => void;
  onOpenMenu: (point: { x: number; y: number }) => void;
  preview: { size: { width: number; height: number }; rotate: number } | null;
};

export function LayerView({ layer, projectId, currentTime, selected, frameRef, onSelect, onMove, onResize, onOpenMenu, preview }: Props) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [resize, setResize] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const active = isLayerActiveAt(layer, currentTime);
  const shown = preview
    ? { ...layer, size: preview.size, transform: { ...layer.transform, rotate: preview.rotate } }
    : layer;
  const position = resize ? { x: resize.x, y: resize.y } : drag ?? layer.position;
  const size = resize ? { width: resize.width, height: resize.height } : shown.size;
  const openMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onOpenMenu({ x: event.clientX, y: event.clientY });
  };
  if (layer.type === 'lut') {
    return selected ? (
      <button type="button" onClick={onSelect} onContextMenu={openMenu} className="absolute top-3 left-3 z-30 text-[10px] font-semibold tracking-wider bg-primary text-black rounded-full px-2 py-1">
        LUT
      </button>
    ) : null;
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    const origin = { ...position };
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (pointer: PointerEvent) => {
      const x = clamp(origin.x + ((pointer.clientX - startX) / frame.width) * 100, 0, 100 - size.width);
      const y = clamp(origin.y + ((pointer.clientY - startY) / frame.height) * 100, 0, 100 - size.height);
      setDrag({ x, y });
    };
    const up = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const x = clamp(origin.x + ((pointer.clientX - startX) / frame.width) * 100, 0, 100 - size.width);
      const y = clamp(origin.y + ((pointer.clientY - startY) / frame.height) * 100, 0, 100 - size.height);
      setDrag({ x, y });
      void Promise.resolve(onMove({ x, y })).finally(() => setDrag(null));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onResizeDown = (edge: Edge, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    const origin = { x: position.x, y: position.y, width: size.width, height: size.height };
    const angle = layerRotation(shown, currentTime);
    const scale = layer.transform.scale || 1;
    const startX = event.clientX;
    const startY = event.clientY;
    const apply = (pointer: PointerEvent) => {
      const local = localDelta(pointer.clientX - startX, pointer.clientY - startY, angle);
      return resizeBox(origin, edge, (local.x / scale / frame.width) * 100, (local.y / scale / frame.height) * 100, pointer.shiftKey);
    };
    const move = (pointer: PointerEvent) => setResize(apply(pointer));
    const up = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      const next = apply(pointer);
      setResize(next);
      void Promise.resolve(onResize(next)).finally(() => setResize(null));
    };
    document.body.style.cursor = cursorFor(edge, angle);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { if (!resize) setHover(false); }}
      onContextMenu={openMenu}
      className={`absolute ${selected ? 'ring-2 ring-primary' : ''} ${layer.animation !== 'none' && layer.animation !== 'spin' ? `anim-${layer.animation}` : ''}`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        width: `${size.width}%`,
        height: `${size.height}%`,
        opacity: active ? layer.opacity / 100 : 0,
        pointerEvents: active ? 'auto' : 'none',
        transform: `scale(${layer.transform.scale}) rotate(${layerRotation(shown, currentTime)}deg)`,
        zIndex: selected ? 20 : 10,
      }}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: layer.borderRadius,
          background: layer.type === 'live-badge' ? 'transparent' : backgroundOf(layer),
          boxShadow: layer.dropShadow.enabled ? `0 6px ${layer.dropShadow.blur}px rgba(0,0,0,0.45)` : undefined,
        }}
      >
      {layer.type === 'live-badge' && layer.badge && <Badge layer={layer} time={currentTime} />}
      {layer.type === 'chat' && layer.chat && <ChatBox layer={layer} time={currentTime} />}
      {layer.type === 'alert' && <AlertBox layer={layer} time={currentTime} />}
      {layer.type === 'lower-third' && layer.lowerThird && (
        <div className="h-full flex items-center border-l-4 border-cyan-300 px-3">
          <div>
            <div className="font-bold leading-tight">{layer.lowerThird.title}</div>
            <div className="text-[11px] uppercase tracking-wider text-white/60">{layer.lowerThird.subtitle}</div>
          </div>
        </div>
      )}
      {layer.type === 'watermark' && (
        layer.watermark?.assetId
          ? <img src={`/api/projects/${projectId}/assets/${layer.watermark.assetId}`} alt="" draggable={false} className="w-full h-full object-contain" />
          : <div className="w-full h-full grid place-items-center text-[10px] uppercase tracking-wider text-white/40 border border-dashed border-white/20">Logo</div>
      )}
      {layer.type === 'qr' && <QrBox value={layer.qr?.target ?? ''} />}
      {layer.type === 'subtitle' && layer.subtitle && <Subtitle layer={layer} time={currentTime} />}
      </div>
      {(selected || hover) && (
        <ResizeHandles angle={layerRotation(shown, currentTime)} onResizeDown={onResizeDown} />
      )}
    </div>
  );
}

function Badge({ layer, time }: { layer: Layer; time: number }) {
  const badge = layer.badge!;
  const viewers = formatViewers(viewerCountAt(badge, time));
  const label = badge.mode === 'rec' ? 'REC' : 'LIVE';
  const fresh = (badge.beats ?? []).some((beat) => time >= beat.t && time < beat.t + 6);
  const fill = badgeFill(layer);
  const ink = badgeInk(layer);
  return (
    <div className="h-full flex items-center justify-end">
      <div
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 h-[82%] max-w-full"
        style={{ background: fill, color: ink, boxShadow: fresh ? `inset 0 0 0 2px ${ink}, 0 0 0 3px rgba(255,255,255,0.85)` : `inset 0 0 0 2px ${ink}` }}
      >
        {badge.mode !== 'viewers' && <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: ink }} />}
        <span className="font-black tracking-wide text-[12px]">{badge.mode === 'viewers' ? viewers : label}</span>
        {badge.mode !== 'rec' && <span className="font-black tabular-nums text-[15px]">{viewers}</span>}
      </div>
    </div>
  );
}

function badgeFill(layer: Layer): string {
  return hexOr(layer.background.colorA, '#00d0f8');
}

function badgeInk(layer: Layer): string {
  const fill = badgeFill(layer);
  const ink = hexOr(layer.background.colorB, '#041018');
  return ink.toLowerCase() === fill.toLowerCase() ? '#041018' : ink;
}

function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function ChatBox({ layer, time }: { layer: Layer; time: number }) {
  const studio = useStudio();
  const selected = studio.selectedLayerId === layer.id;
  const [editing, setEditing] = useState<string | null>(null);
  const visible = chatMessagesAt(layer.chat?.messages ?? [], time).slice(-12);
  const save = (id: string, username: string, text: string) => {
    const message = layer.chat?.messages.find((item) => item.id === id);
    setEditing(null);
    if (!message) return;
    const nextUser = username.trim();
    const nextText = text.trim();
    if (!nextUser || !nextText) return;
    if (nextUser === message.username && nextText === message.text) return;
    void studio.patchMessage(layer.id, id, {
      username: nextUser,
      text: nextText,
      locked: true,
    });
  };
  return (
    <div
      className="h-full flex flex-col text-white"
      style={{
        containerType: 'size',
        fontSize: 'clamp(13px, 3.15cqh, 18px)',
        background: 'linear-gradient(180deg, rgba(10,12,18,0.28), rgba(8,10,16,0.46))',
        backdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
      }}
    >
      <div className="flex-1 min-h-0 overflow-hidden px-[0.65em] py-[0.4em] flex flex-col justify-end gap-[0.28em]">
        {visible.map((message) => (
          editing === message.id ? (
            <CommentEditor key={message.id} message={message} onSave={(username, text) => save(message.id, username, text)} onCancel={() => setEditing(null)} />
          ) : (
            <div
              key={message.id}
              className={`leading-tight text-left ${selected ? 'cursor-text' : ''}`}
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
              onPointerDown={(event) => {
                if (!selected) return;
                event.stopPropagation();
                setEditing(message.id);
              }}
            >
              <span className="font-extrabold mr-[0.4em]" style={{ color: message.color }}>{message.username}</span>
              <span className="text-white">{message.text}</span>
            </div>
          )
        ))}
      </div>
      <div className="px-[0.5em] pb-[0.5em]">
        <div className="rounded-full bg-black/25 border border-white/15 px-[0.7em] py-[0.28em] text-white/55" style={{ fontSize: '0.72em' }}>Enviar mensaje...</div>
      </div>
    </div>
  );
}

function AlertBox({ layer, time }: { layer: Layer; time: number }) {
  const event = activeAlert(layer.alerts ?? [], time);
  if (!event) return <div className="h-full grid place-items-center text-[10px] uppercase tracking-wider text-white/30">Alerta</div>;
  const subtitle = event.kind === 'donation' ? `Donó $${event.amount ?? 0}` : event.kind === 'follow' ? 'Nuevo follow' : 'Nuevo sub';
  return (
    <div key={event.id} className="h-full flex flex-col items-center justify-center text-center px-4 anim-slide-in">
      <div className="text-2xl font-black tracking-tight">{event.name}</div>
      <div className="text-cyan-300 text-xs font-bold tracking-[0.18em] mt-1">{subtitle.toUpperCase()}</div>
      {event.message && <div className="text-sm text-white/75 italic mt-2">“{event.message}”</div>}
    </div>
  );
}

function Subtitle({ layer, time }: { layer: Layer; time: number }) {
  const cue = activeSubtitle(layer.subtitle?.cues ?? [], time);
  if (!cue || !layer.subtitle) return null;
  return (
    <div className="h-full grid place-items-center px-2">
      <span
        className="px-3 py-1 rounded-md font-semibold text-center"
        style={{ color: layer.subtitle.color, background: layer.subtitle.backgroundColor, fontSize: layer.subtitle.fontSize }}
      >
        {cue.text}
      </span>
    </div>
  );
}

function QrBox({ value }: { value: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value.trim()) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(value, { margin: 1, width: 280 }).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => { cancelled = true; };
  }, [value]);
  if (!url) return <div className="h-full grid place-items-center text-[10px] text-black/50">QR sin URL</div>;
  return <img src={url} alt="" className="w-full h-full object-contain p-1" />;
}

function backgroundOf(layer: Layer): string {
  if (layer.type === 'subtitle' || layer.type === 'watermark') return 'transparent';
  if (layer.background.type === 'linear') return `linear-gradient(${layer.background.angle}deg, ${layer.background.colorA}, ${layer.background.colorB})`;
  if (layer.background.type === 'radial') return `radial-gradient(circle, ${layer.background.colorA}, ${layer.background.colorB})`;
  return layer.background.colorA;
}

function CommentEditor({ message, onSave, onCancel }: { message: { username: string; text: string; color: string }; onSave: (username: string, text: string) => void; onCancel: () => void }) {
  const [username, setUsername] = useState(message.username);
  const [text, setText] = useState(message.text);
  return (
    <form
      className="space-y-1"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(username, text);
      }}
    >
      <input
        aria-label="Usuario"
        autoFocus
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
        className="w-full bg-black/50 rounded px-1.5 py-0.5 outline-none"
        style={{ color: message.color, fontSize: '0.85em' }}
      />
      <textarea
        aria-label="Comentario"
        value={text}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSave(username, text);
          }
        }}
        className="w-full bg-black/50 rounded px-1.5 py-0.5 text-white outline-none resize-none"
        style={{ fontSize: '0.85em' }}
      />
    </form>
  );
}

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function ResizeHandles({ angle, onResizeDown }: { angle: number; onResizeDown: (edge: Edge, event: ReactPointerEvent) => void }) {
  const edges: Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          role="slider"
          aria-label={handleLabel(edge)}
          data-edge={edge}
          onPointerDown={(event) => onResizeDown(edge, event)}
          className={`absolute z-30 rounded-full border border-cyan-200 bg-white shadow ${handleShape(edge)}`}
          style={{ ...handlePlace(edge), cursor: cursorFor(edge, angle) }}
        />
      ))}
    </>
  );
}

function handleLabel(edge: Edge): string {
  if (edge === 'e' || edge === 'w') return 'Ancho';
  if (edge === 'n' || edge === 's') return 'Alto';
  return 'Tamaño';
}

function handleShape(edge: Edge): string {
  if (edge === 'n' || edge === 's') return 'h-1.5 w-7';
  if (edge === 'e' || edge === 'w') return 'h-7 w-1.5';
  return 'h-2.5 w-2.5';
}

function handlePlace(edge: Edge): { left: string; top: string; transform: string } {
  return {
    left: edge.includes('w') ? '0%' : edge.includes('e') ? '100%' : '50%',
    top: edge.includes('n') ? '0%' : edge.includes('s') ? '100%' : '50%',
    transform: 'translate(-50%, -50%)',
  };
}

function cursorFor(edge: Edge, degrees: number): string {
  const base = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }[edge];
  const angle = (((base + degrees) % 180) + 180) % 180;
  if (angle < 23 || angle >= 158) return 'ew-resize';
  if (angle < 68) return 'nwse-resize';
  if (angle < 113) return 'ns-resize';
  return 'nesw-resize';
}

function localDelta(dx: number, dy: number, degrees: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

function resizeBox(
  origin: { x: number; y: number; width: number; height: number },
  edge: Edge,
  dx: number,
  dy: number,
  shift: boolean,
): { x: number; y: number; width: number; height: number } {
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;
  let nextX = dx;
  let nextY = dy;
  if (shift && edge.length === 2) {
    const signX = edge.includes('e') ? 1 : -1;
    const signY = edge.includes('s') ? 1 : -1;
    const scale = Math.abs(dx / origin.width) > Math.abs(dy / origin.height) ? dx / origin.width : dy / origin.height;
    nextX = signX * origin.width * Math.abs(scale) * Math.sign(signX * dx || signY * dy || 1);
    nextY = signY * origin.height * Math.abs(scale) * Math.sign(signY * dy || signX * dx || 1);
  }
  if (edge.includes('e')) right += nextX;
  if (edge.includes('w')) left += nextX;
  if (edge.includes('s')) bottom += nextY;
  if (edge.includes('n')) top += nextY;
  if (right - left < 4) {
    if (edge.includes('w')) left = right - 4;
    else right = left + 4;
  }
  if (bottom - top < 4) {
    if (edge.includes('n')) top = bottom - 4;
    else bottom = top + 4;
  }
  left = clamp(left, 0, 96);
  right = clamp(right, left + 4, 100);
  top = clamp(top, 0, 96);
  bottom = clamp(bottom, top + 4, 100);
  return {
    x: Math.round(left * 10) / 10,
    y: Math.round(top * 10) / 10,
    width: Math.round((right - left) * 10) / 10,
    height: Math.round((bottom - top) * 10) / 10,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
