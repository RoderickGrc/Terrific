# Browser profiles

A browser session starts from a profile, picked with `@slug` in `terrific start`.

- `@clean` is a fresh browser every time.
- The profiles terrific keeps are global, shared by every project. Each project remembers its own default.
- Chrome, Edge and Comet refuse automation on their own everyday profiles, so terrific does not use them.

| Mode | Behavior | Use for |
|---|---|---|
| `persistent` (default) | A browser data folder that every session reads and writes, like a normal browser. One browser at a time can use it | Long-lived logins and site data that should evolve |
| `snapshot` | Saved cookies, localStorage and IndexedDB (not sessionStorage). Each session starts from that state in a fresh context, and its changes are dropped. Several sessions can use it at once | A fixed starting point, such as a logged-in test user |

## Commands

```sh
terrific profiles list                     # clean and kept profiles, with the default
terrific profiles add qa-admin --snapshot --browser chrome --url https://app.example.com/login
terrific profiles open qa-admin            # opens the browser without recording; waits until the window closes or Enter
terrific profiles open qa-admin --no-wait  # returns immediately; finish with profiles close
terrific profiles close qa-admin           # a snapshot profile saves first
terrific profiles rename qa-admin admin
terrific profiles rm admin
```

- Names use a-z, 0-9 and dashes, up to 32 characters. `clean` is reserved.
- `--browser` accepts chrome, edge, chromium or comet.
- Rename and delete are refused while the profile is open or in use.

## Setting up a login

The person logs in, never the agent.

1. Run `terrific profiles open <name> <url> --no-wait`.
2. Ask the user to log in in that window and tell you when they are done.
3. Run `terrific profiles close <name>`.

A snapshot profile saves when it closes. A save that finds nothing never overwrites an earlier good state.

Never type, ask for, or store passwords yourself. Never read `state.json` or the `browser/` folder of a profile.
