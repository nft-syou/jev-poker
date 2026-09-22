# @jev-poker/agent

## 0.2.0

### Minor Changes

- [`d864044`](https://github.com/nft-syou/jev-poker/commit/d864044b4e54576148e79581b2e1c02f77a37fc3) Thanks [@nft-syou](https://github.com/nft-syou)! - First published versions: the No-Limit Hold'em engine, and the Jev CPU with baseline bots, personas and `playHand`.

- [`e616620`](https://github.com/nft-syou/jev-poker/commit/e6166209f9b416b1a20dae7eb5fcb46eadff1f2a) Thanks [@nft-syou](https://github.com/nft-syou)! - `LOSING_PLAYER` and `isLosingPlayer(hands, bb100)`: when a player's tendencies are worth adjusting to (measured: only players who are actually losing).

- [`d7905ab`](https://github.com/nft-syou/jev-poker/commit/d7905ab307915f28ef2b687dfa7084d9a69bc892) Thanks [@nft-syou](https://github.com/nft-syou)! - `createTypeSafeBackend` takes `maxRetries` (retries on 408/429/5xx, timeouts and connection errors; the SDK's default when omitted).

- Opponent types: `FeatureOptions.opponentTypeFor` adds `table.opponentTypes` and one line of counter-strategy per type in the hand; `classifyByThresholds` / `classifyWithJev` judge a type from session statistics (`OpponentStats` gains `foldToBetPct`).

### Patch Changes

- Updated dependencies [[`d864044`](https://github.com/nft-syou/jev-poker/commit/d864044b4e54576148e79581b2e1c02f77a37fc3)]:
  - @jev-poker/engine@0.2.0
