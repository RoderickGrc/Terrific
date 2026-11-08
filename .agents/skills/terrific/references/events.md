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

## Notes written in the browser

In any browser Terrific records, hold Alt and right-click to open the Note panel (plain right-click is untouched; works when action recording is off; top frame only). Point adds the clicked element as a chip (Up/Down change level, Enter or click to add, Esc cancels). Screenshot and Snapshot capture the page into the session and add a chip. Note saves with Ctrl+Enter, Bug with Ctrl+Shift+Enter; a bug can be empty. Esc closes and keeps the draft.

Note panel notes and bugs are stored as normal `note` / `bug` events with `author: 'tester'`. Chips serialize into the event text as:

- A `<pointed-section>` block on its own lines for each pointed element, captured when it was picked. It lists `Selector` (unique CSS selector; shadow roots are joined with ` >>> `), `Element`, and when present `Classes`, `Data attributes`, `Location` (landmark path), `Heading`, `Role`, `Accessible name`, `ARIA state`, `Text anchor`, siblings, `Children`, `Box` (size and page position, plus the viewport), `Positioning`, `Styles` and `Shadow DOM`. It describes where the element is, not its content. The page URL is not repeated: take it from the nearest `navigation` event before the note.
- `@ss_<id>.png`: a screenshot; open `screenshots/ss_<id>.png` in the session folder.
- `@snapshot:ev_<id>`: the id of a `snapshot` event (or `@snapshot` when no id was available). Read with `terrific events <session-id> --type snapshot --json` and match the record whose `id` is that `ev_<id>`.

Captures happen when the tester presses Screenshot or Snapshot, so each one is also its own event in the timeline, and a capture may exist that no note references. Copying from the panel puts this same text on the clipboard, and pasting it back turns valid references into chips again.

Limitations: the draft (unsent text and chips) lives in memory for the whole session, survives reloads, navigation and new tabs, and is discarded when the session stops; nothing is written to disk until it is sent. Screenshot previews can be blocked by a page's image CSP (the chip still works); iframes and closed shadow roots cannot be pointed into from the top frame.
