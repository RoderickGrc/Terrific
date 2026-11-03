import { join } from 'node:path';

export type DataRootInput = {
  env: Record<string, string | undefined>;
  platform: string;
  homedir: string;
};

export type DataPaths = {
  daemonFile: string;
  daemonLog: string;
  tokenFile: string;
  configFile: string;
  projectsIndex: string;
  projectsDir: string;
  legacySessionsDir: string;
  legacyWorkspacesFile: string;
};

export function resolveDataRoot(input: DataRootInput): string {
  const home = input.env.TERRIFIC_HOME;
  if (home !== undefined && home !== '') return home;
  if (input.platform === 'win32') return join(input.homedir, 'Documents', '.terrific');
  return join(input.homedir, '.terrific');
}

export function dataPaths(root: string): DataPaths {
  return {
    daemonFile: join(root, 'daemon.json'),
    daemonLog: join(root, 'daemon.log'),
    tokenFile: join(root, 'token'),
    configFile: join(root, 'config.json'),
    projectsIndex: join(root, 'projects.json'),
    projectsDir: join(root, 'projects'),
    legacySessionsDir: join(root, 'sessions'),
    legacyWorkspacesFile: join(root, 'workspaces.json'),
  };
}
