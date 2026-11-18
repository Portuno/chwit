import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Layer } from '@chiwt/schema';

export type LayerDraft = {
  size: { width: number; height: number };
  rotate: number;
};

const MENU_WIDTH = 248;
const MENU_HEIGHT = 340;

export function LayerMenu({
  layer,
  point,
  draft,
  onDraft,
  onCommit,
  onClose,
}: {
  layer: Layer;
  point: { x: number; y: number };
  draft: LayerDraft;
  onDraft: (draft: LayerDraft) => void;
  onCommit: (draft: LayerDraft) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const layerId = useRef(layer.id);
  const retired = useRef(false);
  draftRef.current = draft;
  if (layerId.current !== layer.id) {
    retired.current = true;
    layerId.current = layer.id;
  }
  const commit = () => {
    if (retired.current) return;
    onCommit(draftRef.current);
  };
  useEffect(() => {
    retired.current = false;
  }, [layer.id]);
  const update = (next: LayerDraft) => {
    draftRef.current = next;
    onDraft(next);
  };
  const left = Math.max(8, Math.min(point.x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(point.y, window.innerHeight - MENU_HEIGHT - 8));

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      if (event.button === 2) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onContext = (event: MouseEvent) => {
      if (panel.current?.contains(event.target as Node)) event.preventDefault();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContext);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContext);
    };
  }, [onClose]);

  const applySize = (width: number, height: number) => {
    update({ ...draftRef.current, size: { width: clampSize(width), height: clampSize(height) } });
  };

  const scaleBoth = (factor: number) => {
    const current = draftRef.current;
    const next = { ...current, size: { width: clampSize(current.size.width * factor), height: clampSize(current.size.height * factor) } };
    update(next);
    onCommit(next);
  };

  const setRotate = (rotate: number) => {
    const next = { ...draftRef.current, rotate: clampRotate(rotate) };
    update(next);
    onCommit(next);
  };

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={`Tamaño y rotación de ${layer.name}`}
      className="fixed z-50 w-[248px] rounded-2xl border border-white/10 bg-[#141418]/95 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md p-3 space-y-3"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">{layer.name}</p>
        <button type="button" onClick={onClose} className="text-[11px] text-white/45 hover:text-white">Cerrar</button>
      </div>
      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-white/40">Tamaño</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => scaleBoth(0.85)} className={chipClass}>Más chico</button>
          <button type="button" onClick={() => scaleBoth(1.18)} className={chipClass}>Más grande</button>
        </div>
        <Slider label="Ancho" value={draft.size.width} min={4} max={100} step={0.5} suffix="%" onChange={(width) => applySize(width, draftRef.current.size.height)} onCommit={commit} />
        <Slider label="Alto" value={draft.size.height} min={4} max={100} step={0.5} suffix="%" onChange={(height) => applySize(draftRef.current.size.width, height)} onCommit={commit} />
      </section>
      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-white/40">Rotación</p>
        <Slider label="Grados" value={draft.rotate} min={-180} max={180} step={1} suffix="°" onChange={(rotate) => update({ ...draftRef.current, rotate: clampRotate(rotate) })} onCommit={commit} />
        <div className="grid grid-cols-5 gap-1">
          {[-90, -45, 0, 45, 90].map((angle) => (
            <button key={angle} type="button" onClick={() => setRotate(angle)} className={`${chipClass} ${draft.rotate === angle ? 'text-primary border-primary/50' : ''}`}>
              {angle > 0 ? `+${angle}` : angle}
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-[11px] text-white/70">
        <span>{label}</span>
        <span className="tabular-nums text-white/45">{formatValue(value)}{suffix}</span>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="w-full accent-cyan-400"
      />
    </label>
  );
}

function clampSize(value: number): number {
  return Math.round(Math.min(100, Math.max(4, value)) * 10) / 10;
}

function clampRotate(value: number): number {
  return Math.round(Math.min(180, Math.max(-180, value)));
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const chipClass = 'rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10';
