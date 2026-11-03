const LOCALE = 'en-US';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Elapsed time as `mm:ss`, or `h:mm:ss` past an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
}

export function dateTime(ms: number, seconds = false): string {
  return new Date(ms).toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

export function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(LOCALE, { hour12: false });
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Gutter label for the session picker: Today, Yesterday, `Oct 7`, or `Oct 2025`. */
export function dayLabel(ms: number, now: number): string {
  const date = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  if (date.getFullYear() === today.getFullYear()) return shortDate(ms);
  return date.toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' });
}

export function parseTime(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
