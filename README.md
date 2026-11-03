# terrific-cli

Record QA sessions in a real browser from your terminal, with context ready for coding agents.

## Status

This package is under active development and has not been published yet. The package installs the `terrific` command. Run `terrific` in a project folder to open the interactive TUI, or `terrific --help` for the commands agents and scripts use.

## Development

Requires Node.js 22.19 or later.

```
npm ci
npm run dev -- --version
npm run check
```

See [docs/design.md](docs/design.md) for intended behavior and [docs/plan.md](docs/plan.md) for how the work is sequenced.

## Automation

Set `TERRIFIC_HOME` to choose the data root, `TERRIFIC_PORT` for the daemon listen port (default 4569), and `TERRIFIC_HEADLESS=1` so `daemon run` launches the browser without a window for agents and CI.
