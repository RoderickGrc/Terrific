import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A command string through the shell, because Windows cannot spawn npm.cmd directly.
// --ignore-scripts keeps the prepack build log out of stdout; `npm run check` builds first.
const raw = execSync('npm pack --dry-run --json --ignore-scripts', {
  cwd: root,
  encoding: 'utf8',
});
const parsed: unknown = JSON.parse(raw);
const report = Array.isArray(parsed) ? parsed[0] : parsed;
if (typeof report !== 'object' || report === null || !('files' in report)) {
  console.error('npm pack --dry-run --json did not return a file list');
  process.exit(1);
}

const packed = report as {
  files: { path: string; size?: number }[];
  size?: number;
  unpackedSize?: number;
};
const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
const extra = packed.files
  .map((file) => file.path.replaceAll('\\', '/').replace(/^package\//, ''))
  .filter((path) => !path.startsWith('dist/') && !allowed.has(path));

if (extra.length > 0) {
  console.error(`packed files outside the allow list:\n${extra.join('\n')}`);
  process.exit(1);
}

const size =
  packed.size ??
  packed.unpackedSize ??
  packed.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
console.log(`packed ${packed.files.length} files, ${size} bytes`);
