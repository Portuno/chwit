import { buildLutFilter, isLayerActiveAt } from '@chiwt/schema';
import { useState, useRef } from 'react';
import { Pause, Play, Square, Upload } from 'lucide-react';
import { LayerMenu, type LayerDraft } from '@/components/LayerMenu';
import { LayerView } from '@/components/LayerView';
import { formatClock } from '@/lib/format';
import { apiUrl } from '@/lib/api';
import { exportVideo } from '@/lib/exporter';
import { useStudio } from '@/lib/store';

export function VideoCanvas() {
  const studio = useStudio();
  const project = studio.project!;
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState<{ layerId: string; x: number; y: number; draft: LayerDraft } | null>(null);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);
  const menuLayer = project.layers.find((layer) => layer.id === menu?.layerId);
  const activeLuts = project.layers.filter((layer) => layer.type === 'lut' && layer.lut && isLayerActiveAt(layer, studio.currentTime));
  const filter = activeLuts.length ? activeLuts.map((layer) => buildLutFilter(layer.lut!, layer.opacity / 100)).join(' ') : 'none';

  const seek = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    studio.setCurrentTime(time);
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const startExport = () => {
    const video = videoRef.current;
    if (!video || exporting) return;
    try {
      const handle = exportVideo(video, project.layers, project.duration, studio.playbackRate, (assetId) => apiUrl(`/api/projects/${project.id}/assets/${assetId}`), setProgress);
      cancelRef.current = handle;
      setExporting(true);
      void handle.done.finally(() => {
        setExporting(false);
        cancelRef.current = null;
      });
    } catch (error) {
      studio.setCurrentTime(video.currentTime);
      alert(error instanceof Error ? error.message : 'No se pudo exportar.');
    }
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div
        className="flex-1 min-h-0 min-w-0 bg-black p-4 overflow-hidden grid place-items-center"
        style={{ containerType: 'size' }}
      >
        <div
          ref={frameRef}
          className="relative bg-black mx-auto"
          style={{ aspectRatio: aspect, width: `min(100cqw, calc(100cqh * ${aspect}))`, height: `min(100cqh, calc(100cqw / ${aspect}))` }}
        >
          {project.video ? (
            <video
              key={project.videoToken}
              ref={videoRef}
              src={apiUrl(`/api/projects/${project.id}/video`)}
              crossOrigin="anonymous"
              className="w-full h-full bg-black"
              style={{ filter }}
              playsInline
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
              }}
              onTimeUpdate={(event) => studio.setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="w-[min(100%,960px)] aspect-video grid place-items-center text-white/50 border border-dashed border-white/15 rounded-lg">
              <span className="flex flex-col items-center gap-1 text-sm"><span className="flex items-center gap-2"><Upload size={16} /> Soltá el video en bruto</span><span className="text-[11px] text-white/35">El audio y el sonido también se sueltan sobre el proyecto</span></span>
            </button>
          )}
          {project.layers.map((layer) => (
            <LayerView
              key={layer.id}
              layer={layer}
              projectId={project.id}
              currentTime={studio.currentTime}
              selected={studio.selectedLayerId === layer.id}
              frameRef={frameRef}
              onSelect={() => studio.setSelectedLayerId(layer.id)}
              onMove={(position) => void studio.moveLayer(layer.id, position)}
              onResize={(box) => {
                setMenu((current) => current?.layerId === layer.id ? { ...current, draft: { ...current.draft, size: { width: box.width, height: box.height } } } : current);
                void studio.commitLayer(layer.id, { position: { x: box.x, y: box.y }, size: { width: box.width, height: box.height } });
              }}
              preview={menu?.layerId === layer.id ? menu.draft : null}
              onOpenMenu={(point) => setMenu({ layerId: layer.id, ...point, draft: { size: { ...layer.size }, rotate: layer.transform.rotate } })}
            />
          ))}
        </div>
        {menuLayer && menu && (
          <LayerMenu
            layer={menuLayer}
            point={menu}
            draft={menu.draft}
            onDraft={(draft) => setMenu((current) => current ? { ...current, draft } : current)}
            onCommit={(draft) => {
              const sameSize = draft.size.width === menuLayer.size.width && draft.size.height === menuLayer.size.height;
              const sameRotate = draft.rotate === menuLayer.transform.rotate;
              if (sameSize && sameRotate) return;
              void studio.commitLayer(menuLayer.id, {
                size: draft.size,
                transform: { scale: menuLayer.transform.scale, rotate: draft.rotate },
              });
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
      <div className="h-14 shrink-0 border-t border-border px-4 flex items-center gap-3 bg-[#0a0a0b]">
        <button type="button" onClick={toggle} disabled={!project.video || exporting} className="w-8 h-8 grid place-items-center rounded-md bg-white/5 disabled:opacity-30">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          aria-label="Tiempo"
          type="range"
          min={0}
          max={project.duration || 0}
          step={0.01}
          value={Math.min(studio.currentTime, project.duration || 0)}
          disabled={!project.video}
          onChange={(event) => seek(Number(event.target.value))}
          className="flex-1 accent-cyan-400"
        />
        <span className="text-xs tabular-nums text-white/60 w-24 text-right">{formatClock(studio.currentTime)} / {formatClock(project.duration)}</span>
        <select aria-label="Velocidad" value={studio.playbackRate} onChange={(event) => {
          const rate = Number(event.target.value);
          studio.setPlaybackRate(rate);
          if (videoRef.current) videoRef.current.playbackRate = rate;
        }} className="bg-black border border-white/10 rounded px-2 py-1 text-xs">
          {[0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        {exporting ? (
          <button type="button" onClick={() => cancelRef.current?.cancel()} className="text-xs px-3 py-1.5 rounded bg-red-500/20 text-red-200 flex items-center gap-1">
            <Square size={12} /> {Math.round(progress)}%
          </button>
        ) : (
          <button type="button" onClick={startExport} disabled={!project.video} className="text-xs px-3 py-1.5 rounded bg-primary/20 text-primary disabled:opacity-30">Exportar</button>
        )}
        <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-msvideo,.mkv,.avi" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void studio.uploadVideo(file);
          event.target.value = '';
        }} />
      </div>
      {(studio.notice || studio.error || studio.busy) && (
        <div className={`px-4 py-1.5 text-xs border-t border-border ${studio.error ? 'text-red-300' : 'text-white/60'}`}>
          {studio.busy ?? studio.error ?? studio.notice}
        </div>
      )}
    </div>
  );
}
