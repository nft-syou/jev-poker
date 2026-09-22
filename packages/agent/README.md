# @jev-poker/agent

Poker CPU players that think with [TypeSafe Jev](https://typesafe.ai): the situation is
compressed into typed features and Jev answers three typed questions — what to do, how
much, and whether it means it — which are turned into a legal action. Also included: four
baseline bots (random, caller, rules, heuristic), five personas, and `playHand` to run a
table. ESM only, Node 20+ and browsers.

    pnpm add @jev-poker/agent @jev-poker/engine

## Ask the CPU what to do

```ts
import { JevAgent, createTypeSafeBackend, PRESET_PERSONAS } from "@jev-poker/agent";
import type { PlayerView, LegalActions } from "@jev-poker/engine";

const backend = createTypeSafeBackend({ apiKey: process.env.TYPESAFE_API_KEY! });
const tag = PRESET_PERSONAS.find((p) => p.id === "tag")!;
const cpu = new JevAgent({ persona: tag, backend, seed: 42 });

const action = await cpu.decide(view, legal); // view: PlayerView, legal: LegalActions
```

`view` is a `PlayerView` from `@jev-poker/engine` — build it with `playerView(...)` if you use
the engine, or fill one in from your own game state. If Jev cannot be reached the agent
fails open (check or fold) and reports why through `onDecision`.

## Run a whole table

```ts
import { Table, fixedBlinds } from "@jev-poker/engine";
import { JevAgent, RulesAgent, createTypeSafeBackend, PRESET_PERSONAS, playHand } from "@jev-poker/agent";

const table = new Table({
  format: "cash", blinds: fixedBlinds(1, 2), startingStack: 200, seed: 1,
  seats: [{ id: 0, name: "Jev", kind: "cpu" }, { id: 1, name: "Rules", kind: "cpu" }],
});
const backend = createTypeSafeBackend({ apiKey: process.env.TYPESAFE_API_KEY! });
const tag = PRESET_PERSONAS.find((p) => p.id === "tag")!;
const agents = [new JevAgent({ persona: tag, backend, seed: 1 }), new RulesAgent()];
for (let i = 0; i < 5; i++) await playHand(table, agents);
```

## Backends

`createTypeSafeBackend({ apiKey, baseURL?, model?, headers?, timeoutMs?, fetch?, browser? })`
talks to api.typesafe.ai by default. Point `baseURL` at a gateway that speaks the TypeSafe
API (Vercel AI Gateway: `https://ai-gateway.vercel.sh/typesafe`, model `typesafe-ai/jev`;
Lolipop: `https://ai-gateway.lolipop.jp`, model `typesafe/jev-latest`) or at your own proxy.
In a browser set `browser: true`; the key then belongs to the person at the keyboard.
`createMockBackend()` answers from hand strength alone, for tests.

## Personas

`PRESET_PERSONAS` (rock, tag, lag, maniac, station). A persona is a paragraph of text and a
`variance`; `duplicatePersona` makes an editable copy, `loadPersonas(storage)` /
`saveCustomPersonas(personas, storage)` persist custom ones through any
`{ getItem, setItem }` you pass — the library never reads `localStorage` on its own.

Part of [jev-poker](https://github.com/nft-syou/jev-poker). MIT.
