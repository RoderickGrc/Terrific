---
name: terrific
description: Debug with runtime evidence through the terrific CLI. Ingest endpoints receive temporary telemetry from instrumented code. Sessions record it, with or without a browser that a person drives. Saved events and context are read back after the session stops. Use when debugging a bug, adding temporary instrumentation, testing a web app with the user, or when the user mentions terrific, a terrific session, or an ingest endpoint.
---

# terrific

terrific records debugging sessions on this machine. A browser session captures what a person does in a real browser (actions, network, console, navigation). It also captures the events instrumented code posts to the session's ingest endpoint. A session without a browser captures only the endpoint and the marks, for backends, scripts, tests and workers. Evidence is saved when the session stops and is read back with the CLI.

Debug with that evidence. Do not claim a root cause without it.

## Basics

- Run every command from the project root. The working directory is the project, and sessions and endpoints belong to it.
- Commands start the daemon when needed. If one fails, run `terrific doctor` and follow its fixes.
- `--json` prints one JSON document. Exit codes: 0 means ok, 1 means failure, 2 means bad usage.
- `terrific status` shows running sessions and open endpoints. `terrific sessions` lists this project's sessions.
- The data root holds secrets. Never read or print `token`, `credentials.json`, or a profile's `state.json` there.

## Workflow

1. Understand the symptom: expected behavior, actual behavior, and how to reproduce it. Read the relevant code before editing.
2. Write 3-5 diagnostics. Give each a stable slug (`stale-client-state`, `request-url-mismatch`) and say what runtime evidence would confirm or reject it.
3. Open an endpoint with `terrific ingest up checkout-v2`, which prints the URL.
   - Name it after the stage being built or validated, such as a ticket or feature (`checkout-v2`, `tck-142`). It is not named after a process.
   - Names use lowercase letters, digits and dashes, up to 32 characters.
   - Run `terrific ingest list` first, and reuse the endpoint of the current stage if there is one.
   - The same name keeps the same URL, even after a close or a daemon restart, so the URL can stay in the app's config for the whole stage.
   - Only post to URLs this command printed for this project.
4. Instrument 2-6 points with fire-and-forget POSTs to that URL. Go beyond 10 only with the user's approval.
   - Each event carries `message`, `source` (`file:line`) and `diagnosticSlug`.
   - Wrap the code in a marked region so it is easy to remove.
   - Reuse an existing logger or helper if it can post asynchronously.
   - Payload, snippets and safety rules: [references/telemetry.md](references/telemetry.md).
5. Start a session linked to the endpoint. Always state the target, because a bare `terrific start` repeats the last setup.
   - **Browser**, when UI, navigation, network or console matters: `terrific start localhost:5173 "checkout total" #checkout-v2`. A person drives the window. Add `@profile` to start logged in ([references/profiles.md](references/profiles.md)).
   - **No browser**, for server, script, test, worker or CLI flows: `terrific start "payment webhook" #checkout-v2 --no-browser`.
   - If the app is fullstack and the right choice is unclear, ask the user.
   - The command prints `session <id> recording`, the session folder and the endpoint URL.
6. Reproduce.
   - If you can reproduce the bug yourself (a test, a script, `curl`), do it without asking the user.
   - Otherwise give the user short numbered steps and wait until they confirm they are done. Mention restarts only when the instrumentation needs one.
   - While the session runs, mark moments yourself with `terrific note|bug|flag <id> [text]`.
   - In a browser session, `terrific screenshot <id>` captures the page and `terrific snapshot <id>` saves it as markdown.
   - To watch live, run `terrific events <id> --follow` in the background. It ends when the session stops.
7. Stop with `terrific stop <id>`, which prints the summary and writes `context.txt` in the session folder. Omit the id when only one session is recording.
   - "Session is not recording" means the user already stopped it, so go straight to the evidence.
   - Stopping leaves the endpoint open.
8. Read the evidence, cheapest first:
   - `terrific prompt <id>`: summary, bugs and flags with times, file paths, and ready-made targeted reads.
   - `terrific events <id> --type errors`, `--type ingest`, `--around 01:20 --window 10s`, `--at 01:20`. Details: [references/events.md](references/events.md).
   - `context.txt`, at the path `prompt` prints, when you need the whole timeline. `terrific context <id> --only bug,flag,note,errors` rewrites it filtered.
   - If nothing relevant was captured, do not guess. Either the code path was not reached or the events went elsewhere. Check `terrific ingest tail checkout-v2`, refine the instrumentation, and reproduce again.
9. Rate each diagnostic CONFIRMED, REJECTED or INCONCLUSIVE.
   - Cite events: message, source, status, time.
   - Fix only what the evidence supports, and undo changes made for rejected diagnostics.
   - If every diagnostic is rejected or inconclusive, write new ones about a different subsystem.
   - Never use sleeps or timeouts as a fix.
10. Verify in a new session with the instrumentation still in place, then compare it with the failing session.
11. Once verification passes, remove the temporary instrumentation, unless the user wants to keep it.

## Quick loop

Not every check needs a session. An open endpoint stores events with no session running.

1. `terrific ingest up checkout-v2`
2. Run the instrumented code.
3. `terrific ingest tail checkout-v2` (`--follow` streams).

Use a session when the evidence has to be saved with marks or a browser timeline, or compared before and after a fix.

## Production

When the bug only happens in production, do not instrument or deploy anything. Record the production page and add a console probe the user pastes: [references/production.md](references/production.md).

## Final answer

Give:

- the root cause in 1-3 sentences;
- evidence from the failing and the verification sessions, with ids and event times;
- the files changed and why;
- what was run;
- remaining risks.
