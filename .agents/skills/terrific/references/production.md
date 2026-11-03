# Debugging production

Use this when the bug only happens in production, or depends on production data, config or a deployed build. Production code is never instrumented, and nothing is deployed for the investigation. Evidence comes from three sources:

- a recorded browser session;
- a console probe that the user pastes, in that window or in their own browser;
- optionally, the platform's log stream.

## Rules

- Read only. The probe never calls write endpoints, changes state, or clicks for the user.
- Never print or send tokens, cookies, storage values, authorization headers, or user data. Log key names, ids, counts, booleans, statuses and durations.
- Prefer a test account. Real users' data stays out of notes and probes.
- Before the user pastes a probe, say in one line what it watches.
- Fix locally, with the production evidence as the reason. Verify after the deploy, in a new session.

## 1. Record the production page

```sh
terrific ingest up tck-142
terrific start https://app.example.com/path "prod invite link" @prod-tester #tck-142
```

- The session records network (with bodies at `--at`), console, actions and navigation, without touching the code. This is often enough on its own.
- If the flow needs a login, create a profile and let the user log in first ([profiles.md](profiles.md)). Use `snapshot` for a fixed test user.
- Ask the user to reproduce in that window, then stop and read the evidence as usual.

## 2. Console probe

When the network and console are not enough, write a probe for state the page does not log, such as:

- DOM state;
- event order (focus, visibility, auth events);
- which storage keys exist;
- globals the app exposes.

The user pastes the probe in the DevTools console. It reaches terrific through one of two channels:

| Channel | Where the user pastes | Session | Probe sends with |
|---|---|---|---|
| Console | The terrific window | Browser session (step 1) | `console.info('[terrific]', JSON.stringify(...))`, recorded as console events |
| Ingest | The user's own browser, already logged in | `terrific start "prod probe" #tck-142 --no-browser` | `fetch` to the endpoint URL |

- **Console** needs nothing from the browser. Always use `JSON.stringify`, because objects logged directly are recorded shortened, as `{a: 1, b: Array(2)}`.
- **Ingest** suits a bug that needs the user's real browser, extensions or login. A public page posting to 127.0.0.1 can be stopped in three places:
  - An ad blocker answers `net::ERR_BLOCKED_BY_CLIENT`. The user disables it for the site, or uses a window without extensions.
  - Chrome's [Local Network Access](https://developer.chrome.com/blog/local-network-access) may ask the user for permission.
  - The site's CSP `connect-src` may refuse it.
  - The probe reports the first answer in the console (`ingest answered 202` or `ingest blocked`). Check that line before asking for the reproduction.

Template, adapted per diagnostic. Set `URL` to the endpoint for the ingest channel, or to `null` for the console channel:

```js
// terrific probe: paste in the DevTools console
(() => {
  const URL = null; // or 'INGEST_URL'
  const slug = 'overlay-on-tab-switch';
  let reported = false;
  const report = (text) => { if (!reported) { reported = true; console.info('[terrific]', text); } };
  const t = (message, data = {}) => {
    const body = JSON.stringify({ message, diagnosticSlug: slug, source: 'devtools probe', timestamp: Date.now(), data });
    if (URL === null) return console.info('[terrific]', body);
    fetch(URL, { method: 'POST', body })
      .then((r) => report(`ingest answered ${r.status}`))
      .catch((e) => report(`ingest blocked ${e.name} ${e.message}`));
  };
  const undo = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    undo.push(() => target.removeEventListener(type, fn));
  };
  on(document, 'visibilitychange', () => t('visibility', { state: document.visibilityState }));
  let open;
  const watch = new MutationObserver(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if ((dialog !== null) === open) return;
    open = dialog !== null;
    t('dialog', { open, label: dialog?.getAttribute('aria-label') ?? null });
  });
  watch.observe(document.body, { childList: true, subtree: true });
  undo.push(() => watch.disconnect());
  window.__terrificUndo = () => { undo.forEach((fn) => fn()); t('probe removed'); };
  // Key names can carry user and record ids, so only their prefixes.
  const storage = [...new Set(Object.keys(localStorage).map((key) => key.split(':')[0]))];
  t('probe installed', { path: location.pathname, storage });
})();
```

- Log only on change, never on every mutation or frame.
- To time a function the app exposes, wrap it and log its duration and outcome, never its arguments.
- Paths and key names can carry ids. Send prefixes or counts unless the id is the evidence.

Steps for the user:

1. Press F12 and open Console. The first time, Chrome may ask them to type `allow pasting`.
2. Paste the probe, press Enter, and check for `probe installed` (console channel) or `ingest answered 202` (ingest channel).
3. Reproduce, and say when they are done.

A reload drops the probe. If the reproduction needs a reload or navigates to a full page, the user has two options:

- paste it again after each load;
- save it in Sources, then Snippets, and run it from there.

To remove the probe without a reload, run `__terrificUndo()`.

Read the probe's events with `--json`, because the text output leaves out `data`:

```sh
terrific events <id> --type console --json   # console channel
terrific events <id> --type ingest --json    # ingest channel
```

## 3. Backend logs (optional)

If the platform streams logs, forward them into the endpoint so they land in the same session timeline. For example, `wrangler tail <worker> --format pretty` for Cloudflare Workers.

```sh
wrangler tail haiku-engine --format pretty | node forward.mjs
```

```js
// forward.mjs (temporary): one ingest event per log line
import { createInterface } from 'node:readline';
const URL = 'INGEST_URL';
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  fetch(URL, {
    method: 'POST',
    body: JSON.stringify({ message: line.slice(0, 500), source: 'wrangler tail', diagnosticSlug: 'SLUG' }),
  }).catch(() => {});
}
```

- Filter lines in the forwarder when the stream carries user data.
- Run it in the background while the session records, and stop it when the session stops.
