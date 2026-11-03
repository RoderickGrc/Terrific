import { homedir } from 'node:os';

export type CliIo = {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
  env: Record<string, string | undefined>;
  platform: string;
  homedir: string;
};

export type GlobalOpts = {
  json?: boolean;
};

export function processIo(): CliIo {
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    homedir: homedir(),
  };
}
