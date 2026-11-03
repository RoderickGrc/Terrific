export type Screen = 'home' | 'live' | 'summary';

export type CommandName =
  | 'new'
  | 'sessions'
  | 'ingest'
  | 'attach'
  | 'profile'
  | 'record'
  | 'note'
  | 'bug'
  | 'flag'
  | 'screenshot'
  | 'snapshot'
  | 'name'
  | 'copy'
  | 'export'
  | 'stop'
  | 'settings'
  | 'help'
  | 'quit';

export type CommandSpec = {
  name: CommandName;
  aliases?: string[];
  args?: string;
  description: string;
  key?: string;
  screens: Screen[];
  browserOnly?: boolean;
  needsBackground?: boolean;
};

const ALL: Screen[] = ['home', 'live', 'summary'];
const IDLE: Screen[] = ['home', 'summary'];

export const COMMANDS: CommandSpec[] = [
  {
    name: 'new',
    args: '[url] [name] [@profile] [#endpoint] [--flags]',
    description: 'Set up a session; you confirm before it starts',
    screens: IDLE,
  },
  {
    name: 'sessions',
    aliases: ['resume'],
    args: '[search]',
    description: 'Open a session of this project',
    screens: IDLE,
  },
  { name: 'ingest', description: 'Ingest endpoints of this project', screens: ALL },
  {
    name: 'attach',
    description: 'Return to the session recording in the background',
    screens: IDLE,
    needsBackground: true,
  },
  { name: 'profile', description: 'Default browser profile', screens: IDLE },
  { name: 'record', description: 'What browser sessions record by default', screens: IDLE },
  {
    name: 'note',
    args: '<text>',
    description: 'Add a note. Plain text does the same',
    screens: ['live'],
  },
  {
    name: 'bug',
    args: '[text]',
    description: 'Mark a bug now, text optional',
    key: 'Ctrl+Enter',
    screens: ['live'],
  },
  {
    name: 'flag',
    args: '[text]',
    description: 'Flag this moment, text optional',
    key: 'Ctrl+Shift+Enter',
    screens: ['live'],
  },
  {
    name: 'screenshot',
    description: 'Capture the current page',
    key: 'F5',
    screens: ['live'],
    browserOnly: true,
  },
  {
    name: 'snapshot',
    description: 'Save the page text as Markdown',
    key: 'F6',
    screens: ['live'],
    browserOnly: true,
  },
  {
    name: 'name',
    args: '<name>',
    description: 'Rename this session',
    screens: ['live', 'summary'],
  },
  { name: 'copy', description: 'Copy this session for an agent', screens: ['live', 'summary'] },
  { name: 'export', description: 'Write the agent context file', screens: ['summary'] },
  {
    name: 'stop',
    description: 'Stop recording; you confirm and can rename first',
    screens: ['live'],
  },
  { name: 'settings', description: 'Defaults and what the live log shows', screens: ALL },
  { name: 'help', description: 'Keys and commands', screens: ALL },
  { name: 'quit', description: 'Leave terrific', screens: ALL },
];

export type CommandScope = {
  screen: Screen;
  browser: boolean;
  background: boolean;
};

export function availableCommands(scope: CommandScope): CommandSpec[] {
  return COMMANDS.filter(
    (command) =>
      command.screens.includes(scope.screen) &&
      (command.browserOnly !== true || scope.browser) &&
      (command.needsBackground !== true || scope.background),
  );
}

export function findCommand(word: string, list: CommandSpec[]): CommandSpec | undefined {
  const lower = word.toLowerCase();
  return list.find((command) => command.name === lower || command.aliases?.includes(lower));
}

/** Commands matching what follows the slash, or none once arguments start. */
export function paletteMatches(input: string, list: CommandSpec[]): CommandSpec[] {
  if (!input.startsWith('/') || input.includes(' ')) return [];
  const query = input.slice(1).toLowerCase();
  return list.filter(
    (command) =>
      command.name.startsWith(query) ||
      (command.aliases ?? []).some((alias) => alias.startsWith(query)),
  );
}

export function splitCommand(text: string): { word: string; args: string } {
  const body = text.startsWith('/') ? text.slice(1) : text;
  const space = body.indexOf(' ');
  if (space < 0) return { word: body, args: '' };
  return { word: body.slice(0, space), args: body.slice(space + 1).trim() };
}
