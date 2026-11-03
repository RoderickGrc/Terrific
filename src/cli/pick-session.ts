import type { SessionView } from '../core/api.ts';
import { TerrificError } from '../core/errors.ts';
import type { CliContext } from './context.ts';

export async function runningInProject(ctx: CliContext): Promise<SessionView[]> {
  const project = await ctx.project();
  const { client } = await ctx.connect();
  const status = await client.status();
  return status.sessions.filter((session) => session.projectId === project.id);
}

export async function resolveRunningId(ctx: CliContext, id: string | undefined): Promise<string> {
  if (id !== undefined && id !== '') return id;
  const running = await runningInProject(ctx);
  if (running.length === 1) {
    const only = running[0];
    if (only !== undefined) return only.id;
  }
  if (running.length === 0) {
    throw new TerrificError(
      'USAGE',
      'No running session in this project. Pass an id or start one.',
    );
  }
  const ids = running.map((session) => session.id).join(', ');
  throw new TerrificError('USAGE', `Several running sessions: ${ids}. Pass an id.`);
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}
