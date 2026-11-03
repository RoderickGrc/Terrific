function stripTrailingSeps(path: string): string {
  let end = path.length;
  while (end > 0) {
    const char = path[end - 1];
    if (char !== '/' && char !== '\\') break;
    end -= 1;
  }
  return path.slice(0, end);
}

function stripTrailingTerrific(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('/.terrific') || lower.endsWith('\\.terrific')) {
    return stripTrailingSeps(path.slice(0, path.length - '/.terrific'.length));
  }
  return path;
}

export function normalizeProjectPath(path: string): string {
  const stripped = stripTrailingTerrific(stripTrailingSeps(path));
  return stripped.replaceAll('\\', '/').toLowerCase();
}

export function sameProject(a: string, b: string): boolean {
  return normalizeProjectPath(a) === normalizeProjectPath(b);
}

export type LegacyWorkspace = {
  id: string;
  path: string;
  lastAccessedAt?: string;
};

export function pickLegacyWorkspaceId(
  cwd: string,
  workspaces: readonly LegacyWorkspace[],
): string | null {
  let bestId: string | null = null;
  let bestAt = '';
  for (const workspace of workspaces) {
    if (!sameProject(cwd, workspace.path)) continue;
    // ISO timestamps compare correctly as strings; a missing one counts as the oldest.
    const at = workspace.lastAccessedAt ?? '';
    if (bestId === null || at > bestAt) {
      bestId = workspace.id;
      bestAt = at;
    }
  }
  return bestId;
}
