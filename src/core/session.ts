import type { SessionSetup } from './setup.ts';

export type SessionStatus = 'recording' | 'stopped' | 'interrupted';

export type SessionSummaryInfo = {
  id: string;
  name: string | null;
  status: SessionStatus;
  startedAt: string;
  stoppedAt: string | null;
  projectPath: string;
  setup: SessionSetup;
  legacy: boolean;
};
