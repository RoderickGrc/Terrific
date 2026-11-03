# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository scaffolding
- Session CLI: `start`, `stop`, `sessions`, `show`, marks, captures, `events`, `context`, `prompt`
- `TERRIFIC_HEADLESS=1` for `daemon run`
- Real browser profiles from each installed browser's `Local State`, `terrific-cli profiles`, and `GET /v1/profiles`
- `terrific-cli doctor` for Node, browser, data root, daemon, port, legacy stores and profiles
