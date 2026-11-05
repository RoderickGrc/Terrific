# terrific-cli design

Status: approved on 2026-11-02. Implementation follows `docs/plan.md`.

terrific-cli is a clean rewrite of Terrific as a separate project. It becomes the main product. It records QA sessions in a real browser (or without one), shows them live in a terminal UI, and lets people and agents drive everything from the command line. terrific web (the current `@roderickgrc/terrific` package) stays as is and will later learn to read terrific-cli data. terrific-cli does not depend on it.

## 1. Decisions taken

| Topic | Decision |
|---|---|
| Engine | Full rewrite, based on the current behavior, with clean architecture and honest names |
| Package | Separate project, npm package `@rod.run/terrific`, command `terrific`. The terrific web command becomes `terrific-web` |
| Background process | One daemon shared by all projects on the machine |
| Storage | `<data root>/projects/<project-id>/`. The data root is the one terrific already uses: `Documents/.terrific` on Windows, `~/.terrific` elsewhere, or `TERRIFIC_HOME` when set |
| Project id | Short 8-character id, the same format terrific already uses for workspaces; the id terrific already gave a directory is reused |
| Legacy sessions | Read in place, never moved |
| terrific web | Keeps its current storage for now |
| Start screen | Command-first: project header, open ingest endpoints, the sessions recording in this project, a command input |
| Starting a session | `/new` with optional arguments (URL, name, `@profile`, `#endpoint`, `--flags`), parsed live while typing; always followed by a confirmation panel |
| Session targets | Browser (URL optional) or no browser (notes, bugs, flags and ingest only) |
| Video | Not recorded. terrific-cli has no video and no whole-screen mode |
| Viewport | Always Dynamic: the page follows the browser window. No resolution presets |
| Live log | One line per event, expandable |
| Log visibility | Actions, network, console and ingest; the last choice is remembered |
| Free text while recording | Saved as a note. `/bug`, `/flag`, Ctrl+Enter bug, Ctrl+Shift+Enter flag; bugs and flags work without text |
| Captures | F5 screenshot, F6 page snapshot, also as `/screenshot` and `/snapshot` |
| Extra commands in v1 | `/sessions` (alias `/resume`), `/ingest` |
| After `/stop` | A confirmation with the session name editable: Enter stops and saves, Esc keeps recording. Then the summary in the terminal |
| Summary stats | Start, end, duration, total and per-type counts, errors and failed requests, pages, context size, location |
| `/copy` | Menu: agent prompt, bugs and errors, full context, ingest endpoints. All copy text in English |
| `/export` | Agent context format only |
| Look | Sober, anygent ask-webchat palette (lavender accent), fullscreen; event types in terrific web colors |
| UI language | English |
| Non-interactive output | Short text by default, `--json` for structured output. The CLI locates files; heavy reading goes to the materialized files |
| Following a session | Both a snapshot (`events`, `context`) and a live stream (`--follow`) |
| Ingest endpoints | Named, project-scoped, independent of sessions, with a reserved URL. Each session links to at most one endpoint. 24 h without events closes one; reopening keeps the URL |
| MCP | Replaced by the CLI. terrific-cli ships no MCP server |
| TUI technology | pi-tui (section 9) |

## 2. Interactive TUI

Launched with `terrific` in any directory. The working directory is the project. The TUI is a client of the daemon; closing it never stops a recording or an ingest endpoint.

### UX rules

These come from the design reviews and apply to every screen and to the non-interactive CLI.

1. **Commands first.** No screen assumes what the next input is. Home and summary wait for a command; plain text only means something where it cannot be ambiguous (a note while recording). A pasted URL on home becomes `/new <url>` in the input, so the parser shows what it understood; it never starts anything by itself.
2. **Only require what the action cannot do without.** A session does not need a URL (empty tab) or even a browser. Bugs and flags do not need text. Names are optional: a session started without one is named after its local start time and its page (or endpoint), for example `2026-11-03 08:22 haiku.ac`. Notes are the exception, because an empty note says nothing.
3. **Say it in one line, confirm in one key.** Everything a session needs fits in `/new …`, the parser shows how each part is read while typing, and Enter opens a confirmation that a second Enter accepts. Defaults come from the last setup.
4. **One key, one meaning, everywhere.** Enter confirms or starts, Esc backs out one level (panel, inspection, input, then summary to home), arrows move, Space toggles, Tab completes, Ctrl+C twice quits.
5. **Colors carry meaning, shared with terrific web.** Event types use the exact colors of terrific web, only on the type tag and on markers. The interface itself stays in the anygent grey scale with the lavender accent for focus and selection. Red and amber are reserved for bugs, flags, errors and warnings.
6. **Hide what cannot apply.** Browser fields, `/screenshot`, `/snapshot`, F5 and F6 do not exist in a session without a browser. Commands only appear in the palette where they work. Options that the CLI does not support (video, viewport presets) are rejected with the reason, not silently ignored.
7. **Destructive actions confirm; legacy data is read only.** Delete needs a second Ctrl+D. Rename and delete refuse legacy sessions.
8. **Parity with the CLI.** Everything the TUI does has a non-interactive command, and `/new …` uses the same grammar as `terrific start …`.
9. **Own identity.** Layouts are designed for this tool, not borrowed from other TUIs.

### Screens

- **Home.** Header with project path and store path, a line with the project's ingest endpoints (open ones with event count and last activity), the sessions of this project that are recording (elapsed time, events, bugs, errors; the attached one shows `/attach`), and a command input. Stopped and legacy sessions are only in `/sessions`, so home keeps the focus on what is running. The status line shows what `/new` starts from.
- **`/new` assistant.** While the input holds `/new …`, a panel above it shows how the line is being read (see below).
- **Confirmation.** One row per field, filled from the parsed line and the last setup: Name (optional, focused first so typing names the session), Target (Browser or No browser), URL (optional, blank opens an empty tab), Profile, Record (actions, network, console) and Ingest (a single choice: none or one endpoint of the project). Without a browser, only Name, Target and Ingest remain. The last line says in plain words what Enter will start.
- **Live.** Header with session name, profile (or "No browser") and its ingest endpoint, then the current URL or the ingest `POST` URL. The log streams one line per event. The input saves notes; Ctrl+Enter and Ctrl+Shift+Enter mark a bug or a flag with or without text; F5 and F6 capture. The status line shows running counts and which event types are hidden.
- **Stop confirmation.** `/stop` opens a panel above the input while recording continues behind it: duration, events, bugs, flags, errors, and the endpoint that stays open. The input becomes the session name, selected, so typing replaces it. Enter stops and saves with that name; Esc closes the panel and the session keeps recording.
- **Summary.** Shown after `/stop` or after opening a session from `/sessions`. It reads top to bottom, from the answer to the detail, in groups separated by a blank line:
  1. **Verdict.** One line with a colored mark: "2 bugs to review · 1 error · 1 flagged", or "Nothing reported, no errors". Under it, the time range, duration and event count.
  2. **Shape.** A timeline rail across the session's duration with `●` bugs, `◆` flags and `✕` timed errors where they happened (same rail as `/sessions`), and a proportional bar of events with one segment per type in its terrific web color, followed by its legend.
  3. **To review.** Each bug and flag with its time, then each error. Omitted when there is nothing.
  4. **Where it went.** Pages as a path (`localhost:5173/ → localhost:5173/today`) and the ingest endpoint with its current state.
  5. **Files.** Context size and approximate tokens, and the folder, shortened in the middle so the session folder stays visible.
  
  Then `/copy`, `/export` and `/new`. The status line shows the `/new` line that recreates the same setup without the name, for example `/new localhost:5173/ @testing #app`. Esc goes back to home.
- **Detached.** Ctrl+C twice leaves the TUI. The shell prints any session still recording and the endpoints still open, with the commands to come back or stop them.

### `/new` grammar and live assistant

```
/new [url] [name words | "quoted name"] [@profile] [#endpoint] [--flag ...]
```

| Part | Read as | Example |
|---|---|---|
| A word that looks like a URL (scheme, `localhost`, port, or dotted host) | URL; only the first one counts | `localhost:5173`, `app.example.com/login` |
| Other words, or text in quotes | Session name | `pooling check`, `"api.v2"` |
| `@slug` | Browser profile, by a slug made from its name (`@testing`, `@work`, `@clean`) | `@testing` |
| `#name` | The session's ingest endpoint; only one, a second `#` is an error; created if it does not exist, reopened if closed | `#app` |
| `--no-browser` | Session without a browser | |
| `--no-actions`, `--no-network`, `--no-console` | Turn off a recorded type | |
| `--no-ingest` | Listen to no endpoint | |

Target rule: `--no-browser` wins; a URL, `@profile` or a record flag means browser; a name alone means no browser; nothing at all keeps the last setup. Without `#endpoint`, the session links to the last endpoint used if it is still open, otherwise to the most recently active open one, otherwise to none. A session without a browser and with no open endpoint gets a new `main` endpoint.

While typing, on every keystroke the assistant shows:

- The typed line again, each part in its color (URL lavender, name bold white, profile blue, endpoint orange, flags grey), with the part under the cursor highlighted and problems underlined in amber (incomplete) or red (invalid).
- The resulting configuration, one row per field, and on the right where each value came from: the token that set it, or "last setup".
- One line per problem with the reason, for example `--no-con incomplete flag, Tab completes it`, `@te incomplete profile`, `htp://x not a valid URL, read as part of the name`, `--mobile terrific records no video and always uses the dynamic viewport`, or a blocked Chrome profile with its reason.
- Suggestions for the part under the cursor: profiles after `@`, endpoints (and "create this endpoint") after `#`, flags after `--`, recent URLs while typing one, and, when the cursor is on a space, the prefixes the line does not use yet (no `@` once a profile is set, no `#` once an endpoint is set or with `--no-ingest`). Tab applies the highlighted suggestion; arrows move between suggestions.

Enter opens the confirmation even if some parts are invalid; those are dropped and listed in a notice.

### Confirmation keys

| Key | Action |
|---|---|
| Up / Down, Tab | Move between fields |
| Left / Right | Change Target, Profile and Ingest; move between Record boxes |
| Space | Toggle the focused Record box; on Profile, open the full list including blocked profiles |
| Typing | Edit URL and Name when focused; the URL row warns while the text is not a URL yet |
| Enter | Start, and remember target, URL, profile, record choices and endpoint for next time |
| Esc | Cancel |

### Sessions without a browser

For backend work, scripts, or anything that is not a web page. The session records notes, bugs, flags and the events of its endpoint, with the same summary, copy and export as a browser session. It replaces the current `debug_gateway` session type, which needed a placeholder URL.

### Commands

| Command | Where | What it does |
|---|---|---|
| `/new …` | home, summary | Parse the line, then confirm (see above) |
| `/sessions [search]` | home, summary | Session picker. Alias `/resume` |
| `/ingest` | all | Ingest endpoints of the project (see below) |
| `/attach` | home, summary | Return to the session recording in the background, including one started elsewhere (`terrific start` in a shell or by an agent), which home and summary pick up within 5 s with a notice |
| `/profiles` (`/profile`, `/model`), `/record` | home, summary | Manage browser profiles and pick the one `/new` starts from; choose what `/new` records |
| `/note <text>` | live | Same as typing plain text |
| `/bug [text]` | live | Same as Ctrl+Enter |
| `/flag [text]` | live | Same as Ctrl+Shift+Enter |
| `/screenshot`, `/snapshot` | live, browser only | Same as F5 and F6 |
| `/name <name>` | live, summary | Rename the session |
| `/copy` | live, summary | Agent prompt, bugs and errors, full context, or the ingest endpoint |
| `/export` | summary | Write `context.txt` in the session folder |
| `/stop` | live | Confirm (name editable), then stop and open the summary. The endpoint stays open |
| `/settings` | all | Defaults and the live log visibility |
| `/help` | all | Keys and commands |
| `/quit` | all | Leave the TUI |

Typing `/` opens a palette filtered as you type, matching names and aliases. Arrows choose, Tab completes, Enter runs. On home and summary, a known command typed without the slash also runs.

### Session picker

`/sessions` takes over the screen:

- A filter line (`filter ›`) that matches name or id as you type.
- A date gutter on the left that names the day only on its first row (Today, Yesterday, `Oct 7`), with pinned sessions first under a `Pinned` gutter.
- One row per session: name, and on wide terminals a **marks rail**, a line spanning the session's duration with `●` where bugs were reported and `◆` where flags were set, in their terrific web colors. Narrow terminals show duration and event count instead.
- The selected row gets a lavender bar `▌` and a darker row.
- On wide terminals, a preview pane: id, date, duration, event counts colored by type, errors, endpoints, the first bugs and flags, and whether it is legacy.

Keys: Enter opens the summary, or the live log of a session that is recording, Ctrl+F pins, Ctrl+R renames in place, Ctrl+D deletes after a second Ctrl+D, Esc closes. Legacy sessions can be opened and pinned; rename and delete refuse them.

### Profiles panel

`/profiles` (also `/profile` and `/model`, for people used to chat commands) lists `@clean` and the profiles terrific keeps: name, mode, browser and what it keeps or when it was saved, with `default` on the one `/new` starts from and `● open` on one open for setup. Keys: Enter makes it the default, Space opens its browser to log in and, pressed again, closes it (a snapshot profile saves then), Ctrl+N opens a form below the list (Name, Mode, Browser, URL; ↑↓ moves, ←→ changes), Ctrl+R renames in place, Ctrl+D deletes after a second Ctrl+D, Esc closes. Clean cannot be opened, renamed or deleted. A default profile that no longer exists falls back to `@clean` with a notice.

### Ingest view

`/ingest` lists the project's endpoints: state dot (orange when open), name, URL, event count and last activity, or why it is closed; a red `● session` mark shows the endpoint the recording session is linked to. Below, the selected endpoint's last events, live when it is open, even with no session running.

| Key | Action |
|---|---|
| Enter | Copy the URL with the payload fields and a `curl` example |
| Space | Close or reopen; the URL never changes |
| Ctrl+N | New endpoint, name typed inline |
| Ctrl+R | Rename; the URL does not change |
| Ctrl+D | Delete after a second Ctrl+D; the URL stops working for good |
| Esc | Close |

The endpoint linked to the recording session cannot be closed, renamed or deleted until the session stops.

### Keys

| Key | Action |
|---|---|
| Enter | Run a command; while recording, save the text as a note |
| Tab | Complete the command, or the `/new` part under the cursor |
| Ctrl+Enter | Mark a bug, with or without text |
| Ctrl+Shift+Enter | Mark a flag, with or without text (see R1) |
| F5 / F6 | Screenshot / page snapshot (browser sessions) |
| Up / Down with empty input | Inspect events; Enter expands one; Esc returns to live |
| PgUp / PgDn / End | Scroll the log; End follows new events again |
| Esc | Back out one level |
| Ctrl+C twice | Quit the TUI; recordings and endpoints keep running in the daemon |

While testing, focus is usually in the browser window, not the terminal. The recorder will also inject in-page shortcuts for screenshot, snapshot, bug and flag; which keys is decided in the spike (R4).

### Live log line

`time  tag  content  right-aligned detail`. Time is relative to the session start (`mm:ss.d`, same as the context file). A network line appears when the request leaves and gets its status and duration in place when the response arrives. Typing into a field collapses into one line; password fields only show the length. A bug or flag without text shows terrific web's default label ("Bug reported", "Flagged point of interest") dimmed. Ingest lines show the endpoint name and the source on the right.

The tag takes the terrific web color of its type (Tailwind v3 values, from `ActivityFeed.tsx` and `ReplaySidebar.tsx`):

| Tag | Type | Color |
|---|---|---|
| `net` | Network | emerald-400 `#34d399`, red-400 `#f87171` when 4xx/5xx |
| `log` | Console | blue-400 `#60a5fa`, red-400 when error |
| `act` | Action | zinc-400 `#a1a1aa` |
| `nav` | Page load | violet-400 `#a78bfa` |
| `shot`, `snap` | Screenshot, snapshot | cyan-400 `#22d3ee` |
| `ingest` | Ingest (`SERVER_LOG` in web) | orange-400 `#fb923c`, red-400 when error |
| `note` | Note | indigo-400 `#818cf8` |
| `bug` | Bug | red-500 `#ef4444` |
| `flag` | Flag | amber-500 `#f59e0b` |

Content stays neutral, except errors (red-400) and warnings (anygent amber).

### Persistence

The last setup (target, URL, profile, record choices), the live log visibility and the pinned sessions are saved per project in `settings.json`.

### Copy payloads

- **Agent prompt.** Session id and name, project path, time range, browser or not, the endpoint with its URL and state, counts, errors, the tester's bugs and flags with timestamps, absolute paths to `context.txt`, `events.jsonl` and screenshots, and two `terrific events` commands for targeted reads.
- **Bugs and errors.** Each bug and flag with the events from the 10 seconds before it, then failed requests and errors, then the context path.
- **Full context.** The whole `context.txt`.
- **Ingest endpoint.** URL, payload fields and a `curl` example for the session's endpoint.

## 3. Non-interactive CLI

Every command talks to the daemon and starts it if needed. Default output is a few lines of plain text meant for both people and agents. `--json` prints one JSON document (or NDJSON for streams). Exit code 0 on success, 1 on failure, 2 on bad usage. Commands that create things are idempotent where it makes sense, so an agent can run them without checking state first.

| Command | Purpose | Default output |
|---|---|---|
| `terrific` | Open the TUI | n/a |
| `terrific start [url] [name] [@profile] [#endpoint] [--flags]` | Start recording and return immediately. Same grammar as `/new`, without the confirmation | Session id, folder path, endpoint URL |
| `terrific stop [<id>] [--name <name>]` | Stop a session (the only running one if no id), optionally renaming it. No confirmation. The endpoint stays open | The summary |
| `terrific status` | Daemon, running sessions, open endpoints | One line each |
| `terrific sessions [--all-projects] [--legacy]` | List sessions | One line each |
| `terrific show <id>` | Summary of a session | Same as the TUI summary |
| `terrific note <id> <text>`, `terrific bug\|flag <id> [<text>]` | Add a note, or mark a bug or flag with optional text | Mark id and time |
| `terrific screenshot\|snapshot <id>` | Capture the page of a browser session | File path |
| `terrific events <id> [--type ...] [--around mm:ss --window 10s] [--at mm:ss --bodies] [--follow]` | Read events; `--follow` streams new ones until the session stops | Event lines |
| `terrific context <id> [--only bug,flag,note,errors]` | Write or refresh `context.txt` | Path, size, approximate tokens |
| `terrific prompt <id> [--bugs \| --full]` | Print what `/copy` copies | The text |
| `terrific ingest up <name>` | Create the endpoint, or reopen it if closed. Same URL every time | Name, URL, state |
| `terrific ingest down <name>` | Close it; the URL stays reserved | Confirmation |
| `terrific ingest list` | Endpoints of this project | One line each |
| `terrific ingest tail <name> [--follow]` | Events received by an endpoint, with or without a session | Event lines |
| `terrific ingest rename <name> <new>` | Rename; the URL does not change | Confirmation |
| `terrific ingest rm <name>` | Delete; the URL stops working | Confirmation |
| `terrific projects` | Known projects: id, path, last use | One line each |
| `terrific profiles` | Clean and the profiles terrific keeps, with their `@slug` | One line each |
| `terrific profiles add <name> [--snapshot] [--browser chrome|edge|chromium|comet] [--url <url>]` | Create a profile terrific keeps (section 5). Persistent by default | The new `@slug` |
| `terrific profiles open <name> [url] [--no-wait]` | Open the profile's browser without recording, to log in or set it up. Waits until the window closes or Enter; a snapshot profile saves then | Saved or closed |
| `terrific profiles close <name>` | Close a profile opened for setup; a snapshot profile saves first | State |
| `terrific profiles rename <name> <new>`, `terrific profiles rm <name>` | Rename or delete a profile terrific keeps, with its data. Refused while it is open or in use | Confirmation |
| `terrific daemon start\|stop\|status` | Manage the daemon explicitly | State |
| `terrific doctor` | Check Node, browser, data dir, daemon, port, legacy stores | Problems and fixes |

### Agent flow: "let's test the system fullstack"

```
terrific ingest up app                          # create or reopen; always the same URL
terrific start localhost:5173 "fullstack" #app  # browser session linked to app
terrific events <id> --follow                   # watch while the person tests
terrific stop <id>                              # app stays open for the next session
```

The app being tested keeps the endpoint URL in its own config (for example `.env`) and never needs to change it.

## 4. Ingest endpoints

An ingest endpoint is a URL that instrumented code posts diagnostic events to. It replaces the current "attachment" concept and, with sessions without a browser, the `debug_gateway` session type.

- **Named and project-scoped.** Each endpoint has a short name, unique in the project, usually the stage being built or validated, such as a ticket or feature (`checkout-v2`, `tck-142`). The name is the handle for commands and `#name` tokens.
- **Reserved URL.** `POST http://127.0.0.1:<port>/ingest/ing_<token>`, with a random token created once. The URL survives close, reopen, rename and daemon restarts, and only stops working when the endpoint is deleted. The token is kept because the ingest route has no auth token: a guessable URL would let any page open in the browser post fake events to localhost (inference, not tested).
- **Independent of sessions.** An open endpoint receives whether or not a session is running. Every event goes to the endpoint's own log.
- **One endpoint per session.** A session links to at most one endpoint, chosen in `/new` (by default the last one used if still open, otherwise the most recently active open one). While the session records, that endpoint's events are also copied into the session's `events.jsonl`, so the session folder is complete for an agent. Stopping the session does not touch the endpoint. Several sessions may link to the same endpoint over time, and one endpoint keeps receiving between them.
- **Lifecycle.** `open` or `closed`. Closed by you (`down`, Space in `/ingest`) or automatically after 24 h without events. Closed endpoints answer 410 and store nothing; `up`, `#name` in `/new`, or Space reopens them with the same URL. Unknown tokens answer 404 and never create anything.
- **Payload.** Same fields as `terrific/docs/improvements/telemetry-ingest-contract.md`: `message` (required), `source`, `diagnosticSlug`, `level`, `timestamp`, `data`. Stored once, without the current `lvl`/`src` duplicates. `sessionId` in the payload is no longer needed.

## 5. Storage

```
<data root>/                   Documents/.terrific on Windows, ~/.terrific elsewhere, TERRIFIC_HOME when set
  daemon.json                  pid, port, startedAt
  daemon.log
  token
  config.json                  browser executables, defaults
  projects.json                index: project id -> { cwd, createdAt, lastOpenedAt }
  profiles/
    qa-admin/
      profile.json             { name, mode, browser, url, createdAt, savedAt }
      browser/                 user data dir of a persistent profile
      state.json               saved cookies, localStorage and IndexedDB of a snapshot profile
  projects/
    k2m8q4zx/                  D:\work\shop-frontend
      project.json             { cwd, createdAt, lastOpenedAt }
      settings.json            last setup, live log visibility, pinned sessions
      sessions/
        2026-11-03_02-14-08_x7ootg10qc/
          session.json         metadata, config, linked endpoint
          events.jsonl         append-only, lossless, the only source of truth
          context.txt          latest agent context export
          screenshots/ss_<id>.png
      ingest/
        app/
          endpoint.json        { name, token, state, closedReason, createdAt, lastEventAt }
          events.jsonl         everything the endpoint received
  sessions/                    legacy store, read only
```

- **Project id.** 8 characters `[a-z0-9]`, the same format as the current workspace ids, so paths stay short (`Documents\.terrific\projects\k2m8q4zx`). The working directory is looked up in `projects.json`; if it is not there yet, terrific-cli reuses the id the directory already has in the old `workspaces.json` (for example `k2m8q4zx` for `shop-frontend`), and only creates a new id when there is none. Lookups compare the absolute path case-insensitively with any trailing `\.terrific` removed, which also merges the current duplicates such as `d:\…\blog-frontend` and `D:\…\blog-frontend` (the most recently used id wins). Each project folder also has `project.json` with its real path, so the index can be rebuilt and the folder explains itself when browsed. `terrific projects` lists id, path and last use.
- **Session folder.** `YYYY-MM-DD_HH-MM-SS_<id>` in UTC, as today, so legacy and new folders sort the same way.
- **Profiles terrific keeps.** Global, not per project, because a login serves every project. Two modes. `persistent` is its own user data dir under `profiles/<name>/browser`: every session reads and writes it like a normal browser, so logins and site data carry over; one browser at a time can use it. `snapshot` saves a Playwright storage state (cookies, localStorage, IndexedDB; not sessionStorage) with `terrific profiles open`, and every session starts from it in a fresh context, so what a session changes is dropped; several sessions can use it at once. This replaces terrific web's saved logins (`credentials.json`), which kept the same storage state. Owned profiles take their name as `@slug`; a browser profile with the same slug gets its browser appended (`@testing-comet`). Because their user data dirs are not a browser's default one, the Chrome 136 block (R2) does not apply. `state.json` holds session cookies and is never printed.
- **Endpoint folder.** Named after the endpoint and renamed with it; the token in `endpoint.json` is what the URL uses.
- **Lossless.** Filters and collapsing only apply when exporting context, never to what is stored. The current backend drops filtered network events from `events.json` at stop.
- **Legacy reader.** Reads `metadata.json`, `events.json` or `events.jsonl` and the `*-context.txt` files, in place, from two kinds of legacy store. The old per-workspace stores (`<path>\.terrific\sessions`, listed in `Documents/.terrific/workspaces.json`, for example `D:\work\shop\.terrific\sessions` with 4 sessions) belong to the project whose path matches. The global store `Documents/.terrific/sessions` (about 520 sessions) has no reliable project link, so its sessions only appear with `--legacy` and are never assigned to a project by guessing. A migration command is deferred.

## 6. Event model

Every line in `events.jsonl` is one record: `{ id, seq, at, t, kind, ...payload }`. `at` is the ISO time, `t` is milliseconds since the session start, `seq` is a monotonic counter. Payloads are typed objects, never JSON stored as a string.

| Kind | Payload | Replaces |
|---|---|---|
| `action` | `action` (click, input, change, select), `target` (label, selector, xpath), `value` or `valueLength` + `masked` | `ACTION` |
| `network` | `phase` (request, response, failed), `requestId`, `method`, `url`, `status`, `durationMs`, `requestBody`, `responseBody` (capped) | `NETWORK` request and response, which today are not linked |
| `console` | `level`, `text` | `CONSOLE` |
| `navigation` | `url`, `title` | `PAGE_RELOAD` |
| `snapshot` | `url`, `title`, `wordCount`, `markdown` | `SNAPSHOT` / `CRAWL` |
| `screenshot` | `file`, `bytes` | `SCREENSHOT` (no base64 preview in the log) |
| `note`, `bug`, `flag` | `text` (required for notes, null allowed for bugs and flags), `author` (tester or agent) | `NOTE`, `BUG`, `FLAG`. For terrific web, a null text is exported as "Bug reported" or "Flagged point of interest", the labels the web already uses |
| `ingest` | `endpoint` (name at the time), `message`, `source`, `diagnosticSlug`, `level`, `clientTime`, `data` | `SERVER_LOG` |
| `lifecycle` | `state` (started, stopped, interrupted, browser-closed) | WebSocket-only `SESSION_STOPPED` |

Readers fold `network` records by `requestId` into one request with its response. The context export keeps the current agent format (header, TOON event log, footer) so existing prompts and habits keep working.

## 7. Naming cleanup

| Today | terrific-cli |
|---|---|
| `HtmlCrawler`, `crawl`, `cr_` | Page snapshot (`snapshot`). It reads one page; nothing is crawled |
| `PAGE_RELOAD` | `navigation` |
| `SERVER_LOG`, `debug-ingest`, attachment | `ingest` event, ingest endpoint |
| `debug_gateway` session | Session without a browser linked to an endpoint |
| `credentials.json`, `credentialId`, `profileId`, `browserProfile` | Two separate concepts: **browser profile** (a real browser user data dir, `@slug`) and the **snapshot profile** terrific keeps (a saved storage state, section 5) |
| `BrowserSession` (also used without a browser) | `Recording` |
| Workspace, workspace hash | Project, project id (same ids, reused) |
| `terrific.pid` | `daemon.json` |
| Resolution presets (`FHD`, `HD`, `Tablet`, `Mobile`) | Removed; always Dynamic |
| Video, `recordingMode: screen`, `ScreenRecorder` | Removed |
| Pause (never actually pauses) | Removed until it is real |

## 8. Architecture

```
terrific-cli/
  src/
    core/       types, event model, project id lookup, /new grammar parser, stats, prompts, context render, redaction. Pure, no IO
    store/      filesystem store for projects, sessions, endpoints; legacy reader
    recorder/   browser launch, page instrumentation, in-page shortcuts, snapshot, screenshot
    daemon/     HTTP API, live event stream, session registry, ingest endpoints and idle expiry, lifecycle
    client/     typed client for the daemon API, shared by cli and tui
    cli/        argument parsing, commands, text and --json output
    tui/        screens, palette, /new assistant, pickers, key handling
  docs/
```

Rules: `core` imports nothing else. `store` and `recorder` know nothing about HTTP. `cli` and `tui` only reach the daemon through `client`, plus reading files whose paths the daemon returned. No singletons with side effects on import; the daemon builds its services at startup and passes them in. The `/new` parser lives in `core` so the TUI assistant and `terrific start` share it, including its messages.

- **Daemon.** One per machine, bound to `127.0.0.1`, token in `Documents/.terrific/token` for every route except `/ingest/*`. Default port 4569, so it can run next to the current terrific backend on 4568 during the transition. Live events go out over Server-Sent Events, which `events --follow`, `ingest tail --follow` and the TUI consume.
- **Restart behavior.** On startup the daemon marks sessions that were recording as `interrupted`. Endpoints keep their state and URL; the 24 h idle clock continues from `lastEventAt`.
- **Browser profiles.** Only `@clean` (a throwaway user data dir) and the profiles terrific keeps (section 5) are offered. The installed browsers' own profiles are not listed: Chrome, Edge and Comet all refused automation of them on the tester's machine (R2). The `Local State` reader that listed them stays in `src/recorder/profiles.ts` as a temporary dead path.

## 9. TUI technology

Chosen: `@earendil-works/pi-tui` with its alternate-screen renderer (`TuiAltScreen`). The TUI is one component that draws the whole screen; pi-tui supplies the differential renderer, key parsing (including the Kitty and modifyOtherKeys forms of Ctrl+Enter and Ctrl+Shift+Enter) and the clipboard. The key spike of step 1 was not run by hand in Windows Terminal, so Ctrl+Shift+Enter there stays risk R1, with `/flag` as the fallback.

Requirements it meets from the screens in section 2: fixed header and input with a scrolling log in between, around 10 updates per second without flicker, pickers, a palette and the `/new` assistant redrawing on every keystroke with the caret position, function keys, and raw keyboard input that can tell Ctrl+Enter from Enter. Tests drive the real renderer through a headless xterm at 110x34 and 80x24.

## 10. Risks

- **R1. Ctrl+Shift+Enter on Windows.** In Windows Terminal, Ctrl+Enter reaches the app as a different byte from Enter, but Node drops the modifier keys when it translates console input, so Ctrl+Shift+Enter will probably arrive the same as Ctrl+Enter. Sources: [Microsoft conpty keyboard spec](https://github.com/microsoft/terminal/blob/main/doc/specs/%234999%20-%20Improved%20keyboard%20handling%20in%20Conpty.md), [report on Windows Terminal](https://claudeissues.com/issue/87888-keybindings-ctrl-enter-shift-enter-never-reach-the-keybinding-matcher-on-windows), [report on libuv](https://claudeissues.com/issue/92771-windows-shift-enter-indistinguishable-from-enter-modifiers-dropped-by-libuv-cons). Mitigation: the spike tests it. If it fails, `/flag` stays and a second binding is added.
- **R2. Chrome profiles.** Since Chrome 136, Chrome ignores the automation switches when they point at its default user data directory, which is where real Chrome profiles live ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port?hl=zh-cn), [report verified on Chrome 151](https://github.com/trycua/cua/issues/2916)). Profiles of other Chromium browsers with their own user data dir, such as Comet, are expected to work; that is an inference, not a verified test. Edge is treated as allowed because the same Chrome 136 block has not been verified there; if a non-clean Edge (or Chromium, or Comet) profile fails to launch, the error says that browser did not accept automation for that profile. A browser also locks its user data dir while it is open, so a profile cannot be used while that browser is running with it. Mitigation: `doctor` and the profile picker check both conditions; profiles terrific keeps under `Documents/.terrific/profiles/` are the fallback. On 2026-11-03 a tester reported that Edge and Comet refuse their own profiles too, so no browser's own profiles are offered anymore.
- **R3. Two daemons during the transition.** The old backend and the new daemon both run browsers and write under `Documents/.terrific`. They use different ports and different folders (`sessions/` vs `projects/`), and the new one only reads `sessions/`.
- **R4. In-page shortcuts.** Shortcuts injected into the tested page can collide with the browser's own shortcuts or with the app's. The spike lists free combinations in Chrome and Comet before choosing.

## 11. Plan

The build steps, stack, standards and release process are in `docs/plan.md`.

**Optional**

- `filters.yaml` with a real YAML parser and the options the current file declares but nobody reads.
- `--all-projects` views and a status line showing the daemon from any directory.
- A configurable idle time per endpoint instead of the fixed 24 h.
- Snapshot deltas in the context export: later snapshots as a diff against the previous one, as terrific does today. Until then a repeated snapshot is marked unchanged and a changed one is exported in full.

**Deferred**

- terrific web reading `projects/` (web stays on its current storage).
- A command that copies legacy sessions into projects.
- Choosing the URL of an existing profile from the TUI; the CLI sets it with `terrific profiles open <name> <url>`.

**Out of scope**

- Video and whole-screen recording.
- Viewport presets.
