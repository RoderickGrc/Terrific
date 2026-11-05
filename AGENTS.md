# Agent instructions

Terrific is an open-source CLI and terminal UI for recording runtime evidence and making it useful to coding agents. Read `README.md` and `CONTRIBUTING.md` for user workflows and contribution guidance.

## Working on the code

- Before implementing, trace the relevant end-to-end flows and understand how the affected components interact. Check the current code and tests; design documents may describe earlier plans.
- Prefer the simplest solution that fits the existing architecture. Reuse existing code and patterns before adding abstractions or dependencies. Preserve layer boundaries enforced by `test/architecture.test.ts`.
- Keep the TUI's visual style and interaction patterns consistent. Reuse its theme, layout, and shared components; check affected screens at different terminal sizes.
- Keep Terrific agent-first: make workflows easy for AI agents to discover and use, minimize unnecessary output and token consumption, and retain the evidence and context needed to act effectively. Preserve useful non-interactive CLI workflows.
- Treat session data, browser profiles, credentials, and ingest URLs as sensitive. Avoid exposing secrets in logs, tests, or documentation.

## Project map

- `src/cli` and `src/tui`: command-line and interactive interfaces; `src/client`: daemon client.
- `src/core`: shared logic; `src/daemon`: services and API; `src/recorder` and `src/store`: capture and persistence.
- `test/` and colocated `*.test.ts`: integration and unit tests. `.agents/skills/terrific` is the bundled agent skill; keep it aligned when its documented workflows change.

## Verification

Node.js 22.19 or later is required. Use `npm ci` to install dependencies. Choose checks appropriate to the change and report any that could not run:

- `npm run lint`, `npm run typecheck`, and `npm test` check formatting and code behavior.
- `npm run build` builds the CLI. `npm run check` runs the full suite, build, distribution smoke test, and package checks.
- For CLI or TUI behavior, exercise the affected user-facing flow when practical. Update relevant tests and documentation when behavior changes.
