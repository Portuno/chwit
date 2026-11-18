import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/lib/store';

type Line = { id: string; role: 'user' | 'agent'; text: string };

export function AgentBar() {
  const studio = useStudio();
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>([{
    id: 'hola',
    role: 'agent',
    text: 'Pedime un cambio y lo hago en el video: el número del vivo, el logo, el chat, un color.',
  }]);
  const scroller = useRef<HTMLDivElement>(null);
  const disabled = !prompt.trim() || Boolean(studio.busy) || !studio.nan;

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines, studio.busy]);

  const send = () => {
    const value = prompt.trim();
    if (!value || disabled) return;
    const prior = lines.slice(-8).map((line) => ({ role: line.role, text: line.text }));
    setPrompt('');
    setLines((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: value }]);
    void studio.applyPrompt(value, prior).then((reply) => {
      setLines((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'agent',
        text: reply || studio.error || 'No pude aplicar eso.',
      }]);
    });
  };

  return (
    <section className="h-60 shrink-0 border-t border-border bg-[#0a0a0b] flex flex-col">
      <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.16em] text-white/35">Chiwt</div>
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-4 space-y-2">
        {lines.map((line) => (
          <div key={line.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${line.role === 'user' ? 'ml-auto bg-primary/15 text-primary' : 'bg-white/5 text-white/85'}`}>
            {line.text}
          </div>
        ))}
        {studio.busy && <div className="text-xs text-white/40">Estoy en eso…</div>}
      </div>
      <form
        className="px-3 py-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={Boolean(studio.busy)}
          placeholder={studio.nan ? 'Subí el vivo a 80 mil, o mové el logo…' : 'Falta NAN_API_KEY para hablar. El editado manual sigue disponible.'}
          className="flex-1 bg-[#111113] border border-white/10 rounded-full px-4 py-2 text-sm outline-none focus:border-primary/60"
        />
        <button type="submit" disabled={disabled} className="px-4 rounded-full bg-primary/20 text-primary text-sm disabled:opacity-40">Enviar</button>
      </form>
    </section>
  );
}
