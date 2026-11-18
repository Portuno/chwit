import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Project } from '@chiwt/schema';
import { projectSchema } from '@chiwt/schema';
import { HttpError } from './http.js';

export type ProjectEvent = { type: 'project'; project: Project } | { type: 'ping' };

type Listener = (data: string) => void;

export class ProjectStore {
  private tails = new Map<string, Promise<unknown>>();
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly root: string) {}

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  dir(id: string): string {
    this.assertId(id);
    return path.join(this.root, id);
  }

  private assertId(id: string): void {
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, 'Identificador inválido.');
  }

  private queue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tails.set(id, run.then(() => undefined, () => undefined));
    return run;
  }

  private emit(id: string, project: Project): void {
    const data = JSON.stringify({ type: 'project', project });
    for (const listener of this.listeners.get(id) ?? []) listener(data);
  }

  subscribe(id: string, listener: Listener): () => void {
    this.assertId(id);
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => set.delete(listener);
  }

  async create(name: string): Promise<Project> {
    await this.init();
    const now = new Date().toISOString();
    const project: Project = {
      version: 1,
      id: crypto.randomUUID(),
      name: name.trim() || 'Sin título',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      duration: 0,
      videoToken: crypto.randomUUID(),
      video: null,
      assets: {},
      transcript: null,
      layers: [],
    };
    await mkdir(this.dir(project.id), { recursive: true });
    await this.write(project);
    return project;
  }

  async list(): Promise<{ id: string; name: string; revision: number; updatedAt: string; duration: number; hasVideo: boolean }[]> {
    await this.init();
    const entries = await readFileSafeDir(this.root);
    const projects = [];
    for (const entry of entries) {
      try {
        const project = await this.read(entry);
        projects.push({
          id: project.id,
          name: project.name,
          revision: project.revision,
          updatedAt: project.updatedAt,
          duration: project.duration,
          hasVideo: project.video != null,
        });
      } catch {
        continue;
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async read(id: string): Promise<Project> {
    try {
      const raw = await readFile(path.join(this.dir(id), 'project.json'), 'utf8');
      return projectSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'No existe ese proyecto.');
      throw error;
    }
  }

  async update(id: string, mutator: (project: Project) => void | Promise<void>): Promise<Project> {
    return this.queue(id, async () => {
      const project = await this.read(id);
      await mutator(project);
      project.revision += 1;
      project.updatedAt = new Date().toISOString();
      const parsed = projectSchema.parse(project);
      await this.write(parsed);
      this.emit(id, parsed);
      return parsed;
    });
  }

  async remove(id: string): Promise<void> {
    return this.queue(id, async () => {
      await rm(this.dir(id), { recursive: true, force: true });
    });
  }

  private async write(project: Project): Promise<void> {
    const dest = path.join(this.dir(project.id), 'project.json');
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(project, null, 2));
    await rename(tmp, dest);
  }
}

async function readFileSafeDir(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
