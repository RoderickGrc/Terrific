export const EVENT_KINDS = [
  'action',
  'network',
  'console',
  'navigation',
  'snapshot',
  'screenshot',
  'note',
  'bug',
  'flag',
  'ingest',
  'lifecycle',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export type EventCommon = {
  id: string;
  seq: number;
  at: string;
  t: number;
};

export type ActionName = 'click' | 'input' | 'change' | 'select' | 'submit' | 'keydown';

export type ActionTarget = {
  label?: string;
  selector?: string;
  xpath?: string;
};

export type ActionEvent = EventCommon & {
  kind: 'action';
  action: ActionName;
  target: ActionTarget;
  value?: string;
  valueLength?: number;
  masked: boolean;
};

export type NetworkPhase = 'request' | 'response' | 'failed';

export type NetworkEvent = EventCommon & {
  kind: 'network';
  phase: NetworkPhase;
  requestId: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
  errorText?: string;
};

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type ConsoleEvent = EventCommon & {
  kind: 'console';
  level: ConsoleLevel;
  text: string;
};

export type NavigationEvent = EventCommon & {
  kind: 'navigation';
  url: string;
  title: string;
};

export type SnapshotEvent = EventCommon & {
  kind: 'snapshot';
  url: string;
  title: string;
  wordCount: number;
  markdown: string;
};

export type ScreenshotEvent = EventCommon & {
  kind: 'screenshot';
  file: string;
  bytes: number;
};

export type MarkAuthor = 'tester' | 'agent';

export type NoteEvent = EventCommon & {
  kind: 'note';
  text: string;
  author: MarkAuthor;
};

export type BugEvent = EventCommon & {
  kind: 'bug';
  text: string | null;
  author: MarkAuthor;
};

export type FlagEvent = EventCommon & {
  kind: 'flag';
  text: string | null;
  author: MarkAuthor;
};

export type IngestLevel = 'debug' | 'info' | 'warn' | 'error';

export type IngestEvent = EventCommon & {
  kind: 'ingest';
  endpoint: string;
  message: string;
  source?: string;
  diagnosticSlug?: string;
  level: IngestLevel;
  clientTime?: string;
  data?: unknown;
};

export type LifecycleState = 'started' | 'stopped' | 'interrupted' | 'browser-closed';

export type LifecycleEvent = EventCommon & {
  kind: 'lifecycle';
  state: LifecycleState;
};

export type TerrificEvent =
  | ActionEvent
  | NetworkEvent
  | ConsoleEvent
  | NavigationEvent
  | SnapshotEvent
  | ScreenshotEvent
  | NoteEvent
  | BugEvent
  | FlagEvent
  | IngestEvent
  | LifecycleEvent;

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type EventInput = DistributiveOmit<TerrificEvent, 'id' | 'seq' | 'at' | 't'>;

export const DEFAULT_MARK_TEXT = {
  bug: 'Bug reported',
  flag: 'Flagged point of interest',
} as const;

export function isErrorEvent(event: TerrificEvent): boolean {
  if (event.kind === 'network') {
    return event.phase === 'failed' || (event.status !== undefined && event.status >= 400);
  }
  if (event.kind === 'console') return event.level === 'error';
  if (event.kind === 'ingest') return event.level === 'error';
  return false;
}
