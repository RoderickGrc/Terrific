function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clampMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms;
}

/** Relative session time: `mm:ss.d`, or `hh:mm:ss.d` once an hour has passed. */
export function formatOffset(ms: number): string {
  const total = clampMs(ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${tenths}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}.${tenths}`;
}

const OFFSET = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d))?$/;

/** Parses `mm:ss`, `mm:ss.d`, or `hh:mm:ss` (and `hh:mm:ss.d`) into milliseconds. */
export function parseOffset(text: string): number | null {
  const match = OFFSET.exec(text.trim());
  if (!match) return null;
  const hasHours = match[1] !== undefined;
  const hours = hasHours ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const tenths = match[4] === undefined ? 0 : Number(match[4]);
  if (seconds > 59) return null;
  if (hasHours && minutes > 59) return null;
  if (!hasHours && minutes > 59) return null;
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + tenths * 100;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(clampMs(ms) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${pad2(seconds)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${pad2(minutes)}m`;
}

export function formatBytes(bytes: number): string {
  const n = !Number.isFinite(bytes) || bytes < 0 ? 0 : bytes;
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function approxTokens(bytes: number): number {
  const n = !Number.isFinite(bytes) || bytes < 0 ? 0 : bytes;
  return Math.round(n / 4);
}

export function formatTokens(tokens: number): string {
  const n = !Number.isFinite(tokens) || tokens < 0 ? 0 : tokens;
  return `~${(n / 1000).toFixed(1)}k tokens`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}

export function truncateMiddle(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  const inner = max - 1;
  const head = Math.ceil(inner / 2);
  const tail = Math.floor(inner / 2);
  if (tail <= 0) return `${text.slice(0, max - 1)}…`;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
