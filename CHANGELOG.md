# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- No-Limit Texas Hold'em engine (dealing, betting rules, side pots, hand
  evaluation) with seeded random-play tests.
- CPU players that decide through TypeSafe Jev: typed questions for action,
  sizing and bluff intent, five preset personas, editable custom personas.
- Four ways to reach Jev with your own credentials: TypeSafe direct, Vercel AI
  Gateway, Lolipop AI Gateway and Cloudflare AI Gateway, through a fixed-host
  proxy that stores nothing.
- Speculative prefetching of likely CPU decisions, with a toggle and an in-flight
  cap.
- Standings, play-style and Jev statistics, kept per session and cumulatively in
  the browser.
- A recording mode for the table with decision bubbles and a live ticker.
- Chips, callouts and an action feed on the felt, timed to the chosen speed.
- One-tap bet sizing (pot fractions after the flop, bet multiples before it) and
  a phone layout for the player's controls.
- A billing pause with a modal when the upstream answers 402.
- English and Japanese UI.
- A benchmark harness against baseline bots and Slumbot, with saved results.
- The engine and the CPU as npm packages: `@jev-poker/engine` and `@jev-poker/agent` (each has its own changelog under `packages/`).

[Unreleased]: https://github.com/nft-syou/jev-poker/commits/main
