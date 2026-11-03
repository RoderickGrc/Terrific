import { equal } from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const LAYERS = new Set(['core', 'store', 'recorder', 'daemon', 'client', 'cli', 'tui']);
// Imports inside the same layer are always allowed; this lists the other layers each may use.
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  store: ['core'],
  recorder: ['core'],
  daemon: ['core', 'store', 'recorder'],
  client: ['core'],
  cli: ['core', 'client'],
  tui: ['core', 'client'],
  bin: ['cli', 'tui'],
};

function layerOf(rel: string): string | null {
  const posix = rel.replaceAll('\\', '/');
  if (posix === 'bin.ts' || posix === 'bin') return 'bin';
  const top = posix.split('/')[0];
  return top && LAYERS.has(top) ? top : null;
}

function specifiers(source: string): { spec: string; dynamic: boolean }[] {
  // Covers `import x from`, `export { x } from` (re-exports could bypass the rule),
  // side-effect `import 'x'`, and dynamic `import('x')`.
  const pattern = /\b(?:from|import)\s*(\()?\s*['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((m) => ({ spec: m[2] ?? '', dynamic: m[1] === '(' }));
}

function forbiddenEdges(files: Map<string, string>): string[] {
  const edges: string[] = [];
  for (const [file, source] of files) {
    const from = layerOf(file);
    if (!from) continue;
    for (const { spec, dynamic } of specifiers(source)) {
      if (spec.startsWith('node:') || !spec.startsWith('.')) continue;
      const destRel = relative('src', resolve('src', dirname(file), spec)).replaceAll('\\', '/');
      const dest = layerOf(destRel);
      if (!dest) continue;
      const allowed = ALLOWED[from] ?? [];
      const sameLayer = dest === from && from !== 'bin';
      if ((!sameLayer && !allowed.includes(dest)) || (from === 'bin' && !dynamic)) {
        edges.push(`src/${file} -> src/${destRel}`);
      }
    }
  }
  return edges;
}

function walkSrc(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSrc(path, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) acc.push(path);
  }
  return acc;
}

test('src/ imports follow the layer dependency rule', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = new Map(
    walkSrc(src).map((path) => [
      relative(src, path).replaceAll('\\', '/'),
      readFileSync(path, 'utf8'),
    ]),
  );
  const edges = forbiddenEdges(files);
  equal(edges.join('\n'), '', edges.join('\n'));
});

test('forbiddenEdges reports bad imports and re-exports, and static imports in bin', () => {
  const edges = forbiddenEdges(
    new Map([
      ['cli/x.ts', "import { y } from '../daemon/y.ts';\nexport { z } from '../store/z.ts';\n"],
      ['core/a.ts', "import type { B } from './b.ts';\n"],
      ['daemon/a.ts', "import { b } from './b.ts';\n"],
      ['core/c.ts', "import { s } from '../store/s.ts';\n"],
      ['bin.ts', "import { run } from './cli/run.ts';\nawait import('./tui/app.ts');\n"],
    ]),
  );
  equal(
    edges.join('\n'),
    [
      'src/cli/x.ts -> src/daemon/y.ts',
      'src/cli/x.ts -> src/store/z.ts',
      'src/core/c.ts -> src/store/s.ts',
      'src/bin.ts -> src/cli/run.ts',
    ].join('\n'),
  );
});
