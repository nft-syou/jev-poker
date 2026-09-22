# Contributing to jev-poker

Thanks for taking the time. This page covers how to get a working checkout, what
a change needs before it can be merged, and where things live.

## Setup

Node.js 24 and pnpm 12 (`corepack enable` picks the pnpm version from
`package.json`).

    pnpm install
    pnpm dev            # Vite dev server with the proxy handler mounted at /api/jev
    pnpm check          # what CI runs: lint + typecheck + tests + build

Playing locally needs a TypeSafe API key or one of the gateway routes from the
README. Nothing in the repo needs a key: the engine, the proxy and the UI are all
tested without one, and `pnpm bench --backend mock` runs the benchmark against a
stand-in.

## Before opening a pull request

- `pnpm check` passes. It is the same command CI runs.
- New behaviour comes with a test next to the code (`*.test.ts` / `*.test.tsx`).
  The engine is tested with seeded random play, the proxy against a fake `fetch`,
  the UI with Testing Library in jsdom.
- Layout changes were looked at in a browser. jsdom computes no layout, so a CSS
  fix that is only reasoned about is not verified; measure it (phone width and
  desktop width) before saying it is fixed.
- The stylesheet is formatted by Biome (`pnpm format`), and `.gitattributes`
  keeps every text file on LF.
- User-facing strings go through i18n: add the key to both
  `src/i18n/locales/en.json` and `ja.json`.
- Commit messages follow Conventional Commits (`feat(ui): …`, `fix(proxy): …`,
  `docs: …`, `chore: …`), and the PR description explains why, not just what.

## Changes to the published packages

`packages/engine` and `packages/agent` are published to npm as `@jev-poker/engine` and
`@jev-poker/agent`. A change under `packages/` that users can notice — a new export, a
changed signature, a fixed bug — needs a changeset in the same PR:

    pnpm changeset

Pick the package(s), the bump (`patch` for fixes, `minor` for additions, `major` for
breaking changes) and write one sentence for the changelog. Merging to `main` opens or
updates a "Version Packages" PR; merging that PR publishes. Publishing relies on npm
trusted publishing (OIDC) from `release.yml`; if the first release fails at `pnpm publish`,
fall back to an `NPM_TOKEN` secret exposed as `NODE_AUTH_TOKEN` in that workflow.

`packages/agent/src/index.test.ts` pins the public export list. Adding an export means
updating that list on purpose, with a `minor` changeset.

## Things to keep true

- **The proxy never takes a URL from the browser.** Upstreams are the fixed hosts
  in `src/jev/connection.ts`, chosen by route id, with every interpolated value
  matched against an anchored regex first. A new route is a new constant and a
  new regex, never a pass-through.
- **The server stores and logs nothing.** No bindings in `wrangler.jsonc`, no
  `console.*` in `src/proxy` or `functions/`, and `cache-control: no-store` on
  every proxied response.
- **`src/jev/connection.ts` stays dependency-free**; `tsconfig.functions.json`
  compiles it for the Pages Function.
- **The engine has no dependencies** and no knowledge of the UI or of Jev.
- **Every CPU decision fails open**: if Jev cannot be reached the CPU checks or
  folds and the history says why.

## Reporting

- Bugs and feature requests: open an issue using the templates.
- Security problems: do not open an issue; see [SECURITY.md](SECURITY.md).

## Project layout

See the "Project layout" section of the [README](README.md#project-layout). The
design spec lives in `docs/superpowers/specs/` and is updated alongside changes
that alter the design (routes, proxy rules, persistence).

## License

By contributing you agree that your contributions are licensed under the MIT
License, like the rest of the project.
