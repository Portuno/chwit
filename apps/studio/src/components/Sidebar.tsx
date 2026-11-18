import type { LayerType } from '@chiwt/schema';
import { Bell, Captions, Filter, Image, Layers, MessageSquare, QrCode, Radio, Trash2, Type, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/lib/store';

const OPTIONS: { type: LayerType; label: string; icon: typeof Radio }[] = [
  { type: 'live-badge', label: 'En vivo', icon: Radio },
  { type: 'chat', label: 'Chat', icon: MessageSquare },
  { type: 'alert', label: 'Alerta', icon: Bell },
  { type: 'lower-third', label: 'Zócalo', icon: Type },
  { type: 'watermark', label: 'Logo', icon: Image },
  { type: 'qr', label: 'QR', icon: QrCode },
  { type: 'lut', label: 'LUT', icon: Filter },
  { type: 'subtitle', label: 'Subtítulos', icon: Captions },
];

export function Sidebar() {
  const studio = useStudio();
  const project = studio.project!;
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const assets = Object.entries(project.assets);

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-[#0a0a0b] flex flex-col">
      <div className="h-14 px-4 flex items-center gap-2 border-b border-border">
        <Layers size={18} className="text-primary" />
        <div className="min-w-0">
          <div className="font-bold leading-none">Chiwt</div>
          <div className="text-[11px] text-white/40 truncate">{project.name}</div>
        </div>
      </div>
      <div className="p-3 border-b border-border space-y-2">
        <select aria-label="Proyecto" value={project.id} onChange={(event) => void studio.openProject(event.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-xs">
          {studio.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={() => void studio.createProject()} className="flex-1 text-[11px] py-1.5 rounded bg-white/5">Nuevo</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex-1 text-[11px] py-1.5 rounded bg-white/5 inline-flex items-center justify-center gap-1"><Upload size={12} /> Video</button>
          <button type="button" onClick={() => void studio.deleteProject()} className="text-[11px] px-2 rounded bg-white/5 text-white/50"><Trash2 size={12} /></button>
        </div>
        <button type="button" onClick={() => void studio.applyLivestream({ lut: 'cyberpunk', ratePerMinute: 16, instruction: 'público reaccionando a la escena como si fuera un livestream' })} className="w-full text-[11px] py-2 rounded bg-primary/15 text-primary font-semibold">
          Vestir como livestream
        </button>
        {project.video && (
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-white/35">Video de la línea</span>
            <NameField label="Nombre del video" value={project.video.fileName} onCommit={(name) => void studio.renameVideo(name)} />
          </label>
        )}
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void studio.uploadVideo(file);
          event.target.value = '';
        }} />
      </div>
      <div className="p-3 grid grid-cols-4 gap-1.5 border-b border-border">
        {OPTIONS.map((option) => (
          <button key={option.type} type="button" onClick={() => void studio.addLayer(option.type)} className="flex flex-col items-center gap-1 py-2 rounded bg-white/5 text-[9px] text-white/75">
            <option.icon size={14} />
            {option.label}
          </button>
        ))}
      </div>
      <div className="border-b border-border">
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-white/35">Incorporados</span>
          <button type="button" onClick={() => mediaRef.current?.click()} className="text-[11px] text-primary">Incorporar</button>
        </div>
        <div className="px-2 pb-2 max-h-40 overflow-y-auto space-y-1">
          {assets.length === 0 && <div className="text-[11px] text-white/30 px-2 py-2">Video, imagen o audio de este proyecto.</div>}
          {assets.map(([id, asset]) => (
            <div key={id} className="flex items-center gap-1 px-2 py-1.5 rounded bg-white/5">
              <span className="text-[9px] uppercase tracking-wide text-white/35 w-10 shrink-0">{asset.kind === 'image' ? 'img' : asset.kind === 'audio' ? 'audio' : 'video'}</span>
              {asset.kind === 'video'
                ? <NameField label={`Nombre de ${asset.name}`} value={asset.name} onCommit={(name) => void studio.renameAsset(id, name)} />
                : <span className="text-[11px] truncate flex-1" title={asset.name}>{asset.name}</span>}
              {asset.kind === 'image' && <button type="button" className="text-[10px] text-primary shrink-0" onClick={() => void studio.linkLogo({ assetId: id })}>Logo</button>}
              {asset.kind === 'video' && <button type="button" className="text-[10px] text-primary shrink-0" onClick={() => void studio.useAssetAsVideo(id)}>Línea</button>}
              <button type="button" className="text-[10px] text-white/40 shrink-0" onClick={() => void studio.removeAsset(id)} aria-label={`Quitar ${asset.name}`}>×</button>
            </div>
          ))}
        </div>
        <input ref={mediaRef} type="file" multiple accept="image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mkv,.avi,.m4v,.mpg,.mpeg,.ts,.mts,.m2ts,.wmv,.flv,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aiff,.aif,.opus" className="hidden" onChange={(event) => {
          const files = [...event.target.files ?? []];
          event.target.value = '';
          if (files.length) void studio.ingestFiles(files);
        }} />
      </div>
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/35">Capas</div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {project.layers.length === 0 && <div className="text-xs text-white/30 px-2 py-4 text-center">Todavía no hay capas.</div>}
        {project.layers.map((layer) => {
          const option = OPTIONS.find((item) => item.type === layer.type);
          const Icon = option?.icon ?? Layers;
          const selected = studio.selectedLayerId === layer.id;
          return (
            <button key={layer.id} type="button" onClick={() => studio.setSelectedLayerId(layer.id)} className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm ${selected ? 'bg-primary/15 text-primary' : 'text-white/75 hover:bg-white/5'}`}>
              <Icon size={14} />
              <span className="truncate flex-1">{layer.name}</span>
              {!layer.visible && <span className="text-[10px] text-white/30">oculta</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function NameField({ label, value, onCommit }: { label: string; value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = (raw: string) => {
    const next = raw.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    setDraft(next);
    onCommit(next);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      onFocus={() => { focused.current = true; }}
      onBlur={(event) => {
        focused.current = false;
        commit(event.currentTarget.value);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(event.currentTarget.value);
        event.currentTarget.blur();
      }}
      className="min-w-0 flex-1 bg-black border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-primary/50"
    />
  );
}
