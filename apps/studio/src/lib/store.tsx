import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AlertInput, LayerPatch, LayerType, LutData, ManualMessageInput, Project, SectorInput, SectorPatch } from '@chiwt/schema';
import { api, apiUrl, mediaKind } from './api';

type Summary = { id: string; name: string; revision: number; updatedAt: string; duration: number; hasVideo: boolean };

type StudioValue = {
  ready: boolean;
  nan: boolean;
  project: Project | null;
  projects: Summary[];
  selectedLayerId: string | null;
  setSelectedLayerId: (id: string | null) => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  busy: string | null;
  notice: string | null;
  error: string | null;
  openProject: (id: string) => Promise<void>;
  createProject: () => Promise<void>;
  deleteProject: () => Promise<void>;
  uploadVideo: (file: File) => Promise<void>;
  ingestFiles: (files: File[]) => Promise<void>;
  renameVideo: (name: string) => Promise<void>;
  renameAsset: (assetId: string, name: string) => Promise<void>;
  uploadAsset: (file: File) => Promise<string | undefined>;
  removeAsset: (assetId: string) => Promise<void>;
  useAssetAsVideo: (assetId: string) => Promise<void>;
  linkLogo: (body: { assetId?: string; start?: number; end?: number | null; spin?: boolean; rotate?: number }) => Promise<void>;
  addLayer: (type: LayerType) => Promise<void>;
  patchLayer: (layerId: string, patch: LayerPatch) => Promise<void>;
  moveLayer: (layerId: string, position: { x: number; y: number }) => Promise<void>;
  commitLayer: (layerId: string, patch: LayerPatch) => Promise<void>;
  removeLayer: (layerId: string) => Promise<void>;
  addMessages: (layerId: string, messages: ManualMessageInput[]) => Promise<void>;
  patchMessage: (layerId: string, messageId: string, patch: { text?: string; username?: string; color?: string; t?: number; locked?: boolean }) => Promise<void>;
  removeMessage: (layerId: string, messageId: string) => Promise<void>;
  addSector: (layerId: string, sector: SectorInput) => Promise<void>;
  patchSector: (layerId: string, sectorId: string, patch: SectorPatch) => Promise<void>;
  removeSector: (layerId: string, sectorId: string) => Promise<void>;
  generateChat: (layerId: string, body: { sectorId?: string; instruction?: string }) => Promise<void>;
  scheduleAlerts: (layerId: string, events: AlertInput[], mode?: 'append' | 'replace') => Promise<void>;
  removeAlert: (layerId: string, eventId: string) => Promise<void>;
  generateAlerts: (layerId: string, instruction?: string) => Promise<void>;
  setCues: (layerId: string, cues: { id?: string; text: string; start: number; end: number }[]) => Promise<void>;
  transcribe: () => Promise<void>;
  applyPrompt: (prompt: string, history?: { role: 'user' | 'agent'; text: string }[]) => Promise<string | null>;
  applyLivestream: (body?: { lut?: LutData['preset']; ratePerMinute?: number; instruction?: string }) => Promise<void>;
};

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [nan, setNan] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const projectId = project?.id;

  const commit = useCallback((next: Project) => {
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setProject(next);
  }, []);

  const refreshList = useCallback(async () => {
    const { projects: next } = await api.list();
    setProjects(next);
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<{ project: Project; message?: string } | void>) => {
    setBusy(label);
    setError(null);
    try {
      const result = await fn();
      if (result?.project) commit(result.project);
      setNotice(result?.message ?? null);
      return result;
    } catch (caught) {
      setNotice(null);
      setError(caught instanceof Error ? caught.message : 'No se pudo completar.');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const health = await api.health();
        if (cancelled) return;
        setNan(health.nan);
        const { projects: list } = await api.list();
        if (cancelled) return;
        setProjects(list);
        const wanted = new URLSearchParams(location.search).get('project');
        const existing = list.find((item) => item.id === wanted) ?? list[0];
        const next = existing ? (await api.get(existing.id)).project : (await api.create('Sin título')).project;
        if (cancelled) return;
        if (!existing) setProjects((current) => [summarize(next), ...current]);
        revision.current = next.revision;
        setProject(next);
        const url = new URL(location.href);
        url.searchParams.set('project', next.id);
        history.replaceState(null, '', url);
        setReady(true);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'No se pudo abrir Chiwt.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(apiUrl(`/api/projects/${projectId}/events`));
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; project?: Project; error?: string };
      if (data.type === 'project' && data.project) commit(data.project);
      if (data.type === 'error' && data.error) setError(data.error);
    };
    return () => source.close();
  }, [projectId, commit]);

  useEffect(() => {
    if (selectedLayerId && project && !project.layers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(null);
    }
  }, [project, selectedLayerId]);

  const value = useMemo<StudioValue>(() => ({
    ready, nan, project, projects, selectedLayerId, setSelectedLayerId, currentTime, setCurrentTime,
    playbackRate, setPlaybackRate, busy, notice, error,
    openProject: async (id) => {
      revision.current = 0;
      const { project: next } = await api.get(id);
      commit(next);
      setSelectedLayerId(null);
      setCurrentTime(0);
      const url = new URL(location.href);
      url.searchParams.set('project', id);
      history.replaceState(null, '', url);
    },
    createProject: async () => {
      await run('Creando proyecto', async () => {
        const result = await api.create('Sin título');
        await refreshList();
        revision.current = result.project.revision;
        const url = new URL(location.href);
        url.searchParams.set('project', result.project.id);
        history.replaceState(null, '', url);
        setSelectedLayerId(null);
        setCurrentTime(0);
        return result;
      });
    },
    deleteProject: async () => {
      if (!project) return;
      const id = project.id;
      setBusy('Borrando');
      try {
        await api.remove(id);
        const { projects: list } = await api.list();
        setProjects(list);
        const next = list[0] ? (await api.get(list[0].id)).project : (await api.create('Sin título')).project;
        if (!list[0]) setProjects([summarize(next)]);
        revision.current = next.revision;
        setProject(next);
        setSelectedLayerId(null);
        const url = new URL(location.href);
        url.searchParams.set('project', next.id);
        history.replaceState(null, '', url);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudo borrar.');
      } finally {
        setBusy(null);
      }
    },
    uploadVideo: (file) => run('Subiendo video', () => api.uploadVideo(project!.id, file, (percent) => setBusy(`Subiendo video ${percent}%`))),
    ingestFiles: async (files) => {
      if (!project) return;
      const accepted = files.filter((file) => mediaKind(file));
      if (!accepted.length) {
        setError('Soltá un video, un audio o un sonido.');
        return;
      }
      const id = project.id;
      let hasVideo = project.video != null;
      setError(null);
      try {
        for (const file of accepted) {
          const kind = mediaKind(file);
          if (kind === 'video' && !hasVideo) {
            setBusy('Subiendo video 0%');
            const result = await api.uploadVideo(id, file, (percent) => setBusy(`Subiendo video ${percent}%`));
            commit(result.project);
            hasVideo = true;
            setNotice(result.message ?? 'Video cargado.');
          } else {
            setBusy('Incorporando 0%');
            const result = await api.uploadAsset(id, file, (percent) => setBusy(`Incorporando ${percent}%`));
            commit(result.project);
            setNotice(result.message ?? 'Archivo incorporado al proyecto.');
          }
        }
        await refreshList();
      } catch (caught) {
        setNotice(null);
        setError(caught instanceof Error ? caught.message : 'No se pudo incorporar el archivo.');
      } finally {
        setBusy(null);
      }
    },
    renameVideo: (name) => run('Guardando nombre', () => api.renameVideo(project!.id, name)),
    renameAsset: (assetId, name) => run('Guardando nombre', () => api.renameAsset(project!.id, assetId, name)),
    uploadAsset: async (file) => {
      if (!project) return;
      setBusy('Incorporando 0%');
      setError(null);
      try {
        const result = await api.uploadAsset(project.id, file, (percent) => setBusy(`Incorporando ${percent}%`));
        commit(result.project);
        setNotice(result.message ?? 'Archivo incorporado al proyecto.');
        return result.assetId;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudo incorporar el archivo.');
      } finally {
        setBusy(null);
      }
    },
    removeAsset: (assetId) => run('Quitando archivo', () => api.removeAsset(project!.id, assetId)),
    useAssetAsVideo: (assetId) => run('Usando el video', () => api.useAssetAsVideo(project!.id, assetId)),
    linkLogo: (body) => run('Vinculando logo', async () => {
      const result = await api.linkLogo(project!.id, body);
      const logo = result.project.layers.find((layer) => layer.type === 'watermark');
      if (logo) setSelectedLayerId(logo.id);
      return result;
    }),
    addLayer: (type) => run('Agregando capa', async () => {
      const result = await api.addLayer(project!.id, type);
      const created = result.project.layers.at(-1);
      if (created) setSelectedLayerId(created.id);
      return result;
    }),
    patchLayer: (layerId, patch) => run('Guardando', () => api.patchLayer(project!.id, layerId, patch)),
    moveLayer: async (layerId, position) => {
      if (!project) return;
      try {
        const result = await api.patchLayer(project.id, layerId, { position });
        commit(result.project);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudo mover la capa.');
      }
    },
    commitLayer: async (layerId, patch) => {
      if (!project) return;
      try {
        const result = await api.patchLayer(project.id, layerId, patch);
        commit(result.project);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudo guardar la capa.');
      }
    },
    removeLayer: (layerId) => run('Eliminando', () => api.removeLayer(project!.id, layerId)),
    addMessages: (layerId, messages) => run('Agregando mensaje', () => api.addMessages(project!.id, layerId, messages)),
    patchMessage: async (layerId, messageId, patch) => {
      if (!project) return;
      try {
        const result = await api.patchMessage(project.id, layerId, messageId, patch);
        commit(result.project);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudo guardar el comentario.');
      }
    },
    removeMessage: (layerId, messageId) => run('Eliminando mensaje', () => api.removeMessage(project!.id, layerId, messageId)),
    addSector: (layerId, sector) => run('Creando sector', () => api.addSector(project!.id, layerId, sector)),
    patchSector: (layerId, sectorId, patch) => run('Guardando sector', () => api.patchSector(project!.id, layerId, sectorId, patch)),
    removeSector: (layerId, sectorId) => run('Eliminando sector', () => api.removeSector(project!.id, layerId, sectorId)),
    generateChat: (layerId, body) => run('Generando chat', () => api.generateChat(project!.id, layerId, body)),
    scheduleAlerts: (layerId, events, mode = 'append') => run('Programando alertas', () => api.scheduleAlerts(project!.id, layerId, events, mode)),
    removeAlert: (layerId, eventId) => run('Eliminando alerta', () => api.removeAlert(project!.id, layerId, eventId)),
    generateAlerts: (layerId, instruction) => run('Generando alertas', () => api.generateAlerts(project!.id, layerId, { instruction, count: 6 })),
    setCues: (layerId, cues) => run('Guardando subtítulos', () => api.setCues(project!.id, layerId, cues)),
    transcribe: () => run('Transcribiendo', () => api.transcribe(project!.id)),
    applyPrompt: async (prompt, history = []) => {
      const result = await run('Aplicando pedido', () => api.prompt(project!.id, prompt, history));
      return result?.message ?? null;
    },
    applyLivestream: (body) => run('Armando livestream', () => api.livestream(project!.id, body ?? {})),
  }), [ready, nan, project, projects, selectedLayerId, currentTime, playbackRate, busy, notice, error, commit, refreshList, run]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

function summarize(project: Project): Summary {
  return {
    id: project.id,
    name: project.name,
    revision: project.revision,
    updatedAt: project.updatedAt,
    duration: project.duration,
    hasVideo: project.video != null,
  };
}

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio tiene que usarse dentro del estudio.');
  return value;
}
