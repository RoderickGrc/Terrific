import type { ActionEvent, TerrificEvent } from './events.ts';
import { foldNetwork } from './network.ts';

const STATIC_EXTENSIONS = [
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.otf',
  '.woff',
  '.woff2',
  '.ttf',
  '.ico',
  '.css',
  '.map',
];

const VITE_DROP_PREFIXES = [
  '/@vite/',
  '/@react-refresh',
  '/node_modules/.vite/',
  '/@fs/',
  '/@id/',
  '/node_modules/vite/dist/client/',
  '/__vite_ping',
];

const VITE_BURST_PREFIXES = [...VITE_DROP_PREFIXES, '/src/'];
// URL.hostname keeps the brackets for IPv6 literals.
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const VITE_BURST_WINDOW_MS = 1500;

export type ViteBurst = {
  kind: 'vite-burst';
  t: number;
  count: number;
  uniqueUrlCount: number;
};

export type ExportItem = TerrificEvent | ViteBurst;

export function isViteBurst(item: ExportItem): item is ViteBurst {
  return 'kind' in item && item.kind === 'vite-burst';
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, 'http://localhost');
  } catch {
    return null;
  }
}

function pathnameOf(url: string): string {
  return parseUrl(url)?.pathname ?? url;
}

function isLocalDevUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  return LOCAL_DEV_HOSTS.has(parsed.hostname.toLowerCase());
}

export function isStaticAssetUrl(url: string): boolean {
  const path = pathnameOf(url).toLowerCase();
  if (STATIC_EXTENSIONS.some((ext) => path.endsWith(ext))) return true;
  return path.includes('.json') && (path.includes('animation') || path.includes('lottie'));
}

export function isDroppedDevUrl(url: string): boolean {
  const path = pathnameOf(url);
  if (path.includes('hot-update')) return true;
  return VITE_DROP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isViteReloadNoise(url: string): boolean {
  if (!isLocalDevUrl(url)) return false;
  const path = pathnameOf(url);
  if (path.includes('hot-update')) return true;
  return VITE_BURST_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function inputTargetKey(event: ActionEvent): string {
  return event.target.selector ?? event.target.label ?? event.target.xpath ?? '';
}

export function debounceInputEvents(events: readonly TerrificEvent[]): TerrificEvent[] {
  const result: TerrificEvent[] = [];
  let group: ActionEvent[] = [];
  let currentKey: string | null = null;

  const flush = (): void => {
    const last = group[group.length - 1];
    if (last !== undefined) result.push(last);
    group = [];
    currentKey = null;
  };

  for (const event of events) {
    if (event.kind === 'action' && event.action === 'input') {
      const key = inputTargetKey(event);
      if (currentKey !== null && key === currentKey) {
        group.push(event);
      } else {
        flush();
        currentKey = key;
        group.push(event);
      }
      continue;
    }
    flush();
    result.push(event);
  }
  flush();
  return result;
}

export function filterStaticResources(events: readonly TerrificEvent[]): TerrificEvent[] {
  const dropIds = new Set<string>();
  for (const request of foldNetwork(events)) {
    if (isDroppedDevUrl(request.url)) {
      dropIds.add(request.requestId);
      continue;
    }
    if (!isStaticAssetUrl(request.url)) continue;
    const ok = request.status === undefined || request.status === 200 || request.status === 304;
    if (ok && !request.failed) dropIds.add(request.requestId);
  }
  return events.filter((event) => event.kind !== 'network' || !dropIds.has(event.requestId));
}

export function collapseViteReloadNoise(events: readonly TerrificEvent[]): ExportItem[] {
  const candidates: { index: number; t: number; url: string }[] = [];
  for (const [index, event] of events.entries()) {
    if (event.kind !== 'network') continue;
    if (event.status !== undefined && event.status >= 400) continue;
    if (!isViteReloadNoise(event.url)) continue;
    candidates.push({ index, t: event.t, url: event.url });
  }
  if (candidates.length === 0) return [...events];

  const groups: { index: number; t: number; url: string }[][] = [];
  let current: { index: number; t: number; url: string }[] = [];
  for (const candidate of candidates) {
    const previous = current[current.length - 1];
    if (previous !== undefined && candidate.t - previous.t > VITE_BURST_WINDOW_MS) {
      groups.push(current);
      current = [];
    }
    current.push(candidate);
  }
  if (current.length > 0) groups.push(current);

  const skip = new Set<number>();
  const burstAt = new Map<number, ViteBurst>();
  for (const group of groups) {
    const first = group[0];
    if (first === undefined || group.length === 1) continue;
    const urls = new Set(group.map((item) => item.url));
    burstAt.set(first.index, {
      kind: 'vite-burst',
      t: first.t,
      count: group.length,
      uniqueUrlCount: urls.size,
    });
    for (const item of group) skip.add(item.index);
  }

  const result: ExportItem[] = [];
  for (const [index, event] of events.entries()) {
    const burst = burstAt.get(index);
    if (burst !== undefined) {
      result.push(burst);
      continue;
    }
    if (skip.has(index)) continue;
    result.push(event);
  }
  return result;
}
