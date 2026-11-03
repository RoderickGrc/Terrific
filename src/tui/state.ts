import type {
  EndpointView,
  ProfileView,
  ProjectSettingsView,
  ProjectView,
  SessionDetail,
  SessionListItem,
  SessionView,
} from '../core/api.ts';
import type { TerrificEvent } from '../core/events.ts';
import type { RecordOptions, SessionSetup } from '../core/setup.ts';
import type { Screen } from './commands.ts';
import type { InputLine } from './input-line.ts';
import type { LiveLog } from './live-log.ts';
import type { Tone } from './theme.ts';

export type Toast = { tone: Tone; text: string };

export type LiveState = {
  session: SessionView;
  log: LiveLog;
  /** Index into the visible lines while inspecting; null follows the end. */
  selected: number | null;
  /** Lines scrolled up from the end; 0 follows new events. */
  scroll: number;
  unseen: number;
};

export type Block = { title: string; lines: string[]; ok: boolean };

export type SummaryState = {
  detail: SessionDetail;
  blocks: Block[];
  scroll: number;
};

export const RECORD_KEYS = [
  'actions',
  'network',
  'console',
] as const satisfies readonly (keyof RecordOptions)[];

export type NewField = 'target' | 'url' | 'name' | 'profile' | 'record' | 'endpoint';

export type NewOverlay = {
  type: 'new';
  setup: SessionSetup;
  name: string;
  field: number;
  recordIndex: number;
};

export type SessionsOverlay = {
  type: 'sessions';
  query: string;
  index: number;
  renaming: string | null;
  confirmDelete: string | null;
};

export type IngestOverlay = {
  type: 'ingest';
  index: number;
  /** 'new' while typing a new endpoint's name, or the endpoint being renamed. */
  naming: string | null;
  confirmDelete: string | null;
  events: TerrificEvent[];
  eventsFor: string | null;
};

export type PickerItem = {
  id: string;
  label: string;
  detail?: string;
  /** Why the item cannot be chosen. */
  disabled?: string;
  current?: boolean;
  checked?: boolean;
  heading?: boolean;
  tone?: Tone;
};

export type PickerOverlay = {
  type: 'picker';
  title: string;
  items: PickerItem[];
  index: number;
  filter: boolean;
  multi: boolean;
  onPick(item: PickerItem): void;
  onToggle?(item: PickerItem): void;
  /** Where Esc and a pick return to, for pickers opened from another panel. */
  back?: () => void;
};

export type SettingsOverlay = { type: 'settings'; index: number };

export type Overlay =
  | NewOverlay
  | SessionsOverlay
  | IngestOverlay
  | PickerOverlay
  | SettingsOverlay
  | { type: 'stop' }
  | { type: 'help' };

export type TuiState = {
  project: ProjectView;
  storePath: string;
  screen: Screen;
  settings: ProjectSettingsView;
  profiles: ProfileView[];
  endpoints: EndpointView[];
  sessions: SessionListItem[];
  legacy: SessionListItem[] | null;
  live: LiveState | null;
  summary: SummaryState | null;
  overlay: Overlay | null;
  input: InputLine;
  paletteIndex: number;
  suggestionIndex: number;
  toast: Toast | null;
  now: number;
  /** When Ctrl+C was pressed once; a second press within the window quits. */
  ctrlCAt: number;
};

export function isModal(overlay: Overlay | null): boolean {
  const type = overlay?.type;
  return type === 'new' || type === 'sessions' || type === 'ingest' || type === 'help';
}

export function newFields(setup: SessionSetup): NewField[] {
  return setup.target === 'browser'
    ? ['target', 'url', 'name', 'profile', 'record', 'endpoint']
    : ['target', 'name', 'endpoint'];
}

export function isBrowserSession(live: LiveState | null): boolean {
  return live?.session.setup.target === 'browser';
}
