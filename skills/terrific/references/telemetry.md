# Telemetry

POST JSON to the URL printed by `terrific ingest up <name>`, which has the form `http://127.0.0.1:<port>/ingest/ing_<token>`.

| Field | Rule |
|---|---|
| `message` | Required, non-empty string. Short summary of what happened |
| `source` | `file:line` of the call, such as `src/cart/total.ts:42` |
| `diagnosticSlug` | The diagnostic this event tests |
| `level` | `debug`, `info`, `warn` or `error`; defaults to `info`. `error` events show up under `--type errors` |
| `timestamp` | When it happened at the source, as epoch ms or an ISO string |
| `data` | A small object of sanitized values |

## Responses

| Status | Meaning |
|---|---|
| 202 | Stored |
| 400 | Invalid payload; the body says which field |
| 404 | Unknown URL: the endpoint was deleted, or the URL came from another daemon |
| 410 | Endpoint closed. `terrific ingest up <name>` reopens it with the same URL |

## Constraints

- Bodies are limited to 1 MB.
- Any `Content-Type` is accepted and CORS is open, so browser code can post without headers, which avoids a preflight.
- Only this machine can post. The daemon listens on 127.0.0.1 and refuses any Host other than `127.0.0.1` or `localhost`, so code in a container or on another device cannot reach it.

## Snippets

JavaScript and TypeScript, for browsers and Node 18+:

```ts
// #region terrific temporary
fetch('INGEST_URL', {
  method: 'POST',
  body: JSON.stringify({
    message: 'total computed',
    source: 'src/cart/total.ts:42',
    diagnosticSlug: 'stale-cart-total',
    timestamp: Date.now(),
    data: { items: items.length, total },
  }),
}).catch(() => {});
// #endregion
```

Python, standard library only:

```python
# region terrific temporary
import json, threading, time, urllib.request

def _terrific(message, source, slug, level="info", **data):
    body = json.dumps({"message": message, "source": source, "diagnosticSlug": slug,
                       "level": level, "timestamp": int(time.time() * 1000), "data": data}).encode()
    def send():
        try:
            urllib.request.urlopen(urllib.request.Request("INGEST_URL", body), timeout=2)
        except Exception:
            pass
    threading.Thread(target=send, daemon=True).start()
# endregion
```

Shell, for scripts or to check the endpoint:

```sh
curl -s -X POST 'INGEST_URL' -d '{"message":"job started","source":"scripts/sync.sh:12","diagnosticSlug":"sync-skips-rows"}'
```

In other runtimes, use the simplest equivalent: a non-blocking POST with a short timeout and errors swallowed.

## Rules

- Telemetry must never block, throw, or change behavior.
- Never send secrets, tokens, passwords, cookies, authorization headers, API keys or personal data.
- Prefer ids, counts, booleans, status codes, durations, branch decisions and sanitized error names.
- Good places for events:
  - function entry and exit;
  - values before and after a critical operation;
  - the branch that was taken;
  - request and response boundaries;
  - state changes;
  - catch blocks.
- Keep the instrumentation unchanged while you fix, unless the evidence shows the instrumentation itself is wrong.
- Remove it only after a verification session passes, or when the user asks.
