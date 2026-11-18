import { useEffect, useRef, useState } from 'react';
import type { AlertEvent, ChatSector, Layer, LutData, TimedMessage } from '@chiwt/schema';
import { formatViewers, LUT_MANUAL_DEFAULTS } from '@chiwt/schema';
import { formatClock } from '@/lib/format';
import { useStudio } from '@/lib/store';

const fieldClass = 'w-full bg-black border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-primary/50';

export function Inspector() {
  const studio = useStudio();
  const layer = studio.project?.layers.find((item) => item.id === studio.selectedLayerId) ?? null;
  if (!layer) {
    return (
      <aside className="w-80 shrink-0 border-l border-border bg-[#0a0a0b] p-4 text-sm text-white/40">
        Elegí una capa para editar el tiempo, el chat o las alertas.
      </aside>
    );
  }
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-[#0a0a0b] overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold truncate">{layer.name}</h2>
          <button type="button" onClick={() => void studio.removeLayer(layer.id)} className="text-[11px] text-red-300">Eliminar</button>
        </div>
        <TextField label="Nombre" value={layer.name} onCommit={(name) => void studio.patchLayer(layer.id, { name })} />
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input type="checkbox" checked={layer.visible} onChange={(event) => void studio.patchLayer(layer.id, { visible: event.target.checked })} />
          Visible
        </label>
        <NumberField label="Opacidad" value={layer.opacity} min={0} max={100} onCommit={(opacity) => void studio.patchLayer(layer.id, { opacity })} />
        <TimeRange layer={layer} />
        {layer.chat && <ChatPanel layer={layer} />}
        {layer.alerts && <AlertPanel layer={layer} />}
        {layer.badge && <BadgePanel layer={layer} />}
        {layer.lowerThird && <LowerPanel layer={layer} />}
        {layer.lut && <LutPanel layer={layer} />}
        {layer.qr && <TextField label="URL del QR" value={layer.qr.target} onCommit={(qrTarget) => void studio.patchLayer(layer.id, { qrTarget })} />}
        {layer.watermark && <WatermarkPanel layer={layer} />}
        {layer.subtitle && <SubtitlePanel layer={layer} />}
        <Appearance layer={layer} />
      </div>
    </aside>
  );
}

function ChatPanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const chat = layer.chat!;
  const [instruction, setInstruction] = useState(chat.instruction);
  const [username, setUsername] = useState('yo');
  const [text, setText] = useState('');
  const [near, setNear] = useState(true);
  useEffect(() => setInstruction(chat.instruction), [chat.instruction, layer.id]);
  const messages = chat.messages.filter((message) => !near || Math.abs(message.t - studio.currentTime) <= 20);

  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="text-[10px] uppercase tracking-wider text-white/40">Chat en el tiempo</h3>
      <NumberField label="Mensajes por minuto" value={chat.defaultRatePerMinute} min={1} max={360} onCommit={(defaultRatePerMinute) => void studio.patchLayer(layer.id, { defaultRatePerMinute })} />
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Instrucción de todo el video</span>
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} min-h-16`} />
      </label>
      <button type="button" disabled={!studio.nan || !studio.project?.video || Boolean(studio.busy)} onClick={() => void studio.generateChat(layer.id, { instruction })} className="w-full text-xs py-2 rounded bg-primary/15 text-primary disabled:opacity-40">
        Generar chat del video
      </button>
      <p className="text-[11px] text-white/35">Si editás un comentario, queda fijo y no se pisa al regenerar.</p>
      <div className="space-y-2">
        {chat.sectors.map((sector) => (
          <SectorCard key={sector.id} layerId={layer.id} sector={sector} />
        ))}
        <SectorForm layerId={layer.id} />
      </div>
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        void studio.addMessages(layer.id, [{ t: studio.currentTime, username: username.trim() || 'yo', text: text.trim() }]);
        setText('');
      }}>
        <div className="text-[10px] uppercase tracking-wider text-white/40">Mensaje manual en {formatClock(studio.currentTime)}</div>
        <input value={username} onChange={(event) => setUsername(event.target.value)} className={fieldClass} aria-label="Usuario" />
        <input value={text} onChange={(event) => setText(event.target.value)} className={fieldClass} placeholder="Texto" />
        <button type="submit" className="w-full text-xs py-1.5 rounded bg-white/10">Agregar bloqueado</button>
      </form>
      <label className="flex items-center gap-2 text-[11px] text-white/50">
        <input type="checkbox" checked={near} onChange={(event) => setNear(event.target.checked)} />
        Cerca del playhead ({chat.messages.length} en total, {chat.messages.filter((message) => message.locked).length} bloqueados)
      </label>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {messages.map((message) => (
          <MessageRow key={message.id} layerId={layer.id} message={message} />
        ))}
      </div>
    </section>
  );
}

function MessageRow({ layerId, message }: { layerId: string; message: TimedMessage }) {
  const studio = useStudio();
  const focused = useRef(false);
  const [username, setUsername] = useState(message.username);
  const [text, setText] = useState(message.text);
  const [time, setTime] = useState(String(message.t));
  useEffect(() => {
    if (focused.current) return;
    setUsername(message.username);
    setText(message.text);
    setTime(String(message.t));
  }, [message.username, message.text, message.t]);

  const save = (patch: { text?: string; username?: string; t?: number; color?: string }) => {
    const next: typeof patch = {};
    if (patch.username != null && patch.username !== message.username) next.username = patch.username;
    if (patch.text != null && patch.text !== message.text) next.text = patch.text;
    if (patch.t != null && patch.t !== message.t) next.t = patch.t;
    if (patch.color != null && patch.color !== message.color) next.color = patch.color;
    if (!Object.keys(next).length) return;
    void studio.patchMessage(layerId, message.id, { ...next, locked: true });
  };

  return (
    <div className="text-[11px] bg-white/5 rounded px-2 py-2 space-y-1.5" onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={`Segundo de ${message.username}`}
          type="number"
          min={0}
          step={0.1}
          value={time}
          onChange={(event) => setTime(event.target.value)}
          onBlur={() => {
            const next = Number(time);
            if (!Number.isFinite(next) || next < 0) {
              setTime(String(message.t));
              return;
            }
            save({ t: next });
          }}
          className="w-16 bg-black border border-white/10 rounded px-1.5 py-1 tabular-nums outline-none focus:border-primary/50"
        />
        <input
          aria-label="Usuario"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            if (!next) {
              setUsername(message.username);
              return;
            }
            setUsername(next);
            save({ username: next });
          }}
          className="flex-1 min-w-0 bg-black border border-white/10 rounded px-1.5 py-1 outline-none focus:border-primary/50"
          style={{ color: message.color }}
        />
        <input
          aria-label="Color"
          type="color"
          value={message.color}
          onChange={(event) => save({ color: event.target.value })}
          className="h-6 w-6 shrink-0 rounded border border-white/10 bg-transparent"
        />
        <button type="button" onClick={() => void studio.patchMessage(layerId, message.id, { locked: !message.locked })} className="text-white/40">{message.locked ? 'fijo' : 'libre'}</button>
        <button type="button" aria-label="Quitar comentario" onClick={() => void studio.removeMessage(layerId, message.id)} className="text-white/40">×</button>
      </div>
      <textarea
        aria-label="Comentario"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (!next) {
            setText(message.text);
            return;
          }
          setText(next);
          save({ text: next });
        }}
        rows={2}
        className="w-full bg-black border border-white/10 rounded px-1.5 py-1 text-white/90 outline-none focus:border-primary/50 resize-none"
      />
    </div>
  );
}

function SectorCard({ layerId, sector }: { layerId: string; sector: ChatSector }) {
  const studio = useStudio();
  const [instruction, setInstruction] = useState(sector.instruction);
  useEffect(() => setInstruction(sector.instruction), [sector.instruction, sector.id]);
  return (
    <div className="rounded border border-white/10 p-2 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{sector.name}</span>
        <button type="button" onClick={() => void studio.removeSector(layerId, sector.id)} className="text-white/40">×</button>
      </div>
      <div className="text-[10px] text-white/40">{formatClock(sector.start)} – {sector.end == null ? 'fin' : formatClock(sector.end)}</div>
      <NumberField label="Por minuto" value={sector.ratePerMinute} min={1} max={360} onCommit={(ratePerMinute) => void studio.patchSector(layerId, sector.id, { ratePerMinute })} />
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} min-h-12`} />
      <button type="button" disabled={!studio.nan || Boolean(studio.busy)} onClick={() => void studio.generateChat(layerId, { sectorId: sector.id, instruction })} className="w-full text-[11px] py-1.5 rounded bg-white/10 disabled:opacity-40">
        Regenerar este sector
      </button>
    </div>
  );
}

function SectorForm({ layerId }: { layerId: string }) {
  const studio = useStudio();
  const [name, setName] = useState('Tramo');
  const [end, setEnd] = useState('');
  return (
    <form className="space-y-1" onSubmit={(event) => {
      event.preventDefault();
      const start = studio.currentTime;
      const parsedEnd = end.trim() === '' ? null : Number(end);
      void studio.addSector(layerId, {
        name,
        start,
        end: parsedEnd,
        instruction: '',
        ratePerMinute: 12,
      });
    }}>
      <div className="text-[10px] uppercase tracking-wider text-white/40">Nuevo sector desde el playhead</div>
      <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} aria-label="Nombre del sector" />
      <input value={end} onChange={(event) => setEnd(event.target.value)} placeholder="Fin en segundos, vacío = hasta el final" className={fieldClass} />
      <button type="submit" className="w-full text-[11px] py-1.5 rounded bg-white/10">Crear sector</button>
    </form>
  );
}

function AlertPanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const [name, setName] = useState('Ana');
  const [amount, setAmount] = useState('5');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<AlertEvent['kind']>('donation');
  const [instruction, setInstruction] = useState('donaciones y subs repartidos en los momentos fuertes');
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <h3 className="text-[10px] uppercase tracking-wider text-white/40">Alertas en el tiempo</h3>
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className={`${fieldClass} min-h-14`} />
      <button type="button" disabled={!studio.nan || !studio.project?.video || Boolean(studio.busy)} onClick={() => void studio.generateAlerts(layer.id, instruction)} className="w-full text-xs py-2 rounded bg-primary/15 text-primary disabled:opacity-40">
        Sumar alertas del video
      </button>
      <form className="space-y-1" onSubmit={(event) => {
        event.preventDefault();
        void studio.scheduleAlerts(layer.id, [{
          t: studio.currentTime,
          kind,
          name,
          amount: kind === 'donation' ? Number(amount) || 0 : null,
          message: message || null,
          duration: 4,
        }]);
      }}>
        <select value={kind} onChange={(event) => setKind(event.target.value as AlertEvent['kind'])} className={fieldClass}>
          <option value="donation">Donación</option>
          <option value="sub">Suscripción</option>
          <option value="follow">Follow</option>
        </select>
        <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} aria-label="Nombre" />
        {kind === 'donation' && <input value={amount} onChange={(event) => setAmount(event.target.value)} className={fieldClass} aria-label="Monto" />}
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mensaje" className={fieldClass} />
        <button type="submit" className="w-full text-[11px] py-1.5 rounded bg-white/10">Programar en {formatClock(studio.currentTime)}</button>
      </form>
      <div className="space-y-1">
        {layer.alerts?.map((event) => (
          <div key={event.id} className="flex items-center justify-between text-[11px] bg-white/5 rounded px-2 py-1">
            <span>{formatClock(event.t)} · {event.kind} · {event.name}</span>
            <button type="button" onClick={() => void studio.removeAlert(layer.id, event.id)}>×</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BadgePanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const badge = layer.badge!;
  const beats = badge.beats ?? [];
  const save = (viewerCount: number, nextBeats = beats) => void studio.patchLayer(layer.id, {
    badge: { mode: badge.mode, viewerCount, beats: nextBeats },
  });
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <select value={badge.mode} onChange={(event) => void studio.patchLayer(layer.id, { badge: { ...badge, mode: event.target.value as typeof badge.mode } })} className={fieldClass}>
        <option value="live">En vivo</option>
        <option value="rec">Grabando</option>
        <option value="viewers">Solo viewers</option>
      </select>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/40">Espectadores de base</div>
        <div className="text-3xl font-black tabular-nums leading-none mt-1">{formatViewers(badge.viewerCount)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ColorField label="Fondo" value={layer.background.colorA} fallback="#00d0f8" onCommit={(colorA) => void studio.patchLayer(layer.id, { background: { ...layer.background, type: 'solid', colorA } })} />
        <ColorField label="Texto" value={layer.background.colorB} fallback="#041018" onCommit={(colorB) => void studio.patchLayer(layer.id, { background: { ...layer.background, type: 'solid', colorB } })} />
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[[-10000, '−10 mil'], [-1000, '−1 mil'], [1000, '+1 mil'], [10000, '+10 mil']].map(([delta, label]) => (
          <button key={label} type="button" onClick={() => save(Math.min(10_000_000, Math.max(0, badge.viewerCount + Number(delta))))} className="text-[10px] py-1.5 rounded bg-white/10">{label}</button>
        ))}
      </div>
      <NumberField label="Número exacto" value={badge.viewerCount} min={0} max={10000000} onCommit={(viewerCount) => save(viewerCount)} />
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Cifras del programa</span>
        <button
          type="button"
          className="text-[11px] text-primary"
          onClick={() => save(badge.viewerCount, [...beats, { id: crypto.randomUUID(), t: Math.round(studio.currentTime * 10) / 10, count: badge.viewerCount }])}
        >
          Sumar acá
        </button>
      </div>
      <div className="space-y-1.5">
        {beats.length === 0 && <div className="text-[11px] text-white/35">Cuando en el video dicen un número, aparece desde ese segundo.</div>}
        {[...beats].sort((a, b) => a.t - b.t).map((beat) => (
          <div key={beat.id} className="flex items-center gap-1">
            <input
              aria-label={`Segundo de ${formatViewers(beat.count)}`}
              defaultValue={String(beat.t)}
              onBlur={(event) => {
                const t = Number(event.target.value);
                if (!Number.isFinite(t) || t < 0) return;
                save(badge.viewerCount, beats.map((item) => item.id === beat.id ? { ...item, t } : item));
              }}
              className="w-14 bg-black border border-white/10 rounded px-1.5 py-1 text-[11px]"
            />
            <input
              aria-label="Cifra"
              defaultValue={String(beat.count)}
              onBlur={(event) => {
                const count = Math.min(10_000_000, Math.max(0, Number(event.target.value)));
                if (!Number.isFinite(count)) return;
                save(badge.viewerCount, beats.map((item) => item.id === beat.id ? { ...item, count } : item));
              }}
              className="flex-1 bg-black border border-white/10 rounded px-1.5 py-1 text-[11px] tabular-nums"
            />
            <button type="button" className="text-white/40 px-1" aria-label="Quitar cifra" onClick={() => save(badge.viewerCount, beats.filter((item) => item.id !== beat.id))}>×</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function LowerPanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const data = layer.lowerThird!;
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <TextField label="Título" value={data.title} onCommit={(title) => void studio.patchLayer(layer.id, { lowerThird: { ...data, title } })} />
      <TextField label="Subtítulo" value={data.subtitle} onCommit={(subtitle) => void studio.patchLayer(layer.id, { lowerThird: { ...data, subtitle } })} />
    </section>
  );
}

function LutPanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const lut = layer.lut!;
  const manual = lut.manual ?? LUT_MANUAL_DEFAULTS;
  const commit = (next: LutData) => void studio.patchLayer(layer.id, { lut: next });
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <select value={lut.preset} onChange={(event) => commit({ ...lut, preset: event.target.value as LutData['preset'] })} className={fieldClass}>
        {(['sepia', 'contrast', 'vintage', 'noir', 'cyberpunk'] as const).map((preset) => <option key={preset} value={preset}>{preset}</option>)}
      </select>
      <NumberField label="Intensidad" value={lut.intensity} min={0} max={200} onCommit={(intensity) => commit({ ...lut, intensity })} />
      {(['brightness', 'contrast', 'saturate', 'sepia', 'grayscale', 'hueRotate'] as const).map((key) => (
        <NumberField key={key} label={key} value={manual[key]} min={0} max={key === 'hueRotate' ? 360 : 200} onCommit={(value) => commit({ ...lut, manual: { ...manual, [key]: value } })} />
      ))}
    </section>
  );
}

function WatermarkPanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const images = Object.entries(studio.project?.assets ?? {}).filter(([, asset]) => asset.kind === 'image');
  const current = layer.watermark?.assetId ?? '';
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-white/40">Logo</h3>
        <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-primary">Incorporar</button>
      </div>
      <select
        aria-label="Logo incorporado"
        value={current}
        onChange={(event) => void studio.patchLayer(layer.id, { watermarkAssetId: event.target.value || null })}
        className={fieldClass}
      >
        <option value="">Sin logo</option>
        {images.map(([id, asset]) => <option key={id} value={id}>{asset.name}</option>)}
      </select>
      <p className="text-[11px] text-white/35">Queda vinculado a este proyecto. El tiempo y la rotación se editan abajo.</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        void studio.uploadAsset(file).then((assetId) => {
          if (assetId) void studio.patchLayer(layer.id, { watermarkAssetId: assetId });
        });
      }} />
    </section>
  );
}

function SubtitlePanel({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const subtitle = layer.subtitle!;
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <button type="button" disabled={!studio.nan || !studio.project?.video || Boolean(studio.busy)} onClick={() => void studio.transcribe()} className="w-full text-xs py-2 rounded bg-primary/15 text-primary disabled:opacity-40">
        Transcribir el video
      </button>
      <NumberField label="Tamaño" value={subtitle.fontSize} min={10} max={96} onCommit={(fontSize) => void studio.patchLayer(layer.id, { subtitleStyle: { fontSize } })} />
      <div className="max-h-48 overflow-y-auto space-y-1">
        {subtitle.cues.map((cue) => (
          <div key={cue.id} className="text-[11px] text-white/70">{formatClock(cue.start)} {cue.text}</div>
        ))}
      </div>
    </section>
  );
}

function Appearance({ layer }: { layer: Layer }) {
  const studio = useStudio();
  return (
    <section className="space-y-2 border-t border-white/10 pt-3">
      <h3 className="text-[10px] uppercase tracking-wider text-white/40">Apariencia</h3>
      {layer.type !== 'live-badge' && (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Fondo" value={layer.background.colorA} fallback="#00d0f8" onCommit={(colorA) => void studio.patchLayer(layer.id, { background: { ...layer.background, type: 'solid', colorA } })} />
          <ColorField label="Detalle" value={layer.background.colorB} fallback="#041018" onCommit={(colorB) => void studio.patchLayer(layer.id, { background: { ...layer.background, type: 'solid', colorB } })} />
        </div>
      )}
      <NumberField label="Escala" value={layer.transform.scale} min={0.2} max={4} step={0.05} onCommit={(scale) => void studio.patchLayer(layer.id, { transform: { ...layer.transform, scale } })} />
      <NumberField label="Rotación" value={layer.transform.rotate} min={-180} max={180} onCommit={(rotate) => void studio.patchLayer(layer.id, { transform: { ...layer.transform, rotate } })} />
      <label className="block space-y-1 text-[10px] uppercase tracking-wider text-white/40">
        Animación
        <select value={layer.animation} onChange={(event) => void studio.patchLayer(layer.id, { animation: event.target.value as Layer['animation'] })} className={fieldClass}>
          <option value="none">Ninguna</option>
          <option value="pulse">Pulso</option>
          <option value="blink">Parpadeo</option>
          <option value="fade-in">Entrada</option>
          <option value="slide-in">Deslizar</option>
          <option value="spin">Rotar</option>
        </select>
      </label>
    </section>
  );
}

function TimeRange({ layer }: { layer: Layer }) {
  const studio = useStudio();
  const enabled = layer.timeRange != null;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-white/70">
        <input type="checkbox" checked={enabled} onChange={(event) => void studio.patchLayer(layer.id, { timeRange: event.target.checked ? { start: 0, end: studio.project?.duration || 10 } : null })} />
        Limitar al tiempo
      </label>
      {layer.timeRange && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Desde" value={layer.timeRange.start} min={0} max={36000} step={0.1} onCommit={(start) => void studio.patchLayer(layer.id, { timeRange: { ...layer.timeRange!, end: layer.timeRange!.end, start } })} />
          <NumberField label="Hasta" value={layer.timeRange.end} min={0} max={36000} step={0.1} onCommit={(end) => void studio.patchLayer(layer.id, { timeRange: { start: layer.timeRange!.start, end } })} />
        </div>
      )}
    </div>
  );
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }} className={fieldClass} />
    </label>
  );
}

function ColorField({ label, value, fallback, onCommit }: { label: string; value: string; fallback: string; onCommit: (value: string) => void }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/40">
      {label}
      <input aria-label={label} type="color" value={hex} onChange={(event) => onCommit(event.target.value)} className="h-7 w-10 rounded border border-white/10 bg-transparent" />
    </label>
  );
}

function NumberField({ label, value, min, max, step = 1, onCommit }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Math.min(max, Math.max(min, Number(draft)));
          if (Number.isFinite(next) && next !== value) onCommit(next);
        }}
        className={fieldClass}
      />
    </label>
  );
}
