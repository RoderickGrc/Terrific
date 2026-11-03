# Debugging production

Use this when the bug only happens in production, or depends on production data, config or a deployed build. Production code is never instrumented, and nothing is deployed for the investigation.

By default, the user tests in their own browser, with their normal login and extensions. You open a session without a browser, and write a probe that the user pastes in the DevTools console. The probe sends the page's telemetry to the session's endpoint. terrific records no browser here, so the probe has to carry everything the evidence needs.

## Rules

- Read only. The probe never calls write endpoints, changes state, or clicks for the user.
- Never send tokens, cookies, storage values, request or response bodies, query strings, headers, or user data.
- Send methods, hosts, paths with ids masked, statuses, durations, error names, booleans and counts.
- Prefer a test account. Real users' data stays out of notes and probes.
- Before the user pastes a probe, say in one line what it captures.
- Fix locally, with the production evidence as the reason. Verify after the deploy, in a new session with the same probe.

## 1. Start a session without a browser

```sh
terrific ingest up tck-142
terrific start "prod invite link" #tck-142 --no-browser
```

Put the endpoint URL that `ingest up` printed into the probe.

## 2. The probe

The base captures, for any diagnostic:

- `fetch` and XHR requests;
- uncaught errors and unhandled rejections;
- `console.error` and `console.warn`;
- SPA navigation;
- tab visibility.

Add the hooks for the current diagnostic where the template marks them, such as DOM state, auth events, or a global the app exposes. Log only on change.

```js
// terrific probe: paste in the DevTools console of the page under test
(() => {
  const ENDPOINT = 'INGEST_URL'; // null in the terrific window, which already records network and console
  const slug = 'invite-link-expired';
  const MAX = 500;
  const send = window.fetch.bind(window);
  let count = 0;
  let reported = false;
  const report = (text) => { if (!reported) { reported = true; console.info('[terrific]', text); } };
  const clean = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.host + u.pathname
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d{4,}(?=\/|$)/g, '/:n');
    } catch { return 'invalid url'; }
  };
  const t = (message, data = {}, level = 'info') => {
    if (count++ >= MAX) return;
    const body = JSON.stringify({ message, diagnosticSlug: slug, source: 'devtools probe', level, timestamp: Date.now(), data });
    if (ENDPOINT === null) return console.info('[terrific]', body);
    send(ENDPOINT, { method: 'POST', body, keepalive: true })
      .then((r) => report(`ingest answered ${r.status}`))
      .catch((e) => report(`ingest blocked ${e.name} ${e.message}`));
  };
  const undo = [];
  const patch = (obj, key, wrap) => { const orig = obj[key]; obj[key] = wrap(orig); undo.push(() => { obj[key] = orig; }); };
  const on = (target, type, fn) => { target.addEventListener(type, fn); undo.push(() => target.removeEventListener(type, fn)); };
  const ms = (started) => Math.round(performance.now() - started);

  if (ENDPOINT !== null) {
    patch(window, 'fetch', (orig) => async function (input, init) {
      const url = clean(input instanceof Request ? input.url : String(input));
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const started = performance.now();
      try {
        const res = await orig.call(window, input, init);
        t('fetch', { method, url, status: res.status, ms: ms(started) }, res.ok ? 'info' : 'warn');
        return res;
      } catch (error) {
        t('fetch failed', { method, url, error: error?.name ?? 'Error', ms: ms(started) }, 'error');
        throw error;
      }
    });
    patch(XMLHttpRequest.prototype, 'open', (orig) => function (method, url, ...rest) {
      this.__terrific = { method: String(method).toUpperCase(), url: clean(String(url)) };
      return orig.call(this, method, url, ...rest);
    });
    patch(XMLHttpRequest.prototype, 'send', (orig) => function (...args) {
      const info = this.__terrific;
      const started = performance.now();
      if (info !== undefined) {
        this.addEventListener('loadend', () => {
          const bad = this.status === 0 || this.status >= 400;
          t('xhr', { ...info, status: this.status, ms: ms(started) }, bad ? 'warn' : 'info');
        }, { once: true });
      }
      return orig.apply(this, args);
    });
    on(window, 'error', (e) => t('error', { name: e.error?.name ?? 'Error', message: String(e.message).slice(0, 200), at: `${clean(e.filename || location.href)}:${e.lineno}` }, 'error'));
    on(window, 'unhandledrejection', (e) => t('unhandled rejection', { name: e.reason?.name ?? typeof e.reason, message: String(e.reason?.message ?? e.reason).slice(0, 200) }, 'error'));
    for (const level of ['error', 'warn']) {
      patch(console, level, (orig) => function (...args) {
        const text = args.map((a) => (typeof a === 'string' ? a : (a?.name ?? typeof a))).join(' ').slice(0, 200);
        t(`console.${level}`, { text }, level);
        return orig.apply(this, args);
      });
    }
    const nav = (how) => t('navigation', { how, path: clean(location.href) });
    for (const key of ['pushState', 'replaceState']) {
      patch(history, key, (orig) => function (...args) { const r = orig.apply(this, args); nav(key); return r; });
    }
    on(window, 'popstate', () => nav('popstate'));
  }

  on(document, 'visibilitychange', () => t('visibility', { state: document.visibilityState }));

  // Diagnostic hooks. Example: whether a dialog is open.
  let open;
  const watch = new MutationObserver(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if ((dialog !== null) === open) return;
    open = dialog !== null;
    t('dialog', { open, label: dialog?.getAttribute('aria-label') ?? null });
  });
  watch.observe(document.body, { childList: true, subtree: true });
  undo.push(() => watch.disconnect());

  window.__terrificUndo = () => { undo.reverse().forEach((fn) => fn()); t('probe removed'); };
  // Key names can carry user and record ids, so only their prefixes.
  const storage = [...new Set(Object.keys(localStorage).map((key) => key.split(':')[0]))];
  t('probe installed', { path: clean(location.href), storage });
})();
```

- `MAX` caps the events, so a loop in the app cannot flood the endpoint.
- Console text is cut to 200 characters. If the app logs user data, drop `text` and keep the level.
- Requests made before the paste are missed. Ask the user to paste first, then reproduce from the start of the flow.
- To time a function the app exposes, wrap it with `patch` and log its duration and outcome, never its arguments.

## 3. Steps for the user

1. Open the production page in their normal browser, logged in as they would test.
2. Press F12 and open Console. The first time, Chrome may ask them to type `allow pasting`.
3. Paste the probe and press Enter.
4. Check that the console shows `[terrific] ingest answered 202`.
5. Reproduce, and say when they are done.

If the console shows `ingest blocked` instead, something between the page and 127.0.0.1 refused the request:

| Cause | Sign | Fix |
|---|---|---|
| Ad blocker or privacy extension | `net::ERR_BLOCKED_BY_CLIENT` | Disable it for the site, then paste again |
| Chrome's [Local Network Access](https://developer.chrome.com/blog/local-network-access) | A permission prompt, or a block after denying it | Allow it for the site |
| The site's CSP `connect-src` | A CSP violation in the console | Use the terrific window (section 5) |

A reload or a full-page navigation drops the probe. The user can paste it again after each load, or save it in Sources, then Snippets, and run it from there. `__terrificUndo()` removes it without a reload.

## 4. Read the evidence

```sh
terrific stop <id>
terrific events <id> --type ingest --json
```

Use `--json`, because the text output leaves out `data`. `level` separates the noise: `error` and `warn` are failed requests, errors and console warnings, and `terrific events <id> --type errors` lists the `error` ones.

## 5. Alternative: the terrific window

Use a browser session when the ingest channel is blocked and cannot be unblocked, or when a timeline of the user's clicks and typing matters.

```sh
terrific start https://app.example.com/path "prod invite link" @prod-tester #tck-142
```

- terrific records network (with bodies at `--at`), console, actions and navigation by itself. That is often enough without a probe.
- If the flow needs a login, create a profile and let the user log in first ([profiles.md](profiles.md)). Use `snapshot` for a fixed test user.
- For state the page does not log, use the same probe with `ENDPOINT = null`. It then writes `console.info('[terrific]', ...)` lines, which the session records, and skips the network and console wrappers. Read them with `terrific events <id> --type console --json`.

## 6. Backend logs (optional)

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
