import { type ConnectedDaemon, connectDaemon } from '../client/connect.ts';
import type { ProjectView } from '../core/api.ts';
import { resolveDataRoot } from '../core/data-root.ts';
import type { CliIo } from './io.ts';

export type CliContext = {
  io: CliIo;
  dataRoot: string;
  connect(): Promise<ConnectedDaemon>;
  project(): Promise<ProjectView>;
};

export function createCliContext(io: CliIo): CliContext {
  const dataRoot = resolveDataRoot({
    env: io.env,
    platform: io.platform,
    homedir: io.homedir,
  });
  let connected: ConnectedDaemon | undefined;
  let project: ProjectView | undefined;
  return {
    io,
    dataRoot,
    async connect() {
      if (connected !== undefined) return connected;
      connected = await connectDaemon({ dataRoot, env: io.env, autoStart: true });
      return connected;
    },
    async project() {
      if (project !== undefined) return project;
      const { client } = await this.connect();
      project = await client.resolveProject({ cwd: io.cwd });
      return project;
    },
  };
}
