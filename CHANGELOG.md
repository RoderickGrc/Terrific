# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffolding
- Session CLI: `start`, `stop`, `sessions`, `show`, marks, captures, `events`, `context`, `prompt`
- `TERRIFIC_HEADLESS=1` for `daemon run`
- Real browser profiles from each installed browser's `Local State`, `terrific profiles`, and `GET /v1/profiles`
- `terrific doctor` for Node, browser, data root, daemon, port, legacy stores and profiles
- Interactive TUI: `terrific` with no arguments in a terminal opens home, the `/new` assistant and confirmation, the live log, the stop confirmation, the summary, `/sessions`, `/ingest`, `/settings` and `/help`; without a terminal it prints the help
- Sessions started without a name are named after their local start time and page, for example `2026-11-03 08:22 haiku.ac`
- Profiles terrific keeps, either persistent (keeps logins and data like a normal browser) or snapshot (every session starts from a saved login and site data), managed with `terrific profiles add|open|close|rename|rm` and the `/profiles` panel in the TUI. The installed browsers' own profiles are no longer listed, since Chrome, Edge and Comet refuse automation of them
- Agent skill in `skills/terrific`, shipped with the package: the debugging workflow with ingest endpoints and sessions, plus references for telemetry, reading events and profiles
