# Reading events

Times are offsets from the session start, written `mm:ss` (the output shows `mm:ss.d`).

## `terrific events <id>` options

| Option | Effect |
|---|---|
| `--type <list>` | Comma-separated kinds, or `errors` |
| `--around <mm:ss> --window <dur>` | A time window centered on an offset, such as `--around 01:20 --window 10s` |
| `--at <mm:ss>` | Events near an offset, including request and response bodies |
| `--bodies` | Include bodies, which are left out by default |
| `--limit <n>` | Print at most n events |
| `--follow` | Stream until the session stops |
| `--json` | Raw records |

`errors` matches:

- failed requests;
- responses with status 400 or higher;
- `console` errors;
- `ingest` events with level `error`.

`terrific context <id> --only bug,flag,note,errors` rewrites `context.txt` filtered; without `--only` it writes the full one again.

## Kinds

| Kind | Fields besides the common ones | Output tag |
|---|---|---|
| `action` | `action` (click, input, change, select), `target`, `value`, or `valueLength` + `masked` for passwords | `act` |
| `network` | `phase` (request, response, failed), `requestId`, `method`, `url`, `status`, `durationMs`, `errorText`, bodies | `net` |
| `console` | `level`, `text` | `log` |
| `navigation` | `url`, `title` | `nav` |
| `screenshot` | `file` | `shot` |
| `snapshot` | `url`, `title`, `markdown` | `snap` |
| `note`, `bug`, `flag` | `text` (may be null for bugs and flags), `author` (`tester` or `agent`) | same as the kind |
| `ingest` | `endpoint`, `message`, `source`, `diagnosticSlug`, `level`, `clientTime`, `data` | `ingest` |
| `lifecycle` | `state` (started, stopped, interrupted, browser-closed) | `life` |

Every record in `--json` output and in `events.jsonl` also has `id`, `seq`, `at` (ISO time) and `t` (ms since start). A network request and its response are two records that share a `requestId`. The text output and `context.txt` fold them into one line.

## Files

The session folder, printed by `start` and `prompt`, contains:

- `session.json`;
- `events.jsonl`, the lossless source of truth, so grep it directly when filters fall short;
- `context.txt`, written when the session stops;
- `screenshots/`.
