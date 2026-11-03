import { join } from 'node:path';
import { TerrificError } from '../core/errors.ts';
import { isProjectId, newProjectId, type RandomSource } from '../core/ids.ts';
import { type LegacyWorkspace, pickLegacyWorkspaceId, sameProject } from '../core/project-path.ts';
import { isRecord, isString } from '../core/validate.ts';
import { dataPaths } from './data-root.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

export type ProjectInfo = {
  id: string;
  cwd: string;
  dir: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type ProjectEntry = {
  cwd: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type ProjectsIndex = {
  version: 1;
  projects: Record<string, ProjectEntry>;
};

export type ProjectFile = {
  version: 1;
  cwd: string;
  createdAt: string;
  lastOpenedAt: string;
};

type ProjectStoreOptions = {
  root: string;
  now: () => Date;
  random: RandomSource;
};

function isProjectEntry(value: unknown): value is ProjectEntry {
  return (
    isRecord(value) &&
    isString(value.cwd) &&
    isString(value.createdAt) &&
    isString(value.lastOpenedAt)
  );
}

function isProjectsIndex(value: unknown): value is ProjectsIndex {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.projects)) return false;
  for (const [id, entry] of Object.entries(value.projects)) {
    if (!isProjectId(id) || !isProjectEntry(entry)) return false;
  }
  return true;
}

function emptyIndex(): ProjectsIndex {
  return { version: 1, projects: {} };
}

function toInfo(id: string, entry: ProjectEntry, projectsDir: string): ProjectInfo {
  return { id, dir: join(projectsDir, id), ...entry };
}

function findByCwd(index: ProjectsIndex, cwd: string): string | null {
  for (const [id, entry] of Object.entries(index.projects)) {
    if (sameProject(cwd, entry.cwd)) return id;
  }
  return null;
}

type LegacyFile = { workspaces?: unknown };

function workspacesFromFile(value: LegacyFile): LegacyWorkspace[] {
  if (!isRecord(value.workspaces)) return [];
  const list: LegacyWorkspace[] = [];
  for (const item of Object.values(value.workspaces)) {
    if (!isRecord(item) || !isString(item.id) || !isString(item.path)) continue;
    const workspace: LegacyWorkspace = { id: item.id, path: item.path };
    if (isString(item.lastAccessedAt)) workspace.lastAccessedAt = item.lastAccessedAt;
    list.push(workspace);
  }
  return list;
}

function isLooseObject(value: unknown): value is LegacyFile {
  return isRecord(value);
}

export function createProjectStore(options: ProjectStoreOptions) {
  const paths = dataPaths(options.root);

  async function loadIndex(): Promise<ProjectsIndex> {
    const index = await readJsonFile(paths.projectsIndex, isProjectsIndex);
    return index ?? emptyIndex();
  }

  async function loadLegacyWorkspaces(): Promise<LegacyWorkspace[]> {
    try {
      const file = await readJsonFile(paths.legacyWorkspacesFile, isLooseObject);
      if (file === null) return [];
      return workspacesFromFile(file);
    } catch {
      // Missing is handled above; a malformed file is treated as no legacy ids.
      return [];
    }
  }

  async function persist(id: string, entry: ProjectEntry): Promise<ProjectInfo> {
    const index = await loadIndex();
    index.projects[id] = entry;
    const file: ProjectFile = { version: 1, ...entry };
    await writeJsonFile(paths.projectsIndex, index);
    await writeJsonFile(join(paths.projectsDir, id, 'project.json'), file);
    return toInfo(id, entry, paths.projectsDir);
  }

  function nextId(index: ProjectsIndex, preferred: string | null): string {
    if (preferred !== null) {
      const taken = index.projects[preferred];
      if (taken === undefined) return preferred;
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = newProjectId(options.random);
      if (index.projects[id] === undefined) return id;
    }
    throw new TerrificError('INTERNAL', 'Could not allocate a free project id.');
  }

  async function resolve(cwd: string): Promise<ProjectInfo> {
    const index = await loadIndex();
    const existing = findByCwd(index, cwd);
    const now = options.now().toISOString();
    if (existing !== null) {
      const entry = index.projects[existing];
      if (entry === undefined) {
        throw new TerrificError('INTERNAL', 'Project index entry disappeared.');
      }
      return persist(existing, { ...entry, cwd, lastOpenedAt: now });
    }
    const preferred = pickLegacyWorkspaceId(cwd, await loadLegacyWorkspaces());
    const reused = preferred !== null && isProjectId(preferred) ? preferred : null;
    const taken = reused !== null ? index.projects[reused] : undefined;
    const collision = taken !== undefined && !sameProject(taken.cwd, cwd);
    const id = nextId(index, collision ? null : reused);
    return persist(id, { cwd, createdAt: now, lastOpenedAt: now });
  }

  async function list(): Promise<ProjectInfo[]> {
    const index = await loadIndex();
    return Object.entries(index.projects)
      .map(([id, entry]) => toInfo(id, entry, paths.projectsDir))
      .sort((a, b) => {
        if (a.lastOpenedAt !== b.lastOpenedAt) return a.lastOpenedAt < b.lastOpenedAt ? 1 : -1;
        return a.id < b.id ? -1 : 1;
      });
  }

  async function get(id: string): Promise<ProjectInfo> {
    const index = await loadIndex();
    const entry = index.projects[id];
    if (entry === undefined) {
      throw new TerrificError('NOT_FOUND', `Project "${id}" was not found.`);
    }
    return toInfo(id, entry, paths.projectsDir);
  }

  return { resolve, list, get };
}
