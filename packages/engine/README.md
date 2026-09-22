# @jev-poker/engine

No-Limit Texas Hold'em in plain TypeScript: dealing, betting rules (min-raise, all-in for
less, no-reopen), side pots, 7-card hand evaluation, hand strength and equity estimates.
Zero dependencies. ESM only, Node 20+ and browsers.

    pnpm add @jev-poker/engine

```ts
import { Table, fixedBlinds, playerView } from "@jev-poker/engine";

const table = new Table({
  format: "cash",
  blinds: fixedBlinds(1, 2),
  startingStack: 200,
  seats: [{ id: 0, name: "Alice", kind: "human" }, { id: 1, name: "Bob", kind: "human" }],
  seed: 42, // omit for a random deck
});

let snapshot = table.startHand();
while (!snapshot.complete) {
  const seat = snapshot.actingSeat!;
  const legal = table.legalActions(seat); // { canFold, canCheck, callAmount, minRaiseTo, maxRaiseTo }
  table.act(seat, legal.canCheck ? { type: "check" } : { type: "call" });
  snapshot = table.snapshot()!;
}
```

`playerView(snapshot, seat, actionsTakenSoFar)` is what a seat is allowed to know — its own
cards, the board, stacks, the hand's history — and is the input `@jev-poker/agent` decides from.

Part of [jev-poker](https://github.com/nft-syou/jev-poker) — see it play at [jev-poker.syou.io](https://jev-poker.syou.io/). MIT.
