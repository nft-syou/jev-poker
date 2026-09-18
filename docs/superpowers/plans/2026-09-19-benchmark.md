# jev-poker Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the poker engine, the three baseline agents, the Jev agent, and a CLI benchmark that measures the Jev CPU against the baselines in bb/100 with confidence intervals.

**Architecture:** A single TypeScript package. `src/engine` is a dependency-free hold'em state machine. `src/agents` defines the `Agent` interface plus `random` / `caller` / `rules` bots. `src/jev` compresses a `PlayerView` into a `systemOne` request and maps answers back to legal actions, with a deterministic mock backend. `bench/` runs independent hands in parallel with seat rotation, aggregates bb/100 + 95% CI, writes JSON, and prints a Markdown table.

**Tech Stack:** TypeScript 5 (strict, ESM, `NodeNext`), pnpm, Vitest, tsx, `@typesafe-ai/sdk@0.6.0`, Node 24.

**Spec:** `docs/superpowers/specs/2026-09-19-benchmark-design.md` (benchmark) and `docs/superpowers/specs/2026-09-19-jev-poker-design.md` (engine + Jev agent, §4–§6).

## Global Constraints

- `src/engine` imports nothing from `react`, `react-dom`, `src/jev`, `src/agents`, `bench`, or `@typesafe-ai/sdk` (verified by a test).
- All randomness goes through the xorshift PRNG in `src/engine/rng.ts`; same seed → same output.
- Chip unit: 1 bb = 100 chips. Benchmark stacks are 10,000 chips (100 bb), blinds 50/100, ante 0.
- Agents must return an action inside `LegalActions`; `Hand.act` throws on illegal actions.
- The Jev state and persona text sent to the API are English.
- CI never calls the real TypeSafe API. `--backend typesafe` requires `TYPESAFE_API_KEY`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Package scripts: `pnpm test` (vitest run), `pnpm typecheck` (tsc --noEmit), `pnpm bench`, `pnpm bench:report`.

---

## File Structure

```
package.json                  pnpm, scripts, deps
tsconfig.json                 strict ESM (module NodeNext, target ES2022, noEmit)
vitest.config.ts              include src/**/*.test.ts, bench/**/*.test.ts
.gitignore                    node_modules, dist, .env
src/engine/rng.ts             xorshift128+ PRNG, hash(...ints), shuffle
src/engine/cards.ts           Card/Suit/Rank, newDeck, cardToString, parseCard(s)
src/engine/evaluate.ts        evaluate7 → HandValue (category + ranks), compareHands
src/engine/strength.ts        preflopStrength (169 table), madeHand, draws
src/engine/types.ts           Action, LegalActions, Street, SeatConfig, GameConfig, Position, PlayerView, events
src/engine/pots.ts            buildPots(contributions, folded) → Pot[], awardPots
src/engine/hand.ts            Hand: betting rounds, legalActions, act, streets, showdown
src/engine/table.ts           Table: seats, stacks, button, startHand, events, rebuy, positions
src/engine/index.ts           re-exports
src/engine/*.test.ts          colocated tests
src/agents/types.ts           Agent interface
src/agents/random.ts          RandomAgent
src/agents/caller.ts          CallerAgent
src/agents/rules.ts           RulesAgent
src/agents/index.ts           createAgent(id, seed)
src/jev/personas.ts           Persona type + 5 presets
src/jev/compress.ts           compressState(view, legal, persona) → JevState
src/jev/questions.ts          buildQuestions(legal) → Questions
src/jev/backend.ts            JevBackend, createTypeSafeBackend, createMockBackend
src/jev/agent.ts              JevAgent (Agent impl) + DecisionRecord + answersToAction
src/jev/index.ts              re-exports
bench/matchups.ts             Opponent, Format, matchup expansion
bench/runner.ts               playHand, runMatch (concurrency, abort)
bench/stats.ts                summarize(hands) → Summary
bench/report.ts               resultsToMarkdown, pickLatest
bench/cli.ts                  pnpm bench entry (arg parsing, env check, write JSON)
bench/report-cli.ts           pnpm bench:report entry
bench/results/.gitkeep
bench/README.md
README.md                     project overview + ベンチマーク section (table pasted by hand)
```

---

### Task 1: Project scaffold and engine boundary test

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/engine/index.ts`, `src/engine/boundary.test.ts`

**Interfaces:**
- Produces: package scripts `test`, `typecheck`, `bench`, `bench:report`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "jev-poker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "bench": "tsx bench/cli.ts",
    "bench:report": "tsx bench/report-cli.ts"
  },
  "dependencies": {
    "@typesafe-ai/sdk": "0.6.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "bench"]
}
```

With `NodeNext`, relative imports must carry the `.js` extension (`import { x } from './rng.js'`). Use that everywhere.

- [ ] **Step 3: Create vitest.config.ts and .gitignore**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'bench/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules
dist
.env
```

- [ ] **Step 4: Write the boundary test**

`src/engine/boundary.test.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = ['react', 'react-dom', '@typesafe-ai/sdk', '../jev', '../agents', '../../bench'];

describe('engine boundary', () => {
  it('imports nothing outside src/engine and node builtins', () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec.startsWith('./') , `${f} imports ${spec}`).toBe(true);
        for (const bad of FORBIDDEN) expect(spec.includes(bad), `${f} imports ${spec}`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 5: Create `src/engine/index.ts`** with `export {};` for now, run `pnpm install`, then `pnpm test` and `pnpm typecheck`. Expected: 1 test passes, typecheck clean.

- [ ] **Step 6: Commit** `chore: scaffold package with vitest and engine boundary test`

---

### Task 2: PRNG and cards

**Files:**
- Create: `src/engine/rng.ts`, `src/engine/rng.test.ts`, `src/engine/cards.ts`, `src/engine/cards.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class Rng { constructor(seed: number); next(): number /* [0,1) */; int(n: number): number /* 0..n-1 */; pick<T>(xs: readonly T[]): T; shuffle<T>(xs: T[]): T[] /* in place */ }
  function hashSeed(...parts: number[]): number   // deterministic 32-bit mix
  type Suit = 'c' | 'd' | 'h' | 's'; type Rank = 2|3|...|14; interface Card { rank: Rank; suit: Suit }
  function newDeck(): Card[]; function cardToString(c: Card): string /* 'As', 'Td' */; function parseCard(s: string): Card; function parseCards(s: string): Card[] /* 'As Kd' */
  ```

- [ ] **Step 1: Write failing tests**

`rng.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from './rng.js';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('differs across seeds', () => expect(new Rng(1).next()).not.toBe(new Rng(2).next()));
  it('int(n) stays in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) { const v = r.int(6); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6); }
  });
  it('shuffle is a permutation and seed-stable', () => {
    const s1 = new Rng(3).shuffle([1, 2, 3, 4, 5]);
    const s2 = new Rng(3).shuffle([1, 2, 3, 4, 5]);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('hashSeed mixes parts', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(1, 2)).toBe(hashSeed(1, 2));
  });
});
```

`cards.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cardToString, newDeck, parseCard, parseCards } from './cards.js';

describe('cards', () => {
  it('deck has 52 unique cards', () => {
    const d = newDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map(cardToString)).size).toBe(52);
  });
  it('round-trips strings', () => {
    expect(cardToString(parseCard('As'))).toBe('As');
    expect(parseCard('Td')).toEqual({ rank: 10, suit: 'd' });
    expect(parseCards('As Kd 2c')).toHaveLength(3);
  });
  it('rejects garbage', () => expect(() => parseCard('Zz')).toThrow());
});
```

- [ ] **Step 2: Run tests, expect failures (module not found)**

- [ ] **Step 3: Implement `rng.ts`**

```ts
export function hashSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= (p | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export class Rng {
  private s0: number; private s1: number;
  constructor(seed: number) {
    this.s0 = hashSeed(seed, 1) || 0x1234567; this.s1 = hashSeed(seed, 2) || 0x89abcdef;
  }
  /** xorshift128 (32-bit lanes) → [0,1) */
  next(): number {
    let s1 = this.s0; const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23; s1 ^= s1 >>> 17; s1 ^= s0; s1 ^= s0 >>> 26;
    this.s1 = s1;
    return ((this.s0 + this.s1) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(xs: readonly T[]): T { const v = xs[this.int(xs.length)]; if (v === undefined) throw new Error('pick from empty'); return v; }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = this.int(i + 1); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; }
    return xs;
  }
}
export function randomSeed(): number {
  const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0]!;
}
```

- [ ] **Step 4: Implement `cards.ts`**

```ts
export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export interface Card { readonly rank: Rank; readonly suit: Suit }
export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_CHARS = '23456789TJQKA';
export function newDeck(): Card[] { const d: Card[] = []; for (const suit of SUITS) for (const rank of RANKS) d.push({ rank, suit }); return d; }
export function cardToString(c: Card): string { return RANK_CHARS[c.rank - 2]! + c.suit; }
export function parseCard(s: string): Card {
  const i = RANK_CHARS.indexOf(s[0]!.toUpperCase()); const suit = s[1] as Suit;
  if (s.length !== 2 || i < 0 || !SUITS.includes(suit)) throw new Error(`bad card: ${s}`);
  return { rank: (i + 2) as Rank, suit };
}
export function parseCards(s: string): Card[] { return s.trim().split(/\s+/).filter(Boolean).map(parseCard); }
```

- [ ] **Step 5: Run tests, expect pass. Commit** `feat(engine): add seeded rng and cards`

---

### Task 3: Hand evaluation (best 5 of 7)

**Files:**
- Create: `src/engine/evaluate.ts`, `src/engine/evaluate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type HandCategory = 'high_card'|'pair'|'two_pair'|'three_of_a_kind'|'straight'|'flush'|'full_house'|'four_of_a_kind'|'straight_flush';
  const CATEGORY_ORDER: readonly HandCategory[];             // ascending strength
  interface HandValue { category: HandCategory; ranks: number[] /* tie-break, high first */; score: number /* comparable integer */ }
  function evaluate5(cards: readonly Card[]): HandValue;
  function evaluate7(cards: readonly Card[]): HandValue;     // 5..7 cards; best of all 5-subsets
  function compareHands(a: HandValue, b: HandValue): number; // >0 if a wins
  ```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { compareHands, evaluate7 } from './evaluate.js';

const ev = (s: string) => evaluate7(parseCards(s));
describe('evaluate7', () => {
  it.each([
    ['As Ks Qs Js Ts 2c 3d', 'straight_flush'],
    ['Ah Ad Ac As Kd 2c 3d', 'four_of_a_kind'],
    ['Ah Ad Ac Ks Kd 2c 3d', 'full_house'],
    ['Ah 9h 7h 4h 2h Ks Kd', 'flush'],
    ['5h 4d 3c 2s Ad Kc Kd', 'straight'],            // wheel
    ['Ah Ad Ac 9s 7d 2c 3d', 'three_of_a_kind'],
    ['Ah Ad Kc Ks 7d 2c 3d', 'two_pair'],
    ['Ah Ad Kc Qs 7d 2c 3d', 'pair'],
    ['Ah Jd 9c 7s 5d 3c 2d', 'high_card'],
  ])('%s is %s', (cards, cat) => expect(ev(cards).category).toBe(cat));

  it('kicker decides', () => {
    expect(compareHands(ev('Ah Kd 2c 3d 5s 8h 9c'), ev('Ah Qd 2c 3d 5s 8h 9c'))).toBeGreaterThan(0);
  });
  it('board plays → tie', () => {
    expect(compareHands(ev('2h 3d Ah Kh Qh Jh Th'), ev('4c 5c Ah Kh Qh Jh Th'))).toBe(0);
  });
  it('higher two pair wins over lower two pair', () => {
    expect(compareHands(ev('Ah Ad 2c 2d 9s 8h 7c'), ev('Kh Kd Qc Qd 9s 8h 7c'))).toBeGreaterThan(0);
  });
  it('straight beats three of a kind; flush beats straight', () => {
    expect(compareHands(ev('5h 4d 3c 2s Ad Kc Qd'), ev('Ah Ad Ac 9s 7d 2c 3d'))).toBeGreaterThan(0);
    expect(compareHands(ev('Ah 9h 7h 4h 2h Ks Kd'), ev('5h 4d 3c 2s Ad Kc Qd'))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect failure. Step 3: Implement**

Algorithm for `evaluate5`: count ranks, detect flush (all same suit), detect straight (5 distinct consecutive ranks, or A-2-3-4-5 with high card 5). Build `ranks` as tie-break array: for pairs/trips/quads, the group ranks first (by group size then rank desc), then kickers desc. `score = categoryIndex * 15^5 + Σ ranks[i] * 15^(4-i)`. `evaluate7` enumerates all C(n,5) subsets (21 for 7) and keeps the max score. `compareHands = a.score - b.score`.

```ts
import type { Card } from './cards.js';
export type HandCategory = 'high_card'|'pair'|'two_pair'|'three_of_a_kind'|'straight'|'flush'|'full_house'|'four_of_a_kind'|'straight_flush';
export const CATEGORY_ORDER: readonly HandCategory[] = ['high_card','pair','two_pair','three_of_a_kind','straight','flush','full_house','four_of_a_kind','straight_flush'];
export interface HandValue { category: HandCategory; ranks: number[]; score: number }

function straightHigh(distinctDesc: number[]): number | null {
  const set = new Set(distinctDesc);
  for (const hi of distinctDesc) if ([hi-1,hi-2,hi-3,hi-4].every((r) => set.has(r))) return hi;
  if ([14,5,4,3,2].every((r) => set.has(r))) return 5;
  return null;
}
export function evaluate5(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5 needs 5 cards');
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]); // [rank,count]
  const distinctDesc = groups.map((g) => g[0]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const sHigh = groups.length === 5 ? straightHigh(distinctDesc) : null;
  let category: HandCategory; let ranks: number[];
  const byGroup = groups.map((g) => g[0]);
  if (sHigh !== null && flush) { category = 'straight_flush'; ranks = [sHigh]; }
  else if (groups[0]![1] === 4) { category = 'four_of_a_kind'; ranks = byGroup; }
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) { category = 'full_house'; ranks = byGroup; }
  else if (flush) { category = 'flush'; ranks = distinctDesc; }
  else if (sHigh !== null) { category = 'straight'; ranks = [sHigh]; }
  else if (groups[0]![1] === 3) { category = 'three_of_a_kind'; ranks = byGroup; }
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) { category = 'two_pair'; ranks = byGroup; }
  else if (groups[0]![1] === 2) { category = 'pair'; ranks = byGroup; }
  else { category = 'high_card'; ranks = distinctDesc; }
  let score = CATEGORY_ORDER.indexOf(category);
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return { category, ranks, score };
}
export function evaluate7(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluate7 needs 5..7 cards');
  let best: HandValue | null = null;
  const n = cards.length;
  const idx = [0, 1, 2, 3, 4];
  const visit = () => { const v = evaluate5(idx.map((i) => cards[i]!)); if (!best || v.score > best.score) best = v; };
  // enumerate combinations
  const rec = (start: number, depth: number) => {
    if (depth === 5) { visit(); return; }
    for (let i = start; i <= n - (5 - depth); i++) { idx[depth] = i; rec(i + 1, depth + 1); }
  };
  rec(0, 0);
  return best!;
}
export function compareHands(a: HandValue, b: HandValue): number { return a.score - b.score; }
```

- [ ] **Step 4: Run tests, pass. Commit** `feat(engine): add 7-card hand evaluator`

---

### Task 4: Hand strength helpers (preflop table, made hand, draws)

**Files:**
- Create: `src/engine/strength.ts`, `src/engine/strength.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type PreflopStrength = 'premium'|'strong'|'medium'|'weak'|'trash';
  function preflopStrength(hole: readonly Card[]): PreflopStrength;
  type Draw = 'flush_draw' | 'open_ended' | 'gutshot';
  function madeHand(hole: readonly Card[], board: readonly Card[]): HandCategory;  // board.length >= 3
  function draws(hole: readonly Card[], board: readonly Card[]): Draw[];         // empty on river or preflop
  ```

Preflop tiers (169-hand table collapsed to 5 tiers by standard 6-max opening ranges):
- premium: AA KK QQ JJ AKs AKo
- strong: TT 99 AQs AQo AJs KQs ATs KJs
- medium: 88 77 66 AJo KQo QJs JTs T9s KTs QTs A9s A8s A7s A6s A5s A4s A3s A2s ATo KJo
- weak: 55 44 33 22, any other suited connector/one-gap (98s 87s 76s 65s 54s J9s T8s 97s 86s), A9o..A2o, KTo QJo QTo JTo K9s Q9s J8s
- trash: everything else

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { draws, madeHand, preflopStrength } from './strength.js';

describe('preflopStrength', () => {
  it.each([
    ['Ah Ad', 'premium'], ['Ah Kh', 'premium'], ['Ah Kd', 'premium'],
    ['Th Td', 'strong'], ['Ah Qd', 'strong'], ['Kh Qh', 'strong'],
    ['8h 8d', 'medium'], ['Ah 5h', 'medium'], ['Ah Jd', 'medium'],
    ['2h 2d', 'weak'], ['9h 8h', 'weak'], ['Ah 2d', 'weak'],
    ['7h 2d', 'trash'], ['Kh 3d', 'trash'],
  ])('%s → %s', (h, t) => expect(preflopStrength(parseCards(h))).toBe(t));
});
describe('madeHand', () => {
  it('uses hole + board', () => expect(madeHand(parseCards('Ah Ad'), parseCards('Ac 7s 2d'))).toBe('three_of_a_kind'));
});
describe('draws', () => {
  it('flush draw', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7c'))).toContain('flush_draw'));
  it('open ended', () => expect(draws(parseCards('9h 8d'), parseCards('Tc 7s 2d'))).toContain('open_ended'));
  it('gutshot', () => expect(draws(parseCards('9h 8d'), parseCards('Tc 6s 2d'))).toContain('gutshot'));
  it('none on river', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7c 3d 4s'))).toEqual([]));
  it('no draw when already made', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7h'))).toEqual([]));
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement**

`preflopStrength`: build key like `'AKs'`/`'AKo'`/`'AA'` (high rank first) and look up in a `Record<string, PreflopStrength>` built from the tier lists above; default `'trash'`.

`madeHand`: `evaluate7([...hole, ...board]).category`.

`draws`: only when `board.length` is 3 or 4. Combine cards. `flush_draw`: some suit has exactly 4 cards (and not 5+). Straight draws: collect distinct ranks (treat A as 14 and 1); for each 5-rank window `[h-4..h]` that contains exactly 4 of our ranks, count it; if any window's missing rank is at an end (`h` or `h-4`) and there are two distinct windows completing different straights → `open_ended`; else if any window exists → `gutshot`. Simpler correct approach: count how many single ranks `r` (2..14) added to the set complete a straight (via `straightHigh` logic). If ≥ 2 distinct outs ranks → `open_ended`, if 1 → `gutshot`. Skip straight draws if hand already has a straight or better. Skip flush draw if already flush or better.

- [ ] **Step 4: Run tests, pass. Commit** `feat(engine): add preflop tiers, made hand and draw detection`

---

### Task 5: Types and side pots

**Files:**
- Create: `src/engine/types.ts`, `src/engine/pots.ts`, `src/engine/pots.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  type SeatId = number;
  type Street = 'preflop'|'flop'|'turn'|'river'|'showdown';
  type Position = 'BTN'|'SB'|'BB'|'UTG'|'MP'|'CO';
  type Action = {type:'fold'}|{type:'check'}|{type:'call'}|{type:'bet';amount:number}|{type:'raise';amount:number}|{type:'allin'};
  interface LegalActions { canFold: boolean; canCheck: boolean; callAmount: number|null; minRaiseTo: number|null; maxRaiseTo: number|null }
  interface SeatConfig { id: SeatId; name: string; kind: 'human'|'cpu'; agentId?: string }
  interface Blinds { small: number; big: number; ante: number }
  interface BlindSchedule { blindsFor(handNumber: number, elapsedMs: number): Blinds }
  function fixedBlinds(b: Blinds): BlindSchedule;
  interface GameConfig { format: 'cash'|'tournament'; blinds: BlindSchedule; startingStack: number; seats: SeatConfig[]; seed?: number }
  interface SeatState { seat: SeatId; stack: number; isAllIn: boolean; folded: boolean }
  interface HistoryEntry { street: Street; seat: SeatId; action: Action }
  interface PlayerView { seat: SeatId; street: Street; holeCards: Card[]; board: Card[]; stacks: SeatState[]; pot: number; toCall: number; bigBlind: number; position: Position; history: HistoryEntry[] }
  type TableEvent = {type:'HandStarted';handNumber:number;button:SeatId} | {type:'BlindsPosted';posts:{seat:SeatId;amount:number}[]} | {type:'HoleCardsDealt';seat:SeatId;cards:Card[]} | {type:'ActionTaken';seat:SeatId;action:Action;street:Street} | {type:'StreetDealt';street:Street;board:Card[]} | {type:'Showdown';hands:{seat:SeatId;cards:Card[];value:HandValue}[]} | {type:'PotAwarded';seat:SeatId;amount:number;potIndex:number} | {type:'HandEnded';stacks:{seat:SeatId;stack:number}[]} | {type:'SeatRebought';seat:SeatId;amount:number};
  ```
- Produces (`pots.ts`):
  ```ts
  interface Pot { amount: number; eligible: SeatId[] }
  function buildPots(contributed: Map<SeatId, number>, folded: Set<SeatId>): Pot[];   // layered by contribution level
  function awardPots(pots: Pot[], ranking: (seat: SeatId) => number /* higher wins */, oddChipOrder: SeatId[]): { seat: SeatId; amount: number; potIndex: number }[];
  ```

- [ ] **Step 1: Write failing tests for pots**

```ts
import { describe, expect, it } from 'vitest';
import { awardPots, buildPots } from './pots.js';

describe('buildPots', () => {
  it('single pot when equal contributions', () => {
    expect(buildPots(new Map([[0, 100], [1, 100]]), new Set())).toEqual([{ amount: 200, eligible: [0, 1] }]);
  });
  it('layers side pots by all-in level', () => {
    // seat 0 all-in 50, seats 1 and 2 put 200 each
    expect(buildPots(new Map([[0, 50], [1, 200], [2, 200]]), new Set())).toEqual([
      { amount: 150, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] },
    ]);
  });
  it('folded seats contribute but are not eligible', () => {
    expect(buildPots(new Map([[0, 100], [1, 100], [2, 30]]), new Set([2]))).toEqual([
      { amount: 90, eligible: [0, 1] }, { amount: 140, eligible: [0, 1] },
    ].map((p) => p) );
  });
});
describe('awardPots', () => {
  it('splits ties and gives odd chip by order', () => {
    const pots = [{ amount: 201, eligible: [0, 1] }];
    expect(awardPots(pots, () => 5, [1, 0])).toEqual([
      { seat: 1, amount: 101, potIndex: 0 }, { seat: 0, amount: 100, potIndex: 0 },
    ]);
  });
  it('best eligible hand takes each pot', () => {
    const pots = [{ amount: 150, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }];
    const rank = (s: number) => ({ 0: 9, 1: 3, 2: 7 } as Record<number, number>)[s]!;
    expect(awardPots(pots, rank, [0, 1, 2])).toEqual([
      { seat: 0, amount: 150, potIndex: 0 }, { seat: 2, amount: 300, potIndex: 1 },
    ]);
  });
});
```

Note: in the "folded seats" test, merge consecutive layers with identical eligible sets. Expected result is `[{ amount: 230, eligible: [0, 1] }]`. Fix the test to expect that single merged pot.

- [ ] **Step 2: Run (fail). Step 3: Implement**

`buildPots`: levels = sorted distinct positive contributions. For each level `L` (with previous `P`), pot amount = Σ over seats of `min(contrib, L) - min(contrib, P)`; eligible = seats with `contrib >= L` and not folded. Drop zero-amount pots; merge a pot into the previous one when eligible sets are equal.

`awardPots`: for each pot, find max ranking among eligible; winners = eligible with that ranking; share = floor(amount / winners.length); remainder distributed one chip each following `oddChipOrder` (first winners in that order get the extra). Emit entries in `oddChipOrder` order for winners.

- [ ] **Step 4: Write `types.ts` with the declarations above plus `fixedBlinds`. Run tests + typecheck. Commit** `feat(engine): add shared types and side pot logic`

---

### Task 6: Hand state machine

**Files:**
- Create: `src/engine/hand.ts`, `src/engine/hand.test.ts`

**Interfaces:**
- Consumes: `Rng`, `newDeck`, `evaluate7`, `buildPots`, `awardPots`, types.
- Produces:
  ```ts
  interface HandInit { seats: { seat: SeatId; stack: number }[]; button: SeatId; blinds: Blinds; rng: Rng; handNumber: number }
  class Hand {
    constructor(init: HandInit, emit: (e: TableEvent) => void);
    readonly street: Street;              // 'showdown' after the hand ends
    readonly isOver: boolean;
    readonly board: Card[];
    readonly toAct: SeatId | null;        // null when over
    holeCards(seat: SeatId): Card[];
    legalActions(seat: SeatId): LegalActions;
    act(seat: SeatId, action: Action): void;   // throws on illegal
    view(seat: SeatId): Omit<PlayerView, 'position'>;   // Table adds position
    finalStacks(): { seat: SeatId; stack: number }[];
    wentToShowdown: boolean;
  }
  ```

Rules to implement (NLHE):
- Order: seats sorted by id; only seats with stack > 0 participate. Blinds: heads-up → button posts SB and acts first preflop, other seat posts BB; 3+ → SB is next after button, BB after SB. Antes posted before blinds if > 0. Posting is capped by stack (all-in).
- Deal 2 cards each starting left of button, from `rng.shuffle(newDeck())`.
- Preflop first to act: seat after BB (heads-up: button). Postflop: first active seat after button.
- Street ends when every non-folded, non-all-in player has matched the current bet and has acted since the last raise (or checked around). If ≤1 player can still act (others all-in/folded), run out the board.
- `legalActions(seat)`: `canFold = toCall > 0`; `canCheck = toCall === 0`; `callAmount = min(toCall, stack)` or null when 0; `minRaiseTo = currentBet + max(lastRaiseSize, bigBlind)` (bet when currentBet 0 → `bigBlind`), null when stack cannot exceed call (all-in for less is via `allin`); `maxRaiseTo = committedThisStreet + stack`; if `minRaiseTo > maxRaiseTo` then `minRaiseTo = maxRaiseTo` (all-in raise).
- `act`: validate against `legalActions`; `bet`/`raise` amounts are "raise to" totals for this street; `allin` = put whole stack. A raise smaller than a full raise (all-in) does not reopen betting for players who already acted. Emit `ActionTaken`.
- Showdown: evaluate7 for each non-folded seat; `Showdown` event; award via `buildPots`/`awardPots` with odd chips starting from first seat left of button; `PotAwarded` events; then `HandEnded`. If everyone else folds, award the whole pot without showdown (`wentToShowdown=false`).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Hand } from './hand.js';
import { Rng } from './rng.js';
import type { TableEvent } from './types.js';

function mk(stacks: number[], seed = 1, button = 0) {
  const events: TableEvent[] = [];
  const hand = new Hand({ seats: stacks.map((stack, seat) => ({ seat, stack })), button, blinds: { small: 50, big: 100, ante: 0 }, rng: new Rng(seed), handNumber: 0 }, (e) => events.push(e));
  return { hand, events };
}

describe('Hand heads-up', () => {
  it('button posts SB and acts first preflop', () => {
    const { hand } = mk([10000, 10000]);
    expect(hand.toAct).toBe(0);
    const la = hand.legalActions(0);
    expect(la).toEqual({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 10000 });
  });
  it('fold ends hand and awards pot', () => {
    const { hand, events } = mk([10000, 10000]);
    hand.act(0, { type: 'fold' });
    expect(hand.isOver).toBe(true);
    expect(hand.finalStacks()).toEqual([{ seat: 0, stack: 9950 }, { seat: 1, stack: 10050 }]);
    expect(events.some((e) => e.type === 'HandEnded')).toBe(true);
    expect(hand.wentToShowdown).toBe(false);
  });
  it('call then check goes to flop, BB acts first postflop', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' });
    expect(hand.toAct).toBe(1);
    hand.act(1, { type: 'check' });
    expect(hand.street).toBe('flop');
    expect(hand.board).toHaveLength(3);
    expect(hand.toAct).toBe(1);
  });
  it('check-check through river reaches showdown and is zero-sum', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'check' });
    for (const s of ['flop', 'turn', 'river'] as const) {
      expect(hand.street).toBe(s);
      hand.act(1, { type: 'check' }); hand.act(0, { type: 'check' });
    }
    expect(hand.isOver).toBe(true);
    expect(hand.wentToShowdown).toBe(true);
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(20000);
  });
  it('raise / re-raise sets minRaise by last raise size', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'raise', amount: 300 });         // raise to 300 (raise size 200)
    expect(hand.legalActions(1).minRaiseTo).toBe(500);
    hand.act(1, { type: 'raise', amount: 900 });         // raise size 600
    expect(hand.legalActions(0).minRaiseTo).toBe(1500);
  });
  it('rejects illegal actions', () => {
    const { hand } = mk([10000, 10000]);
    expect(() => hand.act(1, { type: 'call' })).toThrow();          // not your turn
    expect(() => hand.act(0, { type: 'check' })).toThrow();         // facing SB->BB
    expect(() => hand.act(0, { type: 'raise', amount: 150 })).toThrow(); // below min
  });
  it('all-in call runs out the board', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'allin' });
    hand.act(1, { type: 'call' });
    expect(hand.isOver).toBe(true);
    expect(hand.board).toHaveLength(5);
  });
  it('is seed-reproducible', () => {
    const a = mk([10000, 10000], 9), b = mk([10000, 10000], 9);
    expect(a.hand.holeCards(0)).toEqual(b.hand.holeCards(0));
  });
});

describe('Hand 3+ players', () => {
  it('UTG acts first preflop; SB first postflop', () => {
    const { hand } = mk([10000, 10000, 10000]);
    expect(hand.toAct).toBe(0);                   // button=0, SB=1, BB=2, UTG=button in 3-handed
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'call' }); hand.act(2, { type: 'check' });
    expect(hand.street).toBe('flop');
    expect(hand.toAct).toBe(1);
  });
  it('side pots: short stack all-in, others continue', () => {
    const { hand } = mk([300, 10000, 10000]);
    hand.act(0, { type: 'allin' });                       // 300
    hand.act(1, { type: 'raise', amount: 1000 });
    hand.act(2, { type: 'call' });
    // seat 0 is all-in; seats 1 and 2 keep playing
    expect(hand.street).toBe('flop');
    expect(hand.toAct).toBe(1);
    while (!hand.isOver) hand.act(hand.toAct!, { type: 'check' });
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(20300);
  });
  it('short all-in raise does not reopen betting', () => {
    const { hand } = mk([10000, 10000, 350]);             // seat 2 = BB with 350
    hand.act(0, { type: 'raise', amount: 300 });
    hand.act(1, { type: 'call' });
    hand.act(2, { type: 'allin' });                       // to 350: not a full raise
    expect(hand.legalActions(0)).toMatchObject({ canFold: true, callAmount: 50, minRaiseTo: null });
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement `hand.ts`** following the rules above. Internal state: `stacks: Map`, `committed: Map` (this street), `contributed: Map` (whole hand), `folded: Set`, `allIn: Set`, `currentBet`, `lastRaiseSize`, `actedSinceRaise: Set`, `deck`, `hole: Map<SeatId, Card[]>`, `board`, `history`. Keep the file under ~350 lines; put the "next to act" and "street complete" helpers as private methods.

- [ ] **Step 4: Run tests until pass; also `pnpm typecheck`. Commit** `feat(engine): add hand state machine with side pots and showdown`

---

### Task 7: Table, positions, PlayerView

**Files:**
- Create: `src/engine/table.ts`, `src/engine/table.test.ts`; Modify: `src/engine/index.ts` (export everything).

**Interfaces:**
- Produces:
  ```ts
  function positionOf(seat: SeatId, button: SeatId, activeSeats: SeatId[]): Position;
  class Table {
    constructor(config: GameConfig);
    on(listener: (e: TableEvent) => void): () => void;
    readonly handNumber: number; readonly button: SeatId;
    stacks(): { seat: SeatId; stack: number }[];
    startHand(): Hand;                   // rotates button (except first hand), applies rebuy for cash at hand end
    currentHand(): Hand | null;
    view(seat: SeatId): PlayerView;      // hand.view + position
  }
  ```
- Position rules: HU → button = `BTN`, other = `BB`. 3 players → BTN, SB, BB. 4 → +UTG. 5 → +MP... Precisely: seats after BB in order get `UTG`, `MP`, `CO` for 6; for 4 → UTG only... use: order after BB = [UTG, MP, CO] and for n<6 take the first (n-3) labels but always label the seat right before BTN as `CO` when n ≥ 5.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Table, positionOf } from './table.js';
import { fixedBlinds } from './types.js';

const cfg = (n: number, seed = 1) => ({
  format: 'cash' as const, blinds: fixedBlinds({ small: 50, big: 100, ante: 0 }), startingStack: 10000,
  seats: Array.from({ length: n }, (_, id) => ({ id, name: `s${id}`, kind: 'cpu' as const })), seed,
});

describe('positionOf', () => {
  it('heads-up', () => { expect(positionOf(0, 0, [0, 1])).toBe('BTN'); expect(positionOf(1, 0, [0, 1])).toBe('BB'); });
  it('6-max', () => expect([0,1,2,3,4,5].map((s) => positionOf(s, 0, [0,1,2,3,4,5]))).toEqual(['BTN','SB','BB','UTG','MP','CO']));
  it('5-handed labels CO before button', () => expect([0,1,2,3,4].map((s) => positionOf(s, 0, [0,1,2,3,4]))).toEqual(['BTN','SB','BB','UTG','CO']));
});
describe('Table', () => {
  it('starts hands, rotates button, emits events', () => {
    const t = new Table(cfg(3)); const types: string[] = []; t.on((e) => types.push(e.type));
    const h = t.startHand(); expect(t.button).toBe(0);
    while (!h.isOver) h.act(h.toAct!, { type: 'fold' });
    expect(types[0]).toBe('HandStarted'); expect(types).toContain('HandEnded');
    t.startHand(); expect(t.button).toBe(1);
  });
  it('view includes position and hides other hole cards', () => {
    const t = new Table(cfg(2)); t.startHand();
    const v = t.view(0);
    expect(v.position).toBe('BTN'); expect(v.holeCards).toHaveLength(2); expect(v.bigBlind).toBe(100); expect(v.toCall).toBe(50);
  });
  it('cash game rebuys a busted seat', () => {
    const t = new Table({ ...cfg(2), startingStack: 100 });
    const h = t.startHand(); h.act(0, { type: 'allin' }); h.act(1, { type: 'call' });
    t.startHand();
    expect(t.stacks().every((s) => s.stack > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement `table.ts`**: keep `stacks`, `button`, `handNumber`, `startedAt`; `startHand()` finalizes the previous hand (copy `finalStacks`, rebuy zero stacks to `startingStack` emitting `SeatRebought` when `format==='cash'`), rotates the button to the next seat with chips (first hand keeps configured button = lowest seat id), creates `new Rng(hashSeed(seed, handNumber))`, constructs `Hand`. `view(seat)` = `{ ...hand.view(seat), position: positionOf(seat, button, activeSeats) }`.

- [ ] **Step 4: Update `src/engine/index.ts` to re-export rng, cards, evaluate, strength, types, pots, hand, table. Run all tests + typecheck. Commit** `feat(engine): add table with positions, events and rebuy`

---

### Task 8: Agent interface, RandomAgent, CallerAgent

**Files:**
- Create: `src/agents/types.ts`, `src/agents/random.ts`, `src/agents/caller.ts`, `src/agents/index.ts`, `src/agents/agents.test.ts`, `src/agents/testutil.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Agent { readonly id: string; decide(view: PlayerView, legal: LegalActions): Promise<Action> }
  class RandomAgent implements Agent { constructor(seed: number) }
  class CallerAgent implements Agent {}
  type BaselineId = 'random' | 'caller' | 'rules';
  function createAgent(id: BaselineId, seed: number): Agent;
  // testutil: function isLegal(action: Action, legal: LegalActions): boolean; function randomView(rng: Rng): { view: PlayerView; legal: LegalActions }
  ```

- [ ] **Step 1: Write `testutil.ts`** — `isLegal` checks: fold needs `canFold`; check needs `canCheck`; call needs `callAmount !== null`; bet/raise need `minRaiseTo !== null` and `minRaiseTo <= amount <= maxRaiseTo`; allin always legal when `maxRaiseTo !== null` or `callAmount !== null`. `randomView(rng)` builds a plausible view: random 2 hole cards + 0/3/4/5 board cards from a shuffled deck, random pot/toCall, and a consistent `LegalActions` (either `toCall=0` with canCheck, or `toCall>0` with canFold/callAmount; `minRaiseTo` = `toCall + bigBlind` or null 20% of the time; `maxRaiseTo` = 10000).

- [ ] **Step 2: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/rng.js';
import { createAgent } from './index.js';
import { isLegal, randomView } from './testutil.js';

describe.each(['random', 'caller', 'rules'] as const)('%s agent', (id) => {
  it('always returns a legal action', async () => {
    const rng = new Rng(11); const agent = createAgent(id, 5);
    for (let i = 0; i < 500; i++) { const { view, legal } = randomView(rng); const a = await agent.decide(view, legal); expect(isLegal(a, legal), JSON.stringify({ a, legal })).toBe(true); }
  });
  it('is deterministic for a seed', async () => {
    const mk = () => { const rng = new Rng(3); const agent = createAgent(id, 8); return Promise.all(Array.from({ length: 50 }, () => { const { view, legal } = randomView(rng); return agent.decide(view, legal); })); };
    expect(await mk()).toEqual(await mk());
  });
});
describe('caller', () => {
  it('never folds or raises', async () => {
    const rng = new Rng(1); const agent = createAgent('caller', 0);
    for (let i = 0; i < 200; i++) { const { view, legal } = randomView(rng); const a = await agent.decide(view, legal); expect(['check', 'call']).toContain(a.type); }
  });
});
```

(The `rules` case will fail until Task 9; that is expected. Skip it in this task by temporarily using `['random','caller']` and restore in Task 9.)

- [ ] **Step 3: Implement**

`random.ts`: choose uniformly among available kinds (`fold` if canFold, `checkcall`, `raise` if minRaiseTo !== null). For raise: candidates `[minRaiseTo, toCall + pot/2, toCall + pot, maxRaiseTo]` mapped to "raise to" = `view.toCall + candidate` where applicable — simpler: candidates in "raise to" terms `[min, min + pot/2, min + pot, max]`, pick one, clamp to `[min, max]`, round to integer; emit `{type: legal.canCheck ? 'bet' : 'raise', amount}` (`bet` when nobody has bet: `canCheck === true`), or `{type:'allin'}` when amount === max.

`caller.ts`: `canCheck ? check : call`.

`index.ts`: `createAgent` switch; `rules` case added in Task 9 (throw for now).

- [ ] **Step 4: Run tests, pass. Commit** `feat(agents): add Agent interface, random and caller baselines`

---

### Task 9: RulesAgent

**Files:**
- Create: `src/agents/rules.ts`, `src/agents/rules.test.ts`; Modify: `src/agents/index.ts`, `src/agents/agents.test.ts` (enable `rules`).

**Interfaces:**
- Consumes: `preflopStrength`, `madeHand`, `draws`, `CATEGORY_ORDER`.
- Produces: `class RulesAgent implements Agent { constructor(seed: number) }` (seed unused today; kept for interface symmetry).

Decision (from spec §3.2). Helper: `raiseTo(target)` clamps to `[minRaiseTo, maxRaiseTo]` and returns `allin` when equal to max, `bet` when `canCheck`, else `raise`. `raisedPreflop = view.history.some(h => h.street==='preflop' && (h.action.type==='raise' || h.action.type==='allin'))`. `lastRaiseTo` = the largest `amount` in preflop raise history, else `bigBlind`.

- preflop:
  - premium/strong: if `minRaiseTo === null` → call (or check); else if `!raisedPreflop` → `raiseTo(3*bb)`; else → `raiseTo(3*lastRaiseTo)`.
  - medium: `canCheck` → check; `!raisedPreflop` → call; else fold.
  - weak/trash: `canCheck` → check; else fold.
- postflop with `cat = madeHand`, `idx = CATEGORY_ORDER.indexOf(cat)`, `potAfterCall = pot + toCall`:
  - `idx >= two_pair`: `minRaiseTo === null` → call/check; `canCheck` → bet `round(2/3*pot)`; else raise to `toCall + round(2/3*potAfterCall)`.
  - `cat === 'pair'`: `canCheck` → check; `toCall <= pot/3` → call; else fold.
  - `draws(...).length > 0`: `canCheck` → check; `toCall <= pot/4` → call; else fold.
  - else: `canCheck` → check; else fold.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import type { LegalActions, PlayerView } from '../engine/types.js';
import { RulesAgent } from './rules.js';

const base = (o: Partial<PlayerView>): PlayerView => ({ seat: 0, street: 'preflop', holeCards: parseCards('Ah Ad'), board: [], stacks: [{ seat: 0, stack: 10000, isAllIn: false, folded: false }, { seat: 1, stack: 10000, isAllIn: false, folded: false }], pot: 150, toCall: 50, bigBlind: 100, position: 'BTN', history: [], ...o });
const open: LegalActions = { canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 10000 };
const agent = new RulesAgent(0);

describe('RulesAgent preflop', () => {
  it('opens premium to 3bb', async () => expect(await agent.decide(base({}), open)).toEqual({ type: 'raise', amount: 300 }));
  it('3-bets premium to 3x', async () => {
    const v = base({ history: [{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 300 } }], toCall: 250, pot: 450 });
    expect(await agent.decide(v, { ...open, callAmount: 250, minRaiseTo: 500 })).toEqual({ type: 'raise', amount: 900 });
  });
  it('medium calls an unraised pot and folds to a raise', async () => {
    expect(await agent.decide(base({ holeCards: parseCards('8h 8d') }), open)).toEqual({ type: 'call' });
    const v = base({ holeCards: parseCards('8h 8d'), history: [{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 300 } }] });
    expect(await agent.decide(v, open)).toEqual({ type: 'fold' });
  });
  it('trash checks when free, folds otherwise', async () => {
    expect(await agent.decide(base({ holeCards: parseCards('7h 2d') }), open)).toEqual({ type: 'fold' });
    expect(await agent.decide(base({ holeCards: parseCards('7h 2d'), toCall: 0 }), { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 200, maxRaiseTo: 10000 })).toEqual({ type: 'check' });
  });
});
describe('RulesAgent postflop', () => {
  const flop = (hole: string, board: string, toCall: number, pot = 300) => base({ street: 'flop', holeCards: parseCards(hole), board: parseCards(board), toCall, pot });
  const free: LegalActions = { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 100, maxRaiseTo: 10000 };
  it('bets two pair+ for 2/3 pot', async () => expect(await agent.decide(flop('Ah Kd', 'As Kc 2d', 0), free)).toEqual({ type: 'bet', amount: 200 }));
  it('calls with a pair when cheap, folds when expensive', async () => {
    expect(await agent.decide(flop('Ah 5d', 'As Kc 2d', 100), { ...open, callAmount: 100, minRaiseTo: 200 })).toEqual({ type: 'call' });
    expect(await agent.decide(flop('Ah 5d', 'As Kc 2d', 300), { ...open, callAmount: 300, minRaiseTo: 600 })).toEqual({ type: 'fold' });
  });
  it('calls a draw only when very cheap', async () => {
    expect(await agent.decide(flop('9h 8h', 'Th 7c 2h', 50), { ...open, callAmount: 50, minRaiseTo: 100 })).toEqual({ type: 'call' });
    expect(await agent.decide(flop('9h 8h', 'Th 7c 2h', 200), { ...open, callAmount: 200, minRaiseTo: 400 })).toEqual({ type: 'fold' });
  });
  it('goes all-in when the clamp hits the max', async () => {
    expect(await agent.decide(flop('Ah Kd', 'As Kc 2d', 0, 30000), { ...free, maxRaiseTo: 10000 })).toEqual({ type: 'allin' });
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement `rules.ts`, wire `createAgent('rules')`, enable `rules` in `agents.test.ts`.**

- [ ] **Step 4: Run all tests, pass. Commit** `feat(agents): add rule-based baseline agent`

---

### Task 10: Jev personas, state compression, questions

**Files:**
- Create: `src/jev/personas.ts`, `src/jev/compress.ts`, `src/jev/questions.ts`, `src/jev/compress.test.ts`, `src/jev/questions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Persona { id: string; name: { ja: string; en: string }; description: { ja: string; en: string }; variance: number; isPreset: boolean }
  const PRESET_PERSONAS: readonly Persona[];      // rock, tag, lag, maniac, station
  function getPersona(id: string): Persona;         // throws on unknown
  interface JevState { task: string; persona: { name: string; description: string }; importantContext: string[]; hand: {...}; table: {...}; history: {...}[] }   // shape per main spec §5.2
  function compressState(view: PlayerView, legal: LegalActions, persona: Persona): JevState;
  type ActionChoice = 'fold' | 'check_or_call' | 'bet_or_raise';
  const SIZING_LABELS = ['minimum','about one third of the pot','about two thirds of the pot','about the pot','an overbet','all in'] as const;
  function buildQuestions(legal: LegalActions): { action: ChoiceQuestion<...>; sizing: ScoreQuestion<typeof SIZING_LABELS>; bluff_intent: NoulQuestion };
  function legalChoices(legal: LegalActions): ActionChoice[];
  ```
- Persona descriptions (en) — write real text, e.g. `tag`: "A tight-aggressive regular. Plays a narrow range of strong starting hands, raises rather than calls, bets for value and folds when the odds are poor. Bluffs occasionally in good spots." Give each preset a `variance`: rock 0.1, tag 0.3, lag 0.5, maniac 0.8, station 0.2.

Compression rules: amounts in bb (`/ bigBlind`, 1 decimal). `potOddsPct = round(100 * toCall / (pot + toCall))` (0 when toCall = 0). `effectiveStackBB` = min(my stack, max other non-folded stack) in bb. `playersInHand` = non-folded, `playersToAct` = non-folded non-all-in excluding me. `madeHand` only when board ≥ 3, else omitted; `draws` only on flop/turn. `holeCards`/`board` as strings like `"As Kd"`. `importantContext` fixed list: `["Only legal actions are offered.", "Amounts are in big blinds.", "You cannot see other players' hole cards.", "Stay in character as the persona."]`.

- [ ] **Step 1: Write failing tests**

```ts
// compress.test.ts
import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import { compressState } from './compress.js';
import { getPersona } from './personas.js';
const view = { seat: 0, street: 'flop' as const, holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c'), stacks: [{ seat: 0, stack: 9000, isAllIn: false, folded: false }, { seat: 1, stack: 5000, isAllIn: false, folded: false }, { seat: 2, stack: 0, isAllIn: true, folded: false }], pot: 1200, toCall: 400, bigBlind: 100, position: 'BTN' as const, history: [{ street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 300 } }] };
const legal = { canFold: true, canCheck: false, callAmount: 400, minRaiseTo: 800, maxRaiseTo: 9000 };
describe('compressState', () => {
  it('matches snapshot shape', () => {
    const s = compressState(view, legal, getPersona('tag'));
    expect(s.persona.name).toBe('TAG');
    expect(s.hand).toMatchObject({ street: 'flop', holeCards: 'Ah Kh', board: 'Qh Jh 2c', madeHand: 'high_card', draws: ['flush_draw', 'gutshot'], preflopStrength: 'premium' });
    expect(s.table).toMatchObject({ position: 'BTN', playersInHand: 3, playersToAct: 1, potBB: 12, toCallBB: 4, potOddsPct: 25, effectiveStackBB: 50 });
    expect(s.history).toEqual([{ street: 'preflop', seat: 1, action: 'raise', amountBB: 3 }]);
    expect(s).toMatchSnapshot();
  });
  it('never includes other hole cards', () => expect(JSON.stringify(compressState(view, legal, getPersona('tag')))).not.toMatch(/stacks.*holeCards/));
});
// questions.test.ts
import { describe, expect, it } from 'vitest';
import { buildQuestions, legalChoices } from './questions.js';
describe('buildQuestions', () => {
  it('drops illegal choices', () => {
    expect(legalChoices({ canFold: false, canCheck: true, callAmount: null, minRaiseTo: null, maxRaiseTo: null })).toEqual(['check_or_call']);
    expect(Object.keys(buildQuestions({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 1000 }).action.criteria)).toEqual(['fold', 'check_or_call', 'bet_or_raise']);
  });
  it('sizing has 6 labels and bluff is a noul', () => {
    const q = buildQuestions({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 1000 });
    expect(q.sizing.criteria).toHaveLength(6); expect(q.bluff_intent.type).toBe('noul');
  });
});
```

Note on `draws` expectation: Ah Kh on Qh Jh 2c has a flush draw and a gutshot (needs T). Verify with the Task 4 implementation; adjust if `draws` returns them in a different order (sort output alphabetically in `draws` to make this stable).

- [ ] **Step 2: Run (fail). Step 3: Implement the three modules.** `questions.ts` uses `choice`, `score`, `noul` from `@typesafe-ai/sdk` with descriptive criteria text (fold: "Give up the hand.", check_or_call: "Check if free, otherwise match the current bet.", bet_or_raise: "Put in a bet or raise.").

- [ ] **Step 4: Run tests, commit snapshot file. Commit** `feat(jev): add personas, state compression and question set`

---

### Task 11: Jev backends and JevAgent

**Files:**
- Create: `src/jev/backend.ts`, `src/jev/agent.ts`, `src/jev/index.ts`, `src/jev/agent.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type JevQuestions = ReturnType<typeof buildQuestions>;
  type JevAnswers = SystemOneResult<JevQuestions>['answers'];
  interface JevBackend { kind: 'typesafe' | 'mock'; systemOne(state: JevState, questions: JevQuestions): Promise<{ answers: JevAnswers; model: string }> }
  function createTypeSafeBackend(opts: { apiKey?: string; model?: string; timeoutMs?: number }): JevBackend;   // apiKey falls back to env via SDK
  function createMockBackend(): JevBackend;     // deterministic from state.hand
  interface DecisionRecord { street: Street; choice: ActionChoice; action: Action; probabilities: Record<ActionChoice, number>; sizingScore: number | null; bluffIntent: number | null; latencyMs: number; apiCall: boolean; error?: string; model?: string }
  interface JevAgentOptions { persona: Persona; backend: JevBackend; seed: number; onDecision?: (r: DecisionRecord) => void }
  class JevAgent implements Agent { constructor(opts: JevAgentOptions); readonly id: `jev:${string}`; decide(view, legal): Promise<Action> }
  function answersToAction(answers: JevAnswers, legal: LegalActions, view: PlayerView, variance: number, rng: Rng): { action: Action; choice: ActionChoice; sizingScore: number | null }
  ```

`answersToAction`:
1. `p = answers.action.probabilities` restricted to `legalChoices(legal)`; temper: `q_i ∝ p_i^(1/variance)` for `variance > 0` (with `variance` clamped to `[0.05, 1]`), `variance ≤ 0.05` → argmax. Sample with `rng.next()`.
2. `check_or_call` → `canCheck ? check : call`. `fold` → fold (if `!canFold`, fall back to check).
3. `bet_or_raise`: `s = answers.sizing.score` (0..5). Map: fraction `f = [0, 1/3, 2/3, 1, 1.5, Infinity][round(s)]`; if `f === Infinity` → `allin`; else target = `canCheck ? f*pot : toCall + f*(pot + toCall)`, expressed as "raise to" = `committed + target` — since `PlayerView` does not expose committed-this-street, define target as raise-to = `minRaiseTo + f * (pot + toCall)` for `s>0` and `minRaiseTo` for `s=0`, clamp to `[minRaiseTo, maxRaiseTo]`, round; if `minRaiseTo === null` → `check_or_call` fallback; if clamped equals `maxRaiseTo` → `allin`.

`JevAgent.decide`: build state + questions, time the call, catch errors → fail-open `canCheck ? check : fold` with `error` set, always call `onDecision`.

Mock backend: derive strength `t` in [0,1]: preflop from `preflopStrength` (premium 1, strong .8, medium .55, weak .35, trash .15); postflop from `CATEGORY_ORDER.indexOf(madeHand)/8` plus 0.15 if any draw. Probabilities: `bet_or_raise = t^2`, `fold = (1-t)^2`, `check_or_call = 1 - both` then normalize over legal choices. `sizing.score = 1 + 3*t`, `bluff_intent.noul = 0.1`. Return `model: 'mock'`. Build `ChoiceResponse` etc. with `type`, `choice` (argmax), `confidence` (max prob), `probabilities`, `legend` (from criteria).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import { Rng } from '../engine/rng.js';
import { randomView, isLegal } from '../agents/testutil.js';
import { JevAgent, answersToAction } from './agent.js';
import { createMockBackend } from './backend.js';
import { getPersona } from './personas.js';
import type { JevAnswers } from './backend.js';

const legal = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 300, maxRaiseTo: 10000 };
const view = { seat: 0, street: 'flop' as const, holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c'), stacks: [], pot: 600, toCall: 100, bigBlind: 100, position: 'BTN' as const, history: [] };
const answers = (p: Record<string, number>, score = 3): JevAnswers => ({
  action: { type: 'choice', choice: 'fold', confidence: 1, probabilities: p } as never,
  sizing: { type: 'score', score, confidence: 1, legend: {} as never, probabilities: {} as never },
  bluff_intent: { type: 'noul', noul: 0.2 },
});

describe('answersToAction', () => {
  it('variance 0 takes argmax', () => {
    const r = answersToAction(answers({ fold: 0.2, check_or_call: 0.5, bet_or_raise: 0.3 }), legal, view, 0, new Rng(1));
    expect(r.action).toEqual({ type: 'call' });
  });
  it('variance 1 samples by probability', () => {
    const rng = new Rng(2); const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) { const r = answersToAction(answers({ fold: 0.5, check_or_call: 0.5, bet_or_raise: 0 }), legal, view, 1, rng); counts[r.choice] = (counts[r.choice] ?? 0) + 1; }
    expect(counts['fold']).toBeGreaterThan(400); expect(counts['check_or_call']).toBeGreaterThan(400); expect(counts['bet_or_raise']).toBeUndefined();
  });
  it('maps sizing to a clamped raise and all-in at the top', () => {
    expect(answersToAction(answers({ bet_or_raise: 1 }, 0), legal, view, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 300 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 3), legal, view, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 1000 });  // 300 + 1.0*(600+100)
    expect(answersToAction(answers({ bet_or_raise: 1 }, 5), legal, view, 0, new Rng(1)).action).toEqual({ type: 'allin' });
  });
  it('ignores illegal choices', () => {
    const r = answersToAction(answers({ fold: 0.9, check_or_call: 0.1, bet_or_raise: 0 }), { ...legal, canFold: false, canCheck: true, callAmount: null }, view, 0, new Rng(1));
    expect(r.action).toEqual({ type: 'check' });
  });
});

describe('JevAgent', () => {
  it('returns legal actions with the mock backend and records decisions', async () => {
    const records: unknown[] = [];
    const agent = new JevAgent({ persona: getPersona('tag'), backend: createMockBackend(), seed: 1, onDecision: (r) => records.push(r) });
    const rng = new Rng(4);
    for (let i = 0; i < 200; i++) { const { view, legal } = randomView(rng); expect(isLegal(await agent.decide(view, legal), legal)).toBe(true); }
    expect(records).toHaveLength(200);
  });
  it('fails open on backend error', async () => {
    const backend = { kind: 'mock' as const, systemOne: async () => { throw new Error('boom'); } };
    const records: { error?: string }[] = [];
    const agent = new JevAgent({ persona: getPersona('tag'), backend, seed: 1, onDecision: (r) => records.push(r) });
    expect(await agent.decide(view, legal)).toEqual({ type: 'fold' });
    expect(await agent.decide({ ...view, toCall: 0 }, { ...legal, canFold: false, canCheck: true, callAmount: null })).toEqual({ type: 'check' });
    expect(records[0]?.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement `backend.ts`, `agent.ts`, `index.ts`.** The typesafe backend wraps `new TypeSafeClient({ apiKey, defaultModel: model, timeout: timeoutMs })` and calls `client.systemOne({ state: state as unknown as JsonObject, questions })`.

- [ ] **Step 4: Run all tests + typecheck. Commit** `feat(jev): add JevAgent with TypeSafe and mock backends`

---

### Task 12: Benchmark stats

**Files:**
- Create: `bench/types.ts`, `bench/stats.ts`, `bench/stats.test.ts`

**Interfaces:**
- Produces (`bench/types.ts`):
  ```ts
  type Opponent = 'random' | 'caller' | 'rules'; type Format = 'hu' | '6max';
  interface HandRecord { seedIndex: number; rotation: number; jevSeat: SeatId; net: number[] /* bb per seat */; wentToShowdown: boolean; jevWonShowdown: boolean | null; jevVpip: boolean; jevPfr: boolean; oppVpip: number; oppPfr: number; decisions: DecisionRecord[] }
  interface JevSummary { bb100: number; ci95: [number, number]; n: number; hands: number; decisions: number; apiCalls: number; failOpen: number; latencyMs: { mean: number; p50: number; p95: number }; vpip: number; pfr: number; showdownWinRate: number | null }
  interface OpponentSummary { bb100PerSeat: number; vpip: number; pfr: number }
  interface BenchConfig { opponent: Opponent; format: Format; seeds: number; persona: string; backend: 'typesafe'|'mock'; model: string | null; baseSeed: number; concurrency: number; sdkVersion: string; gitCommit: string | null }
  interface BenchResult { version: 1; startedAt: string; finishedAt: string; partial: boolean; config: BenchConfig; summary: { jev: JevSummary; opponent: OpponentSummary }; hands: HandRecord[] }
  ```
- Produces (`stats.ts`): `function summarize(hands: HandRecord[], format: Format): { jev: JevSummary; opponent: OpponentSummary }`, `function percentile(sorted: number[], p: number): number`, `function meanCi(xs: number[]): { mean: number; lo: number; hi: number }`.

Grouping: group hands by `seedIndex`; `x_i = Σ net[jevSeat] / handsInGroup`. `bb100 = mean(x)*100`, `ci95 = [lo*100, hi*100]` with `sd/sqrt(n)*1.96`; `n = groups`. `showdownWinRate = wins / showdownHands` (null when 0). `opponent.bb100PerSeat = mean over hands of (Σ non-jev net / seatCount) * 100`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { meanCi, percentile, summarize } from './stats.js';
import type { HandRecord } from './types.js';

const rec = (seedIndex: number, rotation: number, jevNet: number, extra: Partial<HandRecord> = {}): HandRecord => ({ seedIndex, rotation, jevSeat: rotation, net: rotation === 0 ? [jevNet, -jevNet] : [-jevNet, jevNet], wentToShowdown: false, jevWonShowdown: null, jevVpip: true, jevPfr: false, oppVpip: 1, oppPfr: 0, decisions: [{ street: 'preflop', choice: 'check_or_call', action: { type: 'call' }, probabilities: { fold: 0, check_or_call: 1, bet_or_raise: 0 }, sizingScore: null, bluffIntent: null, latencyMs: 100, apiCall: true }], ...extra });

describe('stats', () => {
  it('percentile', () => { expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5); expect(percentile([1, 2, 3, 4], 0.95)).toBe(4); });
  it('meanCi', () => { const r = meanCi([1, 1, 1, 1]); expect(r).toEqual({ mean: 1, lo: 1, hi: 1 }); });
  it('summarize groups mirrored hands per seed', () => {
    const hands = [rec(0, 0, 2), rec(0, 1, -1), rec(1, 0, 4), rec(1, 1, 3)];   // x = [0.5, 3.5]
    const s = summarize(hands, 'hu');
    expect(s.jev.n).toBe(2); expect(s.jev.hands).toBe(4);
    expect(s.jev.bb100).toBeCloseTo(200);
    expect(s.jev.decisions).toBe(4); expect(s.jev.apiCalls).toBe(4); expect(s.jev.failOpen).toBe(0);
    expect(s.jev.latencyMs.mean).toBe(100); expect(s.jev.vpip).toBe(1); expect(s.jev.pfr).toBe(0);
    expect(s.jev.showdownWinRate).toBeNull();
    expect(s.opponent.bb100PerSeat).toBeCloseTo(-200);
  });
  it('counts fail-open and showdown wins', () => {
    const h = rec(0, 0, 1, { wentToShowdown: true, jevWonShowdown: true, decisions: [{ street: 'flop', choice: 'fold', action: { type: 'fold' }, probabilities: { fold: 1, check_or_call: 0, bet_or_raise: 0 }, sizingScore: null, bluffIntent: null, latencyMs: 5, apiCall: false, error: 'x' }] });
    const s = summarize([h], 'hu');
    expect(s.jev.failOpen).toBe(1); expect(s.jev.apiCalls).toBe(0); expect(s.jev.showdownWinRate).toBe(1);
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement. Step 4: Pass, commit** `feat(bench): add result types and statistics`

---

### Task 13: Matchups and runner

**Files:**
- Create: `bench/matchups.ts`, `bench/runner.ts`, `bench/runner.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // matchups.ts
  function seatCount(format: Format): number;                 // 2 or 6
  function rotations(format: Format): number;                 // 2 or 6
  function expandMatchups(opponent: Opponent|'all', format: Format|'all'): { opponent: Opponent; format: Format }[];
  // runner.ts
  interface RunOptions { opponent: Opponent; format: Format; seeds: number; baseSeed: number; concurrency: number; persona: Persona; backend: JevBackend; signal?: AbortSignal; onHand?: (done: number, total: number) => void }
  function playHand(args: { seedIndex: number; rotation: number; opponent: Opponent; format: Format; baseSeed: number; persona: Persona; backend: JevBackend }): Promise<HandRecord>;
  function runMatch(opts: RunOptions): Promise<{ hands: HandRecord[]; partial: boolean }>;
  ```

`playHand`: `n = seatCount(format)`; `jevSeat = rotation`; agents per seat: `jevSeat` → `new JevAgent({ persona, backend, seed: hashSeed(baseSeed, seedIndex, rotation, 99), onDecision })`; others → `createAgent(opponent, hashSeed(baseSeed, seedIndex, seat))`. Table config: cash, `fixedBlinds({small:50,big:100,ante:0})`, `startingStack: 10000`, `seed: hashSeed(baseSeed, seedIndex)` (so `Table` uses `hashSeed(seed, 0)` for hand 0 → same deck for all rotations). Loop: `hand = table.startHand(); while (!hand.isOver) { const s = hand.toAct!; const a = await agents[s].decide(table.view(s), hand.legalActions(s)); hand.act(s, a); }`. Compute `net = finalStacks.map(s => (s.stack - 10000)/100)`. VPIP: seat put money in preflop voluntarily (call/bet/raise/allin on preflop from history via a `Table` listener on `ActionTaken`); PFR: preflop raise/bet/allin. `jevWonShowdown`: from `PotAwarded` events with `wentToShowdown` (won if jev received any pot).

`runMatch`: jobs = all `(seedIndex, rotation)` pairs in seed-major order. Simple semaphore: keep `concurrency` promises in flight; stop scheduling when `signal.aborted`; wait for in-flight; return `partial = signal.aborted`. Hand order in output sorted by `(seedIndex, rotation)`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createMockBackend } from '../src/jev/backend.js';
import { getPersona } from '../src/jev/personas.js';
import { expandMatchups } from './matchups.js';
import { playHand, runMatch } from './runner.js';

const persona = getPersona('tag');
describe('expandMatchups', () => {
  it('all × all = 6', () => expect(expandMatchups('all', 'all')).toHaveLength(6));
  it('single', () => expect(expandMatchups('rules', 'hu')).toEqual([{ opponent: 'rules', format: 'hu' }]));
});
describe('playHand', () => {
  it('is zero-sum and same deck across rotations', async () => {
    const a = await playHand({ seedIndex: 3, rotation: 0, opponent: 'caller', format: 'hu', baseSeed: 1, persona, backend: createMockBackend() });
    const b = await playHand({ seedIndex: 3, rotation: 1, opponent: 'caller', format: 'hu', baseSeed: 1, persona, backend: createMockBackend() });
    expect(a.net.reduce((x, y) => x + y, 0)).toBeCloseTo(0);
    expect(a.jevSeat).toBe(0); expect(b.jevSeat).toBe(1);
    expect(a.decisions.length).toBeGreaterThan(0);
  });
  it('6-max has 6 seats', async () => {
    const r = await playHand({ seedIndex: 0, rotation: 5, opponent: 'random', format: '6max', baseSeed: 1, persona, backend: createMockBackend() });
    expect(r.net).toHaveLength(6); expect(r.jevSeat).toBe(5);
  });
});
describe('runMatch', () => {
  const base = { opponent: 'rules' as const, seeds: 5, baseSeed: 2, concurrency: 3, persona, backend: createMockBackend() };
  it('runs seeds × rotations', async () => {
    const hu = await runMatch({ ...base, format: 'hu' }); expect(hu.hands).toHaveLength(10); expect(hu.partial).toBe(false);
    const six = await runMatch({ ...base, format: '6max' }); expect(six.hands).toHaveLength(30);
    expect(hu.hands.map((h) => [h.seedIndex, h.rotation])).toEqual([[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0],[4,1]]);
  });
  it('stops early when aborted', async () => {
    const ctrl = new AbortController();
    const r = await runMatch({ ...base, format: 'hu', seeds: 50, signal: ctrl.signal, onHand: (done) => { if (done >= 4) ctrl.abort(); } });
    expect(r.partial).toBe(true); expect(r.hands.length).toBeLessThan(100); expect(r.hands.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement. Step 4: Pass, typecheck, commit** `feat(bench): add hand runner with seat rotation and concurrency`

---

### Task 14: Report, CLI, README

**Files:**
- Create: `bench/report.ts`, `bench/report.test.ts`, `bench/cli.ts`, `bench/report-cli.ts`, `bench/results/.gitkeep`, `bench/README.md`; Modify: `.gitignore` (nothing to ignore in results; keep committed).

**Interfaces:**
- Produces:
  ```ts
  function resultsToMarkdown(results: BenchResult[]): string;           // table per spec §6.3, sorted by opponent then format
  function pickLatest(results: BenchResult[]): BenchResult[];           // latest per (opponent, format, persona) by finishedAt
  function resultFileName(r: BenchResult, label: string): string;       // `${startedAt ISO with ':' → '-'}-${label}.json`
  function parseArgs(argv: string[]): CliOptions;                        // defaults per spec §6.1; throws on unknown flag / bad value
  ```

Table columns: `| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |`. Format `bb/100` with sign and 1 decimal, CI as `[+30.1, +60.3]`, percentages as integers, latency as `1.3s`. Append ` (N が小さい)` after N when `n < 30`. Add a line `_partial_` marker column value `⚠` in 相手 cell when `partial`.

`cli.ts` flow: parse args → if backend typesafe and no `TYPESAFE_API_KEY` → print error and exit 1 → for each matchup: create backend, `AbortController` wired to SIGINT (first Ctrl-C aborts and finishes writing; second exits), progress line every 10 hands to stderr, `runMatch`, `summarize`, build `BenchResult` (`sdkVersion` from `VERSION` export of the SDK, `gitCommit` via `git rev-parse --short HEAD` with try/catch → null), write JSON to `bench/results/`, print the markdown table for the results of this run at the end. `report-cli.ts`: read given files or all `bench/results/*.json`, `pickLatest`, print table.

- [ ] **Step 1: Write failing tests for report**

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs, pickLatest, resultsToMarkdown } from './report.js';
import type { BenchResult } from './types.js';
const mk = (o: Partial<BenchResult> & { opponent?: string; format?: string; finishedAt?: string }): BenchResult => ({
  version: 1, startedAt: '2026-09-19T00:00:00.000Z', finishedAt: o.finishedAt ?? '2026-09-19T01:00:00.000Z', partial: false,
  config: { opponent: (o.opponent ?? 'random') as never, format: (o.format ?? 'hu') as never, seeds: 100, persona: 'tag', backend: 'mock', model: null, baseSeed: 1, concurrency: 4, sdkVersion: '0.6.0', gitCommit: null },
  summary: { jev: { bb100: 45.23, ci95: [30.1, 60.3], n: 100, hands: 200, decisions: 500, apiCalls: 500, failOpen: 0, latencyMs: { mean: 1300, p50: 1200, p95: 2000 }, vpip: 0.42, pfr: 0.28, showdownWinRate: 0.5 }, opponent: { bb100PerSeat: -45.23, vpip: 1, pfr: 0 } },
  hands: [], ...o,
});
describe('report', () => {
  it('renders a markdown table', () => {
    const md = resultsToMarkdown([mk({})]);
    expect(md).toContain('| random | HU | tag | 100 | 200 | +45.2 | [+30.1, +60.3] | 42% | 28% | 0 | 1.3s |');
    expect(md).toMatchSnapshot();
  });
  it('flags small N', () => expect(resultsToMarkdown([mk({ summary: { ...mk({}).summary, jev: { ...mk({}).summary.jev, n: 10 } } })])).toContain('10 (N が小さい)'));
  it('picks the latest per matchup', () => {
    const old = mk({ finishedAt: '2026-09-18T00:00:00.000Z' }), nu = mk({ finishedAt: '2026-09-19T00:00:00.000Z' }), other = mk({ opponent: 'rules' });
    expect(pickLatest([old, nu, other])).toEqual([nu, other]);
  });
});
describe('parseArgs', () => {
  it('defaults', () => expect(parseArgs([])).toEqual({ opponent: 'all', format: 'all', seeds: 100, persona: 'tag', backend: 'typesafe', concurrency: 4, baseSeed: 1, label: null, model: null }));
  it('parses values', () => expect(parseArgs(['--opponent', 'rules', '--format', 'hu', '--seeds', '5', '--backend', 'mock'])).toMatchObject({ opponent: 'rules', format: 'hu', seeds: 5, backend: 'mock' }));
  it('rejects unknown flags', () => expect(() => parseArgs(['--nope'])).toThrow());
});
```

- [ ] **Step 2: Run (fail). Step 3: Implement `report.ts` (also hosts `parseArgs` so the CLI files stay thin), `cli.ts`, `report-cli.ts`.**

- [ ] **Step 4: Smoke run with mock** — `pnpm bench --backend mock --seeds 3 --opponent rules --format hu --label smoke` → expect a JSON file in `bench/results/` and a table on stdout. Then `pnpm bench:report` prints the table. Delete the smoke JSON afterwards (`bench/results/*smoke*.json`).

- [ ] **Step 5: Write `bench/README.md`** (日本語 + English): 実行方法、オプション表、コスト見積式 (spec §9)、表の読み方、`bench:report`、結果 JSON の場所と `partial` の意味、CI では mock のみ。

- [ ] **Step 6: Run all tests + typecheck. Commit** `feat(bench): add CLI, markdown report and README`

---

### Task 15: Root README and main spec addendum

**Files:**
- Create: `README.md`; Modify: `docs/superpowers/specs/2026-09-19-jev-poker-design.md` (append §3.3 of benchmark spec as a note under §5 and §7).

- [ ] **Step 1: Write `README.md`** — project one-liner (EN + JA), status (engine + agents + bench implemented; UI and Pages Functions pending), how to run tests, and a `## Benchmark / ベンチマーク` section with the command and a placeholder sentence: "最新の結果表はベンチマーク実行後にここへ手動で貼る (`pnpm bench:report` の出力)。" followed by an empty table header from spec §6.3 so the format is visible. Since no real run has happened, do not invent numbers.

- [ ] **Step 2: Append to the main spec** under §5: "`JevAgent` は `src/agents/types.ts` の `Agent` インターフェースを実装する (ベンチマーク spec §3)。" and under §7: "席の CPU 種別に `jev` のほか `random` / `caller` / `rules` を選べる (キー無しで動く CPU)。"

- [ ] **Step 3: Run `pnpm test && pnpm typecheck`. Commit** `docs: add README and link Agent interface from main spec`

---

## Self-Review

- **Spec coverage:** §3 (Agent + baselines) → Tasks 8–9; §3.3 → Task 15; §4 (independent hands, rotation, seeds, concurrency, abort) → Task 13; §5 (stats) → Task 12; §6.1 CLI → Task 14; §6.2 JSON → Tasks 12/14; §6.3 table → Task 14; §6.4 READMEs → Tasks 14–15; §7 backends → Task 11; §8 tests → each task; §9 cost estimate → bench/README (Task 14). Engine spec §4 → Tasks 2–7; §5 Jev → Tasks 10–11; §6 personas → Task 10.
- **Placeholders:** none. Persona description text must be written in Task 10 (an example is given for `tag`).
- **Type consistency:** `PlayerView` is defined once in `src/engine/types.ts` and consumed by agents, jev and bench. `DecisionRecord` lives in `src/jev/agent.ts` and is imported by `bench/types.ts`. `LegalActions.callAmount` is `null` when `toCall === 0`, and `minRaiseTo` is `null` when no raise is possible — every consumer (`isLegal`, `legalChoices`, `RulesAgent`, `RandomAgent`, `answersToAction`) follows that convention.
