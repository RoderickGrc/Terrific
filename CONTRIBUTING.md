# Contributing

## Setup

Requires Node.js 22.19 or later.

```
npm ci
npm run check
```

`npm run check` runs Biome, `tsc --noEmit`, tests, the build, publint, and the packed-tarball allow list.

## Dependency rule

Layers import in one direction only. `test/architecture.test.ts` fails the build on a forbidden edge. The table lives in [plan.md section 3](docs/plan.md#dependency-rule).

## Code standards

Named exports only, no barrel `index.ts` files, kebab-case file names, `.ts` import extensions, and `strict` TypeScript as listed in [plan.md section 4](docs/plan.md#4-code-standards). Comments explain why, not what.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

Open one pull request per change. Update `CHANGELOG.md` under `## [Unreleased]` in that same pull request.
