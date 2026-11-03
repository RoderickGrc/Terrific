# terrific-cli implementation plan

Status: proposed on 2026-11-02, nothing implemented yet. `docs/design.md` says what terrific-cli does; this file says how it gets built, in which order, and to which standard. Where they disagree, `design.md` wins on behavior and this file wins on tooling and process.

terrific-cli is an open source package published to npm as `terrific-cli` (the name is free on the registry as of 2026-11-02). The goal from the first commit is a codebase a stranger can clone, understand and contribute to in an afternoon: few dependencies, one language, one package, honest names, every step tested.

## 1. Principles

1. **Small surface.** One npm package, one binary, one entry file. No monorepo, no workspaces, no plugin system, no config framework. Add structure when a second real case needs it, not before.
2. **Few dependencies, all justified.** Each runtime dependency is listed in section 2 with the reason it beats writing the code. Node built-ins come first (`node:http`, `node:test`, `node:util`, `fetch`).
3. **Layers with one direction.** `core` is pure; IO lives at the edges; the TUI and CLI only reach the daemon through `client` (design.md section 8). A test enforces it.
4. **Lossless storage, typed events.** What the recorder sees is stored as is; filtering only happens on export.
5. **Every step ends green.** Lint, types, tests and a packed tarball pass in CI before the next step starts. No step leaves dead code, TODO stubs or commented-out code behind.
6. **Public from day one.** No personal data, client names or local paths in the repo, its fixtures or its history (section 7).

## 2. Stack

Versions are the latest on npm on 2026-11-02 and are pinned through `package-lock.json`.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node `>=22.19.0`, ESM only | Node 22 is in maintenance until 2027-04-30, 24 until 2028-04-30, 26 is the active LTS ([Node release schedule](https://github.com/nodejs/Release)). 22.19 is the floor pi-tui requires. ESM only is safe because every supported Node can `require()` ESM |
| Language | TypeScript, `strict`, `erasableSyntaxOnly` | Node 22.18+ runs `.ts` files with type stripping by default ([Node 22.18.0 release](https://nodejs.org/en/blog/release/v22.18.0), [Node TypeScript docs](https://nodejs.org/api/typescript.html)), so `npm run dev` and the tests run the sources directly with no loader. Erasable syntax only (no `enum`, `namespace`, parameter properties) is the price, and a fair one |
| Type check | `typescript` 7 (`tsc --noEmit`) | Type checking only. 7.0 is the native compiler; it has no stable programmatic API until 7.1, which is one more reason not to depend on typescript-eslint ([InfoQ](https://infoq.com/news/2026/08/typescript-7-released/)) |
| Build | `tsdown` | Bundles `src/bin.ts` into `dist/` with code splitting, so dynamic `import()` keeps Playwright and the TUI out of short CLI commands. Rolldown-based successor to tsup. Dev dependency only |
| Lint and format | Biome 2 | One tool, one config file, no plugin tree, and it does not need the TypeScript API |
| Tests | `node:test` + `node:assert` | Built in, runs `.ts` directly, has mocks, snapshots and coverage. Vitest would add a Vite toolchain for features we do not need |
| CLI parsing | `commander` 15 | Zero dependencies, subcommands (`ingest up`), help and usage errors. Writing our own dispatcher would be more code to maintain, not less. `start` and `/new` hand their raw arguments to the shared parser in `core` |
| TUI | `@earendil-works/pi-tui` (pinned exact), confirmed by the spike in step 1 | Its `TuiAltScreen` renderer has fixed regions (`VStack`, `ScrollView`), overlays, `SelectList`, an editor with autocomplete, differential rendering with synchronized output, Kitty keyboard protocol, and it switches Windows consoles to VT input. That covers almost everything section 9 of design.md asks for. MIT, 3 dependencies, active. Fallback if the spike fails: our own raw ANSI renderer, like anygent's |
| Browser | `playwright-core` | Drives the browsers already on the machine (Comet, Chrome, Edge) without downloading Playwright's own browsers on install. `playwright-core install chromium` stays available for machines with no browser |
| HTTP and live stream | `node:http` + Server-Sent Events, `fetch` in the client | Ten routes and one stream do not need a framework |
| Validation | Hand-written guards in `core/validate.ts` | The only untrusted input is the ingest payload and the API bodies. Revisit with a schema library if the guards pass ten payload shapes |
| Context export | `@toon-format/toon` | The agent context keeps today's shape (header, TOON event log, footer) and field names. It is rebuilt on the typed event model instead of ported: the legacy renderer depends on workarounds (a dummy field to force a layout, unescaping newlines after encoding) that the typed model makes unnecessary. Byte-identical output is not a goal |
| Snapshot to Markdown | `turndown` | Same conversion terrific uses today, so snapshots read the same |

Runtime dependencies end at five: `@earendil-works/pi-tui`, `playwright-core`, `commander`, `@toon-format/toon`, `turndown`. Dev dependencies: `typescript`, `@types/node`, `@types/turndown`, `@biomejs/biome`, `tsdown`, `publint`, and `@xterm/headless` once the TUI tests need a virtual terminal.

## 3. Repository layout

```
terrific-cli/
  src/
    bin.ts                  entry: no arguments opens the TUI, anything else is the CLI
    core/                   pure: event model, /new parser, stats, context render, prompts, ids, redaction, validation
    store/                  filesystem: data root, projects, sessions, endpoints, settings, legacy reader
    recorder/               playwright-core: launch, page instrumentation, network folding, snapshot, screenshot, in-page shortcuts
    daemon/                 node:http routes, SSE, session registry, ingest endpoints, idle expiry, startup and shutdown
    client/                 typed client for the daemon API, daemon discovery and auto start
    cli/                    commander program, one file per command, text and --json output
    tui/                    pi-tui app: screens, palette, /new assistant, pickers, keys
  test/
    fixtures/               synthetic sessions (legacy and new formats), never real data
    helpers/                temp data root, daemon on a random port, fake clock
  docs/
    design.md               behavior (source of truth)
    plan.md                 this file
    decisions/              short records for choices that need a why (TUI library, key bindings)
  .github/workflows/        ci.yml, release.yml
  biome.json  tsconfig.json  tsdown.config.ts  package.json  package-lock.json
  README.md  LICENSE  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  .editorconfig  .gitignore  .node-version
```

Unit tests sit next to the file they test (`src/core/new-parser.test.ts`); integration tests that cross layers live in `test/`. The bundler only follows imports from `src/bin.ts`, so tests never reach `dist/`.

The daemon is not a second entry point. `terrific-cli daemon run` runs it in the foreground; the client starts it detached with that same command. One binary, one build output, and the foreground mode doubles as the debugging tool.

### Dependency rule

| Layer | May import |
|---|---|
| `core` | nothing but other `core` files and Node types |
| `store`, `recorder` | `core` |
| `daemon` | `core`, `store`, `recorder` |
| `client` | `core` |
| `cli`, `tui` | `core`, `client` |
| `bin.ts` | `cli`, `tui` (both with dynamic `import()`) |

`test/architecture.test.ts` reads the import lines of every file in `src/` and fails on a forbidden edge. About 30 lines, no extra tool.

## 4. Code standards

- **Modules.** Named exports only, no default exports, no barrel `index.ts` files. File names in kebab-case, one concept per file. Imports use the `.ts` extension, which Node's type stripping needs and the bundler rewrites.
- **Types.** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. No `any`; external input enters as `unknown` and goes through a guard. Event kinds are a string union with an exhaustive `switch`, never stringly typed.
- **Side effects.** Importing a module never does anything. The daemon builds its services in `daemon/main.ts` and passes them in. Clock, random ids and the data root are parameters, so tests control them.
- **Errors.** One `TerrificError` class with a stable `code` (`SESSION_NOT_FOUND`, `ENDPOINT_CLOSED`, ...) and the exit code it maps to (1 failure, 2 usage). Messages are short English sentences that say what to do next. Nothing is swallowed; the daemon logs unexpected errors to `daemon.log` with a stack.
- **Names.** The vocabulary of design.md section 7: session, project, ingest endpoint, snapshot, navigation, browser profile. A name that needs a comment to explain it is the wrong name.
- **Comments.** Explain why, never what. No commented-out code, no TODO without an issue link.
- **Copy.** User-facing text is English, lives next to the feature that shows it, and follows the UX rules in design.md section 2. No i18n layer.
- **Security.** The daemon binds to `127.0.0.1`. Every route except `/ingest/*` needs the token in an `Authorization` header (a header, not a cookie, so pages cannot send it for you) and rejects a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding. `/ingest/*` answers CORS for any origin, because instrumented apps post from their own dev server, and caps bodies at 1 MB. On macOS and Linux the token file is created with mode 0600. Credentials and cookie states are never logged or exported.
- **Commits.** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), so the changelog writes itself from the log. No em dashes, no hard-wrapped prose in docs.

## 5. Testing

| Layer | How | What it proves |
|---|---|---|
| `core` | Unit tests, table-driven | Every `/new` example and error in design.md section 2, target and endpoint defaults, stats, network folding, context render against golden files |
| `store` | Unit tests on a temp data root | Folder layout, project id reuse from `workspaces.json`, path normalization, settings, legacy reader on synthetic fixtures |
| `store` (local only) | `npm run check:legacy`, not in CI | Reads every session under the real `Documents/.terrific/sessions` and the per-workspace stores without errors and with today's event counts. Prints counts only, never content |
| `recorder` | Integration test against `test/fixtures/site/` served by `node:http`, headless Chromium | Clicks, typing, password masking, request and response folded by `requestId`, console levels, navigation, snapshot and screenshot files |
| `daemon` | Integration tests on a random port and temp data root | Routes, auth, `Host` check, SSE order, restart marks sessions `interrupted`, ingest open, closed (410), unknown (404), reopen keeps the URL, idle close with a fake clock, one endpoint per session |
| `cli` | Spawn `src/bin.ts` against a test daemon | Text output, `--json` shape, exit codes 0, 1 and 2, idempotent `ingest up` and `start` |
| `tui` | pi-tui's `VirtualTerminal` at 110x34 and 80x24 | Each screen of design.md section 2 renders without overflow; key sequences drive the flows |
| `tui` (manual) | Checklist in `docs/decisions/tui-library.md`, run in Windows Terminal before each release | Ctrl+Enter, Ctrl+Shift+Enter, F5 and F6, clipboard, resize, Ctrl+C twice |

Coverage is reported, not gated. The CI gate is: Biome, `tsc`, tests, build, `publint`, and a check that `npm pack --dry-run` ships only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` and `package.json`.

## 6. Distribution

### package.json shape

```json
{
  "name": "terrific-cli",
  "version": "0.1.0",
  "description": "Record QA sessions in a real browser from your terminal, with context ready for coding agents",
  "license": "MIT",
  "type": "module",
  "bin": { "terrific-cli": "dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=22.19.0" },
  "repository": { "type": "git", "url": "git+https://github.com/RoderickGrc/terrific-cli.git" },
  "scripts": {
    "dev": "node src/bin.ts",
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "node --test \"src/**/*.test.ts\" \"test/**/*.test.ts\"",
    "check": "npm run lint && npm run typecheck && npm test && npm run build && publint",
    "prepack": "npm run build"
  }
}
```

MIT, the same license terrific uses. `repository.url` must match the GitHub repository exactly or trusted publishing fails ([npm trusted publishers](https://docs.npmjs.com/trusted-publishers)).

### CI and release

- **`ci.yml`** on every push and pull request: `npm ci`, then `npm run check`, on `ubuntu-latest` and `windows-latest` with Node 22 and 26. Windows is a first-class platform, not an afterthought.
- **`release.yml`** on a pushed `v*` tag: `npm ci`, `npm run check`, `npm publish`, with `permissions: id-token: write` and no npm token. Trusted publishing needs npm 11.5.1+ and Node 22.14+; npm generates provenance on its own for public repositories, and a new trusted publisher configuration must complete its first publish within 2 days ([npm trusted publishers](https://docs.npmjs.com/trusted-publishers)). Classic npm tokens no longer work at all ([npm community discussion](https://github.com/orgs/community/discussions/174507)), so there is no token to leak.
- **Versioning.** SemVer, starting at `0.1.0`. `1.0.0` when the CLI commands and `--json` shapes in design.md section 3 are stable, because agents depend on them. Releasing is `npm version <level>`, `git push --follow-tags`. `CHANGELOG.md` follows Keep a Changelog and is edited in the same pull request as the change. No release tooling beyond that.

### Repository hygiene

- `README.md`: what it does, install (`npm i -g terrific-cli`), the three-command agent flow, the TUI keys, where data lives, and a real screenshot from step 8.
- `CONTRIBUTING.md`: setup, `npm run check`, the dependency rule, commit style, how to add a command.
- `SECURITY.md`: the local threat model (loopback daemon, token, unauthenticated ingest URLs with random tokens) and how to report a problem privately.
- `.editorconfig`, `.node-version` (`22`), `.gitignore`. Issue templates and a code of conduct wait until there are outside contributors.

## 7. Privacy before the first public commit

The repository starts clean: the HTML mockup used to validate the design, and its build script that reads real sessions, live outside the repository and never enter it or its history. What remains to guard:

- `docs/design.md` names a client project path, its project id, a session id and profile names as examples. They are replaced with neutral examples (`D:\work\shop-frontend`, `k2m8q4zx`, `@testing`).
- Test fixtures are written by hand or generated, never copied from `Documents/.terrific`.

The check: `git grep` for the known names returns nothing before the repository is made public.

## 8. Steps

Each step is one or more pull requests, ends with its check passing in CI, and updates `CHANGELOG.md`. Steps 2 to 5 can be reviewed without the TUI.

| # | Step | Delivers | Check |
|---|---|---|---|
| 0 | Repository | `git init`, the files in section 3 with empty `src/bin.ts` printing the version, Biome, tsconfig, tsdown, CI, the privacy scrub of section 7 | CI green on both OSes; `npm pack --dry-run` lists only the allowed files; `npx terrific-cli@file:. --version` works from the tarball |
| 1 | TUI spike, one day | A throwaway branch with pi-tui `TuiAltScreen`: header, scrolling log at 10 events per second, input with autocomplete, an overlay, and a key probe that prints what each key sends | Run by hand in Windows Terminal: no flicker, resize works, and a written answer for Ctrl+Enter, Ctrl+Shift+Enter (risk R1), F5, F6 and clipboard. Result in `docs/decisions/tui-library.md`; the branch is deleted |
| 2 | `core` | Event model, `/new` parser with its messages and suggestions, target and endpoint defaults, stats, network folding, context render, agent prompts, ids, validation | Every example in design.md section 2 is a test; context render matches golden files built from synthetic sessions, with the legacy sections and field names; architecture test passes |
| 3 | `store` | Data root (same as terrific: `TERRIFIC_HOME`, else `Documents/.terrific` on Windows and `~/.terrific` elsewhere), projects with id reuse, sessions, endpoints, settings, legacy reader | `npm run check:legacy` reads every legacy session with today's counts |
| 4 | `recorder` | Browser launch through a profile, instrumentation, folding, snapshot, screenshot | Recorder tests pass headless in CI; a manual session against a local app gives a context comparable to the old backend's |
| 5 | `daemon` + ingest | HTTP API, SSE, registry, endpoints with idle close, restart behavior, `daemon run` | Daemon tests pass; `curl` against open, closed, reopened and deleted endpoints, with and without a session |
| 6 | `client` + `cli` | Daemon discovery and auto start, every command in design.md section 3, `--json` | An agent runs the fullstack flow of design.md section 3 from a shell, with no TUI |
| 7 | `tui` | The screens of design.md section 2 on pi-tui (or the fallback): home, `/new` assistant, confirmation, live, stop confirmation, summary, sessions, ingest, settings, help | VirtualTerminal tests at both sizes; the flows of design.md section 2 walked by hand in Windows Terminal |
| 8 | Profiles, doctor, in-page shortcuts | `profiles`, `doctor`, Comet, clean browser and blocked Chrome behavior, in-page keys chosen with risk R4 | The three profile cases behave as design.md says; README screenshot taken from the real TUI |
| 9 | Release `0.1.0` | README, CONTRIBUTING, SECURITY final; GitHub repository public; trusted publisher configured on npm | `release.yml` publishes with provenance; `npm i -g terrific-cli` on a clean Windows machine opens the TUI |

## 9. Not in this plan

- Everything design.md lists as optional, deferred or out of scope (filters file, all-projects views, configurable idle time, terrific web reading `projects/`, saved logins, legacy migration, managed profiles, video, viewport presets).
- Standalone binaries (`tsdown` can build them, but npm is the only channel for now).
- Telemetry about terrific-cli itself. It sends nothing anywhere.
- Plugin or extension APIs.

## 10. Open points, decided inside their step

- **Step 1:** pi-tui or raw ANSI; how the clipboard works on each OS (pi-tui ships native clipboard prebuilds and uses OSC 52, to be tested); the second flag binding if Ctrl+Shift+Enter fails.
- **Step 4:** whether "clean browser" uses an installed Chrome or Edge with a fresh temporary profile, or Playwright's Chromium after `playwright-core install chromium`. A fresh profile directory is outside Chrome 136's block on the default user data dir (risk R2), so the installed browser is the first choice.
- **Step 9:** the GitHub repository name and whether it lives under a personal account or an organization. The plan assumes `RoderickGrc/terrific-cli`.
