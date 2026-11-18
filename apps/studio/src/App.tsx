import { useRef, useState } from 'react';
import { StudioProvider, useStudio } from '@/lib/store';
import { AgentBar } from '@/components/AgentBar';
import { Inspector } from '@/components/Inspector';
import { Sidebar } from '@/components/Sidebar';
import { VideoCanvas } from '@/components/VideoCanvas';

export function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}

function Shell() {
  const studio = useStudio();
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  if (!studio.ready) {
    return <div className="h-dvh grid place-items-center text-sm text-white/50">{studio.error ?? 'Abriendo Chiwt…'}</div>;
  }
  return (
    <div
      className="h-dvh w-screen flex overflow-hidden bg-[#050505] text-foreground relative"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length) void studio.ingestFiles(files);
      }}
    >
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <VideoCanvas />
        <AgentBar />
      </div>
      <Inspector />
      {over && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/75 pointer-events-none">
          <div className="px-6 py-4 rounded-lg border border-dashed border-primary text-sm text-primary">
            Soltá video, audio o sonido para sumarlo al proyecto
          </div>
        </div>
      )}
    </div>
  );
}
