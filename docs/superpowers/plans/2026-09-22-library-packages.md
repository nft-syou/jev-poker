# Library Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the poker engine and the Jev CPU as two npm packages, `@jev-poker/engine` and `@jev-poker/agent`, while the app and the benchmark in this repository keep working from the same sources through a pnpm workspace.

**Architecture:** `src/engine` moves to `packages/engine/src`, and `src/agents` plus the decision half of `src/jev` move to `packages/agent/src`. In the workspace each package's `exports` points at `src/index.ts`, so Vite, Vitest, tsx and `tsc` resolve the sources with no build step; `publishConfig` swaps `exports` to `dist` when publishing, and `dist` is emitted by `tsc -p tsconfig.build.json` per package. Relative imports inside the packages carry a `.js` extension so the emitted ESM runs in Node unchanged. Releases go through Changesets and a GitHub Actions workflow with npm provenance.

**Tech Stack:** pnpm 12 workspaces, TypeScript 7 (`tsc` emit, no bundler), Vitest 5 `projects`, publint + `@arethetypeswrong/cli`, Changesets, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-library-packages-design.md`

## Global Constraints

- Package names: `@jev-poker/engine`, `@jev-poker/agent`. Both `"type": "module"`, `"sideEffects": false`, `"license": "MIT"`, `"engines": { "node": ">=20" }`, `"publishConfig": { "access": "public" }`.
- `@jev-poker/engine` has zero runtime dependencies. `@jev-poker/agent` depends on `@jev-poker/engine` (`workspace:^`) and `@typesafe-ai/sdk` (`^0.6.0`).
- Library code never touches globals (`localStorage`, `window`, `document`). Node/browser-neutral only.
- Inside `packages/*/src`, every relative import ends in `.js` (`from "./cards.js"`, `from "../features.js"`). Cross-package imports use the package name (`from "@jev-poker/engine"`), never a relative path.
- No behaviour change to the game, the proxy (`src/proxy`, `src/jev/connection.ts`, `functions/`) or the deploy. Existing tests move; none is deleted or weakened.
- `pnpm check` (lint → typecheck → test → build) must be green at the end of every task and stays the one command CI runs.
- Commit messages follow Conventional Commits and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Deviation from spec §4/§6 (recorded here on purpose): no TypeScript project references. Type-checking stays `tsc -p tsconfig.json` over app + bench + both packages (tests included); each package additionally has a `tsconfig.build.json` used only for emit. Reason: a referencing project may not include files that belong to a referenced project, which would leave the packages' test files unchecked.

---

### Task 1: Workspace skeleton and `@jev-poker/engine`

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `biome.json`
- Create: `tsconfig.base.json`, `packages/engine/package.json`, `packages/engine/tsconfig.build.json`
- Move: `src/engine/**` → `packages/engine/src/**` (git mv)
- Modify: every file importing `../engine/...` or `../src/engine` (listed in Step 5)

**Interfaces:**
- Produces: package `@jev-poker/engine` resolvable in the workspace, exporting exactly what `src/engine/index.ts` exports today (`Table`, `Hand`, `playerView`, `fixedBlinds`, `createRng`, `hashSeed`, `randomSeed`, `evaluateBest`, `parseCards`, `formatCard`, types `PlayerView`, `LegalActions`, `Action`, `HandSnapshot`, `GameEvent`, `GameConfig`, `SeatId`, `Street`, `ActionTakenEvent`, …).

- [ ] **Step 1: Declare the workspace and the shared compiler options**

`pnpm-workspace.yaml` (keep the existing `allowBuilds` / `onlyBuiltDependencies` lines, add the first key):

```yaml
packages:
  - "packages/*"
allowBuilds:
  esbuild: true
  workerd: true
onlyBuiltDependencies:
  - esbuild
  - workerd
```

Create `tsconfig.base.json` with the options every project shares (moved out of `tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

Rewrite `tsconfig.json` (the type-check project for everything, unchanged semantics plus the packages):

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "node"],
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "bench", "packages/*/src", "scripts", "vite.config.ts"]
}
```

Add to `.gitignore`: a line `.packs/` (used by Task 7). Add `"!.packs"` to the `files.includes` list in `biome.json`.

- [ ] **Step 2: Create the engine package manifest and build config**

`packages/engine/package.json`:

```json
{
  "name": "@jev-poker/engine",
  "version": "0.1.0",
  "description": "No-Limit Texas Hold'em engine: dealing, betting rules, side pots, hand evaluation, equity. Zero dependencies.",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "repository": { "type": "git", "url": "git+https://github.com/nft-syou/jev-poker.git", "directory": "packages/engine" },
  "homepage": "https://github.com/nft-syou/jev-poker/tree/main/packages/engine#readme",
  "bugs": { "url": "https://github.com/nft-syou/jev-poker/issues" },
  "keywords": ["poker", "texas-holdem", "engine", "typescript"],
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "access": "public",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\""
  },
  "devDependencies": {
    "typescript": "~7.0.2"
  }
}
```

`packages/engine/tsconfig.build.json` (emit only; tests excluded; buildinfo inside `dist` so `clean` resets it):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": [],
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/__snapshots__"]
}
```

Copy the root `LICENSE` into `packages/engine/LICENSE` (`cp LICENSE packages/engine/LICENSE`). The README is written in Task 9; create a one-line placeholder `packages/engine/README.md` containing `# @jev-poker/engine` so `files` is complete.

- [ ] **Step 3: Move the engine with its history**

```bash
mkdir -p packages/engine
git mv src/engine packages/engine/src
```

- [ ] **Step 4: Give every relative import inside the package a `.js` extension**

Save this as `scripts/add-js-extensions.mjs` (kept in the repo; Task 2 reuses it):

```js
// Rewrites `from "./x"` / `from "../x"` to `from "./x.js"` inside the given directories.
// Only extensionless relative specifiers change; package imports and `.json` are left alone.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
if (dirs.length === 0) throw new Error("usage: node scripts/add-js-extensions.mjs <dir>...");

const SPECIFIER = /(from\s+|import\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

let changed = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(SPECIFIER, (all, lead, quote, spec) =>
      /\.(js|ts|json)$/.test(spec) ? all : `${lead}${quote}${spec}.js${quote}`,
    );
    if (after !== before) {
      writeFileSync(file, after);
      changed++;
    }
  }
}
console.log(`rewrote ${changed} file(s)`);
```

Run: `node scripts/add-js-extensions.mjs packages/engine/src`
Expected: `rewrote <n> file(s)` where n is every engine file with a relative import. Spot-check: `grep -n "from \"./" packages/engine/src/index.ts` shows only `.js` specifiers.

- [ ] **Step 5: Point the app and the benchmark at the package**

Every import of the old location becomes `@jev-poker/engine`. The old paths in use (from a grep of the repo) are `../engine/types`, `../engine/cards`, `../engine/table`, `../engine/hand`, `../engine/blinds`, `../engine/rng`, `../engine/evaluator`, `../engine/strength`, `../engine/equity`, `../engine/ranges`, `../engine/view`, `../engine/index`, `../engine/types.ts` and, from `bench/`, `../src/engine` and `../../src/engine`. All of those names are re-exported by the engine's `index.ts`, so one replacement covers them:

```bash
grep -rlE "from \"(\.\./)+(src/)?engine(/[a-z-]+)?(\.ts)?\"" src bench functions vite.config.ts \
  | xargs sed -i -E 's#from "(\.\./)+(src/)?engine(/[a-z-]+)?(\.ts)?"#from "@jev-poker/engine"#g'
```

Then merge duplicate import statements from `@jev-poker/engine` in the same file by hand where a file now has two (`tsc` reports nothing for duplicates, but Biome's `noDuplicateImports`-style organizer will flag them; `pnpm biome check --write .` merges what it can — check `git diff --stat` afterwards and fix the rest manually).

`src/jev/features.ts` re-exports `ActionTakenEvent` from the engine; keep that re-export working (`export type { ActionTakenEvent } from "@jev-poker/engine";` is what the sed produces if the line was `export type { ... } from "../engine/view"`).

- [ ] **Step 6: Wire the workspace, split Vitest into projects, add the build script**

Root `package.json` changes:
- `"scripts"`: add `"build:packages": "pnpm -r --filter \"./packages/*\" run build"`; change `"check"` to `"pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm build:packages"`.
- `"devDependencies"`: nothing new yet.

`vite.config.ts`: replace the `test` block with projects (the app project inherits the root plugins through `extends: true`; the others need no plugin):

```ts
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: "engine", include: ["packages/engine/src/**/*.test.ts"] } },
      { test: { name: "agent", include: ["packages/agent/src/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "app",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "functions/**/*.test.ts"],
        },
      },
      { test: { name: "bench", include: ["bench/**/*.test.ts"] } },
    ],
  },
```

Run: `pnpm install` (links `node_modules/@jev-poker/engine` → `packages/engine`; the lockfile gains an `importers` entry for the package; commit the lockfile).

- [ ] **Step 7: Run the full check and fix what it reports**

Run: `pnpm check`
Expected: lint clean; typecheck clean; all tests pass (the engine suite now runs under the `engine` project — same count as before the move); `vite build` succeeds; `pnpm build:packages` emits `packages/engine/dist/index.js` and `index.d.ts`.

Then prove the emitted package runs in plain Node:

```bash
node -e "import('./packages/engine/dist/index.js').then(m => { const t = new m.Table({ format: 'cash', blinds: m.fixedBlinds(1, 2), startingStack: 200, seats: [{ id: 0, name: 'a', kind: 'cpu' }, { id: 1, name: 'b', kind: 'cpu' }], seed: 1 }); console.log(t.startHand().street); })"
```
Expected: prints `preflop`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(engine): move the engine into packages/engine as @jev-poker/engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `@jev-poker/agent` package (move only)

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.build.json`, `packages/agent/LICENSE`, `packages/agent/README.md` (placeholder), `packages/agent/src/index.ts`
- Move: `src/agents/**` → `packages/agent/src/agents/**`; `src/jev/{features,questions,decide,personas,backend,mock-backend}.ts` and their `*.test.ts` and `src/jev/__snapshots__/` → `packages/agent/src/`
- Modify: root `package.json` (move `@typesafe-ai/sdk`), `src/ui/*`, `src/jev/prefetch.ts`, `src/jev/connection.ts` is untouched, `bench/**`
- Delete: `src/jev/index.ts` (only if nothing imports `../jev` — see Step 4)

**Interfaces:**
- Consumes: `@jev-poker/engine` (Task 1).
- Produces: package `@jev-poker/agent` whose `index.ts` re-exports (for now with `export *`) `./agents/index.js`, `./features.js`, `./questions.js`, `./decide.js`, `./personas.js`, `./backend.js`, `./mock-backend.js`. Names later tasks rely on: `JevAgent`, `Agent`, `createAgent`, `RulesAgent`, `HeuristicAgent`, `AgentDecision`, `JevBackend`, `createTypeSafeBackend` (app-flavoured until Task 3), `createMockBackend`, `PRESET_PERSONAS`, `Persona`, `personaPrompt`, `loadPersonas`, `saveCustomPersonas`, `KeyValueStorage`, `featuresFromView`, `buildFeatures`, `DecisionFeatures`, `FeatureOptions`, `OpponentStats`, `decideAction`, `fallbackAction`, `sizingToAmount`, `DecisionRecord`, `DecideInput`, `SizingSnapshot`, `buildQuestions`, `legalLabels`, `ACTION_LABELS`, `ActionLabel`, `PromptStyle`.

- [ ] **Step 1: Package manifest and build config**

`packages/agent/package.json`:

```json
{
  "name": "@jev-poker/agent",
  "version": "0.1.0",
  "description": "Poker CPU players that think with TypeSafe Jev, plus baseline bots and a play loop, on top of @jev-poker/engine.",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "repository": { "type": "git", "url": "git+https://github.com/nft-syou/jev-poker.git", "directory": "packages/agent" },
  "homepage": "https://github.com/nft-syou/jev-poker/tree/main/packages/agent#readme",
  "bugs": { "url": "https://github.com/nft-syou/jev-poker/issues" },
  "keywords": ["poker", "texas-holdem", "ai", "typesafe", "jev", "bot"],
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "access": "public",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\""
  },
  "dependencies": {
    "@jev-poker/engine": "workspace:^",
    "@typesafe-ai/sdk": "^0.6.0"
  },
  "devDependencies": {
    "@types/node": "^26.6.1",
    "typescript": "~7.0.2"
  }
}
```

`packages/agent/tsconfig.build.json` — same as the engine's but with Node's ambient types, because `JevAgent` reads `performance.now()`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"],
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/__snapshots__", "src/agents/testutil.ts"]
}
```

`cp LICENSE packages/agent/LICENSE`; placeholder `packages/agent/README.md` with `# @jev-poker/agent`.

Root `package.json`: remove `"@typesafe-ai/sdk"` from `dependencies` (only library files import it; `bench/backend.ts` is rewritten in Task 3 — until then it stays importable because pnpm hoists nothing to the root; so in this task also add `"@jev-poker/agent": "workspace:^"` and `"@jev-poker/engine": "workspace:^"` to the root `dependencies`, and keep `@typesafe-ai/sdk` in the root `devDependencies` for `bench/backend.ts` until Task 3 deletes that import).

- [ ] **Step 2: Move the files**

```bash
mkdir -p packages/agent/src
git mv src/agents packages/agent/src/agents
for f in features questions decide personas backend mock-backend; do
  git mv src/jev/$f.ts packages/agent/src/$f.ts
  [ -f src/jev/$f.test.ts ] && git mv src/jev/$f.test.ts packages/agent/src/$f.test.ts
done
git mv src/jev/__snapshots__ packages/agent/src/__snapshots__
```

(`backend.test.ts` moves too; Task 3 splits it. `connection.ts`, `connection.test.ts`, `prefetch.ts`, `prefetch.test.ts` stay in `src/jev`.)

- [ ] **Step 3: Fix the imports inside the package**

Inside `packages/agent/src/agents/*.ts`, `../jev/<x>` becomes `../<x>`; inside all package files, `../engine/...` becomes the package name; then extensions:

```bash
sed -i -E 's#from "\.\./jev/([a-z-]+)"#from "../\1"#g' packages/agent/src/agents/*.ts
grep -rlE "from \"(\.\./)+engine(/[a-z-]+)?\"" packages/agent/src \
  | xargs sed -i -E 's#from "(\.\./)+engine(/[a-z-]+)?"#from "@jev-poker/engine"#g'
node scripts/add-js-extensions.mjs packages/agent/src
```

`features.ts` re-exports `ActionTakenEvent`: after the sed it reads `export type { ActionTakenEvent } from "@jev-poker/engine";` — keep it.

Create `packages/agent/src/index.ts`:

```ts
export * from "./agents/index.js";
export * from "./backend.js";
export * from "./decide.js";
export * from "./features.js";
export * from "./mock-backend.js";
export * from "./personas.js";
export * from "./questions.js";
```

- [ ] **Step 4: Point the app and the benchmark at the package**

Old paths in use: `../jev/personas`, `../jev/features`, `../jev/questions`, `../jev/decide`, `../jev/backend`, `../jev/mock-backend` from `src/ui`; `./decide`, `./features`, `./questions`, `./backend` from `src/jev/prefetch.ts`; `../src/agents`, `../../src/agents`, `../src/jev/*`, `../../src/jev/mock-backend` from `bench`.

```bash
grep -rlE "from \"\.\./jev/(personas|features|questions|decide|backend|mock-backend)\"" src \
  | xargs sed -i -E 's#from "\.\./jev/(personas|features|questions|decide|backend|mock-backend)"#from "@jev-poker/agent"#g'
sed -i -E 's#from "\./(decide|features|questions|backend)"#from "@jev-poker/agent"#g' src/jev/prefetch.ts src/jev/prefetch.test.ts
grep -rlE "from \"(\.\./)+src/(agents|jev/[a-z-]+)\"" bench \
  | xargs sed -i -E 's#from "(\.\./)+src/(agents|jev/[a-z-]+)"#from "@jev-poker/agent"#g'
```

`src/jev/prefetch.ts` imports `ActionTakenEvent` and `DecisionFeatures` from `./features`; after the sed both come from `@jev-poker/agent`, which re-exports `ActionTakenEvent` — fine. Merge duplicate `@jev-poker/agent` import statements per file as in Task 1.

`src/jev/index.ts`: run `grep -rn "from \"\.\./jev\"" src` — if it prints nothing (expected), `git rm src/jev/index.ts`. If it prints something, replace the file's contents with `export * from "@jev-poker/agent"; export * from "./connection"; export * from "./prefetch";`.

- [ ] **Step 5: Install, check, commit**

Run: `pnpm install` then `pnpm check`
Expected: green; the `agent` project reports the moved suites (agents + features/questions/decide/personas/backend); the feature snapshot file is found at its new path (no "obsolete snapshot" / "new snapshot written" lines). `pnpm build:packages` emits `packages/agent/dist`.

Prove the built package loads in Node without the app:

```bash
node -e "import('./packages/agent/dist/index.js').then(m => console.log(Object.keys(m).includes('JevAgent'), m.PRESET_PERSONAS.map(p => p.id).join(',')))"
```
Expected: `true rock,tag,lag,maniac,station` (ids as in `PRESET_PERSONAS`).

```bash
git add -A
git commit -m "refactor(agent): move the CPU, baselines and decision code into @jev-poker/agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: A library backend without the app's proxy routes

**Files:**
- Modify: `packages/agent/src/backend.ts`
- Create: `packages/agent/src/backend.test.ts` (replaces the moved one, whose four cases move to the app)
- Create: `src/jev/backend.ts` (app wrapper) and `src/jev/backend.test.ts` (the four moved cases)
- Modify: `src/ui/GameScreen.tsx`, `bench/backend.ts`, `bench/backend.test.ts`, `bench/cli.ts`, `bench/slumbot/cli.ts`

**Interfaces:**
- Produces (library):
  ```ts
  export interface TypeSafeBackendOptions {
    apiKey: string;
    baseURL?: string;        // default: the SDK's (https://api.typesafe.ai)
    model?: string;          // default: DEFAULT_MODEL ("jev-latest")
    headers?: Record<string, string>;
    timeoutMs?: number;      // default 10_000
    fetch?: typeof fetch;
    browser?: boolean;       // → SDK dangerouslyAllowBrowser
  }
  export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend;
  ```
- Produces (app): `createProxyBackend({ connection, baseURL, model?, timeoutMs?, fetch? }): JevBackend` in `src/jev/backend.ts`.

- [ ] **Step 1: Write the failing library test**

`packages/agent/src/backend.test.ts`:

```ts
import { choice } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { createTypeSafeBackend, DEFAULT_MODEL, type TypeSafeBackendOptions } from "./backend.js";

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(calls: Call[]): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: {
          action: { type: "choice", choice: "fold", confidence: 0.9, probabilities: { fold: 0.9, check_or_call: 0.1 } },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function ask(options: Omit<TypeSafeBackendOptions, "fetch">): Promise<Call> {
  const calls: Call[] = [];
  const backend = createTypeSafeBackend({ ...options, fetch: recordingFetch(calls) });
  expect(backend.kind).toBe("typesafe");
  const result = await backend.systemOne({
    state: { hello: "world" },
    questions: { action: choice("?", { fold: null, check_or_call: null }) },
  });
  expect(result.answers.action.choice).toBe("fold");
  const call = calls[0];
  if (call === undefined || calls.length !== 1) throw new Error("expected exactly one request");
  return call;
}

describe("createTypeSafeBackend", () => {
  it("talks to api.typesafe.ai with the key as a bearer token and the default model", async () => {
    const call = await ask({ apiKey: "sk-test" });
    expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.state).toEqual({ hello: "world" });
  });

  it("takes a base URL, a model and extra headers for a gateway", async () => {
    const call = await ask({
      apiKey: "lp-1",
      baseURL: "https://ai-gateway.lolipop.jp",
      model: "typesafe/jev-latest",
      headers: { "x-trace": "abc" },
    });
    expect(call.url).toBe("https://ai-gateway.lolipop.jp/v1/systemone");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer lp-1");
    expect(headers.get("x-trace")).toBe("abc");
    expect(JSON.parse(String(call.init?.body)).model).toBe("typesafe/jev-latest");
  });

  it("does not need the SDK to read an environment variable", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const call = await ask({ apiKey: "explicit" });
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer explicit");
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --project agent packages/agent/src/backend.test.ts`
Expected: FAIL — the current `createTypeSafeBackend` requires `connection` and rejects these options (type error at runtime shows as `TypeError: Cannot read properties of undefined (reading 'apiKey')` or similar).

- [ ] **Step 3: Rewrite the library backend**

Replace the whole of `packages/agent/src/backend.ts` with:

```ts
import {
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

/** Anything that can answer Jev's typed questions: the real service, or a stand-in in tests. */
export interface JevBackend {
  readonly kind: "typesafe" | "mock";
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

export const DEFAULT_MODEL = "jev-latest";

export interface TypeSafeBackendOptions {
  apiKey: string;
  /** Where `/v1/systemone` lives. Omit for api.typesafe.ai; set it to call a gateway or a proxy. */
  baseURL?: string;
  /** Defaults to `DEFAULT_MODEL`. A gateway may know Jev by another id. */
  model?: string;
  /** Sent with every request, e.g. a gateway's own token. */
  headers?: Record<string, string>;
  /** Per-request timeout; defaults to 10 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /**
   * The SDK refuses to run in a browser unless told the key is meant to be there (a player's
   * own key, sent to their own proxy). Set it in the browser; leave it off in Node.
   */
  browser?: boolean;
}

/** A `JevBackend` on the TypeSafe SDK. No environment variables are read: the key is explicit. */
export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model ?? DEFAULT_MODEL,
    timeout: options.timeoutMs ?? 10_000,
    logLevel: "off",
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.headers === undefined ? {} : { defaultHeaders: options.headers }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.browser === true ? { dangerouslyAllowBrowser: true } : {}),
  });
  return {
    kind: "typesafe",
    systemOne: (request, requestOptions) => client.systemOne(request, requestOptions),
  };
}
```

- [ ] **Step 4: Run the library test**

Run: `pnpm vitest run --project agent packages/agent/src/backend.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the app wrapper and move the four route tests to it**

`src/jev/backend.ts`:

```ts
import { createTypeSafeBackend, DEFAULT_MODEL, type JevBackend } from "@jev-poker/agent";
import { type Connection, connectionHeaders, modelFor } from "./connection";

export interface ProxyBackendOptions {
  /** Which service the proxy should forward to, and the credentials for it. */
  connection: Connection;
  /** e.g. `${location.origin}/api/jev`; the SDK appends `/v1/systemone`. */
  baseURL: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * The game's backend: the library client pointed at this site's proxy, with the route headers
 * the proxy needs to pick an upstream. The key travels in `X-TypeSafe-Key`, not as a bearer
 * token, because the proxy turns it into `Authorization` itself.
 */
export function createProxyBackend(options: ProxyBackendOptions): JevBackend {
  const { connection } = options;
  return createTypeSafeBackend({
    apiKey: connection.apiKey,
    baseURL: options.baseURL,
    model: modelFor(connection, options.model ?? DEFAULT_MODEL),
    headers: connectionHeaders(connection),
    browser: true,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
```

`src/jev/backend.test.ts`: take the four cases that were in the moved file (`posts to <baseURL>/v1/systemone …`, `asks the vercel gateway …`, `asks the lolipop gateway …`, `sends the four cloudflare headers …`) verbatim, with the imports changed to `import { createProxyBackend } from "./backend";` and `from "./connection"`, and `createTypeSafeBackend({ connection, baseURL, fetch, model })` in `ask` renamed to `createProxyBackend(...)`. Delete those four cases from `packages/agent/src/backend.test.ts` if any survived Step 1 (the file written in Step 1 has only the three library cases).

Note the SDK still sends `Authorization: Bearer <key>` alongside `X-TypeSafe-Key`; that is today's behaviour too (the proxy rebuilds upstream headers from scratch), so the app tests keep asserting only the `X-*` headers.

`src/ui/GameScreen.tsx`: change `import { createTypeSafeBackend, type JevBackend } from "../jev/backend";` to `import { createProxyBackend } from "../jev/backend";` plus `import type { JevBackend } from "@jev-poker/agent";`, and the call `createTypeSafeBackend({ connection, baseURL, model })` to `createProxyBackend({ connection, baseURL, model })`.

- [ ] **Step 6: Collapse the bench backend into the library one**

`bench/backend.ts` becomes:

```ts
import { createTypeSafeBackend, type JevBackend, type Persona, PRESET_PERSONAS } from "@jev-poker/agent";

export interface NodeBackendOptions {
  /** Falls back to `TYPESAFE_API_KEY` when omitted. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/** The library backend with the benchmark's key lookup: explicit option first, then the environment. */
export function createNodeBackend(options: NodeBackendOptions = {}): JevBackend {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("no TypeSafe API key: pass apiKey or set TYPESAFE_API_KEY");
  }
  return createTypeSafeBackend({
    apiKey,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

/** One of the game's preset personas, by id. */
export function getPersona(id: string): Persona {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`unknown persona: ${id}`);
  return persona;
}
```

`bench/backend.test.ts`: keep the existing cases and add one:

```ts
  it("refuses to build without a key", () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => createNodeBackend()).toThrow("no TypeSafe API key");
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });
```

Remove `@typesafe-ai/sdk` from the root `package.json` `devDependencies` (nothing outside `packages/agent` imports it now; `grep -rn "@typesafe-ai/sdk" src bench functions` must print nothing).

- [ ] **Step 7: Check and commit**

Run: `pnpm install && pnpm check`
Expected: green. Test count: previous total − 0 (four cases moved, three library cases and one bench case added → +4).

```bash
git add -A
git commit -m "feat(agent): plain TypeSafe backend for library users; app keeps its proxy wrapper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Personas never look for `localStorage` on their own

**Files:**
- Modify: `packages/agent/src/personas.ts:94-96` (the `loadPersonas` signature) and the `defaultStorage` function
- Modify: `packages/agent/src/personas.test.ts`, `src/ui/App.tsx:37`

**Interfaces:**
- Produces: `loadPersonas(storage: KeyValueStorage | null): Persona[]` — `null` means "presets only".

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/src/personas.test.ts`:

```ts
describe("loadPersonas without storage", () => {
  it("returns the presets and reads no global", () => {
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = new Proxy({}, { get() { throw new Error("library code touched localStorage"); } });
    try {
      expect(loadPersonas(null).map((p) => p.id)).toEqual(PRESET_PERSONAS.map((p) => p.id));
    } finally {
      if (saved === undefined) delete g.localStorage;
      else g.localStorage = saved;
    }
  });
});
```

(Import `loadPersonas` and `PRESET_PERSONAS` from `./personas.js` at the top if the file does not already.)

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --project agent packages/agent/src/personas.test.ts`
Expected: the new case fails to type-check or throws `library code touched localStorage` — with the current default parameter, `loadPersonas(null)` is fine but the *type-check* of the whole change is what Step 3 fixes; if the case passes already, that is acceptable: proceed to Step 3 and rely on the `tsc` check that `defaultStorage` is gone.

- [ ] **Step 3: Make `storage` explicit**

In `packages/agent/src/personas.ts`:
- Change the signature to `export function loadPersonas(storage: KeyValueStorage | null): Persona[] {` and the first guard to `if (storage === null) return presets;`.
- Delete the `defaultStorage` function entirely.
- Confirm: `grep -n "localStorage" packages/agent/src/*.ts` prints nothing.

In `src/ui/App.tsx` line 37: `useState<Persona[]>(() => loadPersonas())` → `useState<Persona[]>(() => loadPersonas(localStorage))`.

Fix any test in `personas.test.ts` that called `loadPersonas()` with no argument: pass `null` where it expected presets only, or the fake storage it was already using.

- [ ] **Step 4: Check and commit**

Run: `pnpm check`
Expected: green.

```bash
git add -A
git commit -m "refactor(agent): personas take their storage explicitly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `playHand` — drive one hand with agents

**Files:**
- Create: `packages/agent/src/play.ts`, `packages/agent/src/play.test.ts`
- Modify: `packages/agent/src/index.ts` (add the export), `bench/runner.ts:165-176`

**Interfaces:**
- Consumes: `Table`, `playerView`, `HandSnapshot`, `GameEvent`, `ActionTakenEvent` from `@jev-poker/engine`; `Agent` from `./agents/types.js`.
- Produces:
  ```ts
  export interface PlayHandOptions { signal?: AbortSignal; onEvent?: (event: GameEvent) => void; }
  export function playHand(table: Table, agents: ReadonlyArray<Agent>, options?: PlayHandOptions): Promise<HandSnapshot>;
  ```

- [ ] **Step 1: Write the failing tests**

`packages/agent/src/play.test.ts`:

```ts
import { fixedBlinds, type GameEvent, Table } from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import { CallerAgent } from "./agents/caller.js";
import { RulesAgent } from "./agents/rules.js";
import { playHand } from "./play.js";

function table(seats: number, seed = 1): Table {
  return new Table({
    format: "cash",
    blinds: fixedBlinds(1, 2),
    startingStack: 200,
    seats: Array.from({ length: seats }, (_, id) => ({ id, name: `seat${id}`, kind: "cpu" as const })),
    seed,
  });
}

describe("playHand", () => {
  it("plays a hand to completion and returns the final snapshot", async () => {
    const t = table(3);
    const events: GameEvent[] = [];
    const snapshot = await playHand(t, [new RulesAgent(), new CallerAgent(), new RulesAgent()], {
      onEvent: (e) => events.push(e),
    });
    expect(snapshot.complete).toBe(true);
    expect(events.some((e) => e.type === "ActionTaken")).toBe(true);
    expect(events.at(-1)?.type === "HandEnded" || events.some((e) => e.type === "Showdown")).toBe(true);
    // Chips are conserved.
    const total = snapshot.players.reduce((sum, p) => sum + p.stack + p.contributed, 0);
    expect(total).toBe(600);
  });

  it("can play several hands on the same table", async () => {
    const t = table(2);
    const agents = [new CallerAgent(), new CallerAgent()];
    const first = await playHand(t, agents);
    const second = await playHand(t, agents);
    expect(first.complete && second.complete).toBe(true);
    expect(t.handNumber).toBe(2);
  });

  it("throws when a seat has no agent", async () => {
    await expect(playHand(table(3), [new CallerAgent(), new CallerAgent()])).rejects.toThrow(
      /no agent for seat 2/,
    );
  });

  it("rejects with AbortError once the signal is aborted", async () => {
    const controller = new AbortController();
    const blocking = {
      id: "blocking",
      decide: () => new Promise<never>(() => {}),
    };
    const promise = playHand(table(2), [blocking, blocking], { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
```

Adjust the event names in the first case to the engine's actual `GameEvent` union (`grep -n "type: \"" packages/engine/src/types.ts`): the assertion should be that the hand produced actions and reached its end event; use whatever the engine names the terminal event (`HandEnded`, `PotAwarded`, …). Check `Table` exposes `handNumber` (it does: "Number of completed hands; also the next hand's number" at `packages/engine/src/table.ts:33`); if it is private, assert `t.snapshot()?.complete` instead.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run --project agent packages/agent/src/play.test.ts`
Expected: FAIL — `./play.js` does not exist.

- [ ] **Step 3: Implement `playHand`**

`packages/agent/src/play.ts`:

```ts
import {
  type ActionTakenEvent,
  type GameEvent,
  type HandSnapshot,
  playerView,
  type Table,
} from "@jev-poker/engine";
import type { Agent } from "./agents/types.js";

export interface PlayHandOptions {
  /** Aborting rejects before the next decision; the hand on the table is left where it was. */
  signal?: AbortSignal;
  /** Every event the table emits during the hand, in order. */
  onEvent?: (event: GameEvent) => void;
}

function abortError(): Error {
  return new DOMException("playHand aborted", "AbortError");
}

/**
 * Starts a hand on `table` and asks `agents[seat]` for every decision until it is complete.
 * The agents see the hand exactly as the game's own CPUs do: a `PlayerView` built from the
 * snapshot and the actions taken so far.
 */
export async function playHand(
  table: Table,
  agents: ReadonlyArray<Agent>,
  options: PlayHandOptions = {},
): Promise<HandSnapshot> {
  const taken: ActionTakenEvent[] = [];
  const unsubscribe = table.on((event: GameEvent) => {
    if (event.type === "ActionTaken") taken.push(event);
    options.onEvent?.(event);
  });
  try {
    let snapshot = table.startHand();
    while (!snapshot.complete) {
      if (options.signal?.aborted) throw abortError();
      const seat = snapshot.actingSeat;
      if (seat === null) throw new Error("hand is not over but no seat is to act");
      const agent = agents[seat];
      if (agent === undefined) throw new Error(`no agent for seat ${seat}`);
      const action = await race(agent.decide(playerView(snapshot, seat, taken), table.legalActions(seat)), options.signal);
      table.act(seat, action);
      const next = table.snapshot();
      if (next === null) throw new Error("the table lost its hand");
      snapshot = next;
    }
    return snapshot;
  } finally {
    unsubscribe();
  }
}

/** Resolves with the decision, or rejects as soon as the signal fires. */
function race<T>(decision: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return decision;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    decision.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
```

Add to `packages/agent/src/index.ts`: `export * from "./play.js";`

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project agent packages/agent/src/play.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Make the benchmark use it**

In `bench/runner.ts`, inside `playHand(args)` (the bench function keeps its name; it lives in a different module), replace the block from `let snapshot = table.startHand();` through the end of the `while` loop with:

```ts
    await playOneHand(table, agents, { onEvent: onTableEvent });
```

where the existing `table.on((e: GameEvent) => { ... })` listener body becomes a named function `onTableEvent` (it still fills `vpip`, `pfr`, `folded`, `actions`, `wentToShowdown` and calls `args.onEvent`), the `taken` array and the `table.on` subscription plus `unsubscribe` are deleted (the library collects `taken` itself), and the import is `import { playHand as playOneHand } from "@jev-poker/agent";`. The `try/finally` that only called `unsubscribe()` goes away; the rest of the function (net stacks, the returned `HandRecord`) is unchanged.

- [ ] **Step 6: Check and commit**

Run: `pnpm check`
Expected: green; `bench/runner.test.ts` still passes with identical results (the seeded deals and the agents did not change).

```bash
git add -A
git commit -m "feat(agent): playHand drives a table with agents; bench uses it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: An explicit public surface for `@jev-poker/agent`

**Files:**
- Modify: `packages/agent/src/index.ts`, `packages/agent/src/agents/index.ts`
- Create: `packages/agent/src/index.test.ts`

**Interfaces:**
- Produces: the exact export list of spec §3.7 (plus `PlayHandOptions`, `playHand`).

- [ ] **Step 1: Write the failing test**

`packages/agent/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// The public surface is a promise to library users; anything new here needs a changeset.
const PUBLIC_VALUES = [
  "ACTION_LABELS",
  "CallerAgent",
  "DEFAULT_MODEL",
  "HeuristicAgent",
  "JevAgent",
  "PRESET_PERSONAS",
  "RandomAgent",
  "RulesAgent",
  "SIZING_RUBRIC",
  "buildFeatures",
  "buildQuestions",
  "chartPreflop",
  "clampVariance",
  "createAgent",
  "createMockBackend",
  "createTypeSafeBackend",
  "decideAction",
  "duplicatePersona",
  "fallbackAction",
  "featuresFromView",
  "legalLabels",
  "loadPersonas",
  "personaPrompt",
  "playHand",
  "saveCustomPersonas",
  "sizingToAmount",
].sort();

describe("@jev-poker/agent public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(api).sort()).toEqual(PUBLIC_VALUES);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run --project agent packages/agent/src/index.test.ts`
Expected: FAIL — `export *` currently leaks more (`PERSONA_STORAGE_KEY`, `PREFLOP_SIZING_RUBRIC`, `sizingRubricFor`, `sampleLabel`, `TASK`, `COMMON_CONTEXT`, …).

- [ ] **Step 3: List the exports by name**

Replace `packages/agent/src/index.ts` with:

```ts
export {
  type Agent,
  type AgentDecision,
  type BaselineId,
  CallerAgent,
  chartPreflop,
  createAgent,
  HeuristicAgent,
  JevAgent,
  type JevAgentOptions,
  RandomAgent,
  RulesAgent,
} from "./agents/index.js";
export {
  createTypeSafeBackend,
  DEFAULT_MODEL,
  type JevBackend,
  type TypeSafeBackendOptions,
} from "./backend.js";
export {
  type DecideInput,
  type DecisionJev,
  type DecisionRecord,
  decideAction,
  fallbackAction,
  type SizingSnapshot,
  sizingToAmount,
} from "./decide.js";
export {
  type ActionTakenEvent,
  buildFeatures,
  type BuildFeaturesInput,
  type DecisionFeatures,
  type FeatureOptions,
  type FeaturesHand,
  type FeaturesHistoryEntry,
  type FeaturesSeat,
  type FeaturesTable,
  featuresFromView,
  type OpponentStats,
  type PersonaPrompt,
} from "./features.js";
export { createMockBackend } from "./mock-backend.js";
export {
  clampVariance,
  duplicatePersona,
  type KeyValueStorage,
  loadPersonas,
  type LocalizedText,
  type Persona,
  personaPrompt,
  PRESET_PERSONAS,
  saveCustomPersonas,
} from "./personas.js";
export { type PlayHandOptions, playHand } from "./play.js";
export {
  ACTION_LABELS,
  type ActionLabel,
  buildQuestions,
  legalLabels,
  type PokerQuestions,
  type PromptStyle,
  type QuestionOptions,
  SIZING_RUBRIC,
  type SizingRubric,
} from "./questions.js";
```

If `tsc` then reports that the app or the bench imports a name no longer exported (e.g. `PERSONA_STORAGE_KEY` from `src/ui/storage.ts`, or `sampleLabel` from a test), either add that name to the list above (it is public then — say so in the commit message) or change the importer to what it actually needs. `src/jev/prefetch.ts` needs `sizingToAmount`, `legalLabels`, `DecisionRecord`, `ActionTakenEvent`, `DecisionFeatures` — all listed.

- [ ] **Step 4: Run the test and the full check**

Run: `pnpm vitest run --project agent packages/agent/src/index.test.ts` → 1 passed.
Run: `pnpm check` → green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agent): name every public export of @jev-poker/agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Package verification (publint, attw) locally and in CI

**Files:**
- Create: `scripts/verify-packages.mjs`
- Modify: root `package.json` (devDependencies + scripts), `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `pnpm verify:packages` — packs each package with `pnpm pack` (so `publishConfig` applies), then runs publint on the tarball and `attw` on it; exits non-zero on any problem. CI job `packages` runs it on Node 20 and 24.

- [ ] **Step 1: Install the tools**

Run: `pnpm add -Dw publint @arethetypeswrong/cli`
(If Safe-chain's minimum package age blocks the newest versions, pin the newest it allows: `pnpm add -Dw publint@0.3 @arethetypeswrong/cli@0.18` and let Dependabot move them later.)

- [ ] **Step 2: Write the verification script**

`scripts/verify-packages.mjs`:

```js
// Packs each workspace package the way `pnpm publish` would (publishConfig applied) and checks
// the tarball: publint for package.json/file mistakes, attw for types that resolve wrongly.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const root = resolve(import.meta.dirname, "..");
const packs = join(root, ".packs");
rmSync(packs, { recursive: true, force: true });
mkdirSync(packs);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = false;

for (const name of readdirSync(join(root, "packages"))) {
  const dir = join(root, "packages", name);
  execFileSync(pnpm, ["pack", "--pack-destination", packs], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  const tarball = readdirSync(packs).find((f) => f.startsWith(`jev-poker-${name}-`) && f.endsWith(".tgz"));
  if (tarball === undefined) throw new Error(`no tarball produced for ${name}`);
  const path = join(packs, tarball);

  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const { messages } = await publint({ pack: { tarball: readFileSync(path).buffer }, strict: true });
  for (const m of messages) {
    console.log(`publint ${name}: ${formatMessage(m, pkg)}`);
    if (m.type === "error") failed = true;
  }

  try {
    execFileSync("attw", [path, "--profile", "esm-only"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  } catch {
    failed = true;
  }
}

if (failed) {
  console.error("package verification failed");
  process.exit(1);
}
console.log("packages verified");
```

(`attw` resolves from `node_modules/.bin` because pnpm puts it on `PATH` for `pnpm run`. The `esm-only` profile tells attw that CommonJS consumers are out of scope, as the spec says.)

Root `package.json` scripts: add `"verify:packages": "pnpm build:packages && node scripts/verify-packages.mjs"`, and make `"check"` end with `&& pnpm verify:packages` instead of `&& pnpm build:packages`.

- [ ] **Step 3: Run it and fix what it finds**

Run: `pnpm verify:packages`
Expected: two `pnpm pack` summaries, no publint errors, attw prints a table with no ❌, and `packages verified`. Typical findings and their fixes: publint `FILE_DOES_NOT_EXIST` for `README.md`/`LICENSE` (Task 1/2 created them — check `files`); attw "Untyped resolution" means the `types` condition is missing in `publishConfig.exports`.

- [ ] **Step 4: Add the CI job**

Append to `.github/workflows/ci.yml` under `jobs:`:

```yaml
  packages:
    name: packages (node ${{ matrix.node }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      matrix:
        node: [20, 24]
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # The two published packages alone, on the oldest supported Node as well as the current one.
      - run: pnpm vitest run --project engine --project agent
      - run: pnpm verify:packages
```

`pnpm install` on Node 20: the root `engines.node` is `>=24`, and pnpm refuses to install when the engine does not match unless `engine-strict` is off (it is off by default; pnpm only warns). Confirm the warning is not an error by reading the job log on the first run; if it errors, add `engine-strict=false` to a root `.npmrc`.

- [ ] **Step 5: Check and commit**

Run: `pnpm check`
Expected: green, ending with `packages verified`.

```bash
git add -A
git commit -m "ci: verify the packed packages with publint and attw on Node 20 and 24

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Changesets and the release workflow

**Files:**
- Create: `.changeset/config.json`, `.changeset/README.md`, `.changeset/initial-packages.md`, `.github/workflows/release.yml`
- Modify: root `package.json` (devDependencies, scripts), `CONTRIBUTING.md`

**Interfaces:**
- Produces: `pnpm changeset` for contributors; `pnpm release` (build + `changeset publish`) used by the workflow.

- [ ] **Step 1: Install and initialise**

Run: `pnpm add -Dw @changesets/cli @changesets/changelog-github` then `pnpm changeset init`.

Replace the generated `.changeset/config.json` with:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "nft-syou/jev-poker" }],
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": false, "tag": false },
  "ignore": []
}
```

(`privatePackages.version: false` keeps the private root app out of versioning; the two packages version independently, and a bump of `engine` patches `agent`'s dependency range.)

Create the first changeset, `.changeset/initial-packages.md`:

```md
---
"@jev-poker/engine": minor
"@jev-poker/agent": minor
---

First published versions: the No-Limit Hold'em engine, and the Jev CPU with baseline bots, personas and `playHand`.
```

Root `package.json` scripts: add `"changeset": "changeset"`, `"release": "pnpm build:packages && changeset publish"`.

- [ ] **Step 2: The release workflow**

`.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  id-token: write

concurrency: release-${{ github.ref }}

jobs:
  release:
    # Opens or updates the "Version Packages" PR while changesets accumulate; when that PR has
    # been merged (no changesets left, versions bumped), publishes to npm with provenance.
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify:packages
      - uses: changesets/action@v1
        with:
          publish: pnpm release
          title: "chore(release): version packages"
          commit: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
```

No `NPM_TOKEN`: publishing relies on npm trusted publishing (OIDC from this workflow), which the maintainer configures once per package on npmjs.com (Package → Settings → Trusted publisher → GitHub Actions, repository `nft-syou/jev-poker`, workflow `release.yml`). Until then the publish step fails with 404/E401 and the "Version Packages" PR still works.

- [ ] **Step 3: Document the flow**

Add to `CONTRIBUTING.md`, before "## Things to keep true":

```md
## Changes to the published packages

`packages/engine` and `packages/agent` are published to npm as `@jev-poker/engine` and
`@jev-poker/agent`. A change under `packages/` that users can notice — a new export, a
changed signature, a fixed bug — needs a changeset in the same PR:

    pnpm changeset

Pick the package(s), the bump (`patch` for fixes, `minor` for additions, `major` for
breaking changes) and write one sentence for the changelog. Merging to `main` opens or
updates a "Version Packages" PR; merging that PR publishes.

`packages/agent/src/index.test.ts` pins the public export list. Adding an export means
updating that list on purpose, with a `minor` changeset.
```

- [ ] **Step 4: Check and commit**

Run: `pnpm changeset status` → lists the two packages as `minor`. Run: `pnpm check` → green.

```bash
git add -A
git commit -m "chore: changesets and a provenance-backed release workflow for the packages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

**Files:**
- Modify: `packages/engine/README.md`, `packages/agent/README.md` (replace the placeholders), `README.md`, `README.ja.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-19-jev-poker-design.md`

- [ ] **Step 1: Package READMEs**

`packages/engine/README.md`:

````md
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

Part of [jev-poker](https://github.com/nft-syou/jev-poker). MIT.
````

`packages/agent/README.md`:

````md
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
const cpu = new JevAgent({ persona: PRESET_PERSONAS[1], backend, seed: 42 });

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
const agents = [new JevAgent({ persona: PRESET_PERSONAS[1], backend, seed: 1 }), new RulesAgent()];
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
````

- [ ] **Step 2: Root READMEs, changelog, spec note**

`README.md`: add before "## Contributing":

```md
## Use it as a library

The engine and the CPU are published on npm:

- [`@jev-poker/engine`](packages/engine) — the No-Limit Hold'em engine, zero dependencies.
- [`@jev-poker/agent`](packages/agent) — the Jev CPU, baseline bots, personas and `playHand`.

Each package's README shows the minimal usage. Changes are released with Changesets; see
[CONTRIBUTING.md](CONTRIBUTING.md#changes-to-the-published-packages).
```

`README.ja.md`: add before "## コントリビュート":

```md
## ライブラリとして使う

エンジンと CPU は npm に公開しています。

- [`@jev-poker/engine`](packages/engine) — 依存ゼロのノーリミットホールデムのエンジン。
- [`@jev-poker/agent`](packages/agent) — Jev CPU、ベースライン bot、人格、`playHand`。

最小の使い方は各パッケージの README (英語) を参照してください。
```

Update the "Project layout" sections in both READMEs: replace the `src/engine/`, `src/jev/`, `src/agents/` lines with

```
    packages/engine/  @jev-poker/engine — pure TypeScript poker engine (tested with seeded random play)
    packages/agent/   @jev-poker/agent — features, questions, personas, decision policy, JevAgent, baselines, playHand
    src/jev/          app-only: proxy routes (connection) and the speculative prefetch cache
```

(the same three lines, with Japanese descriptions, in `README.ja.md`).

`CHANGELOG.md` under `[Unreleased]` → `### Added`: `- The engine and the CPU as npm packages: \`@jev-poker/engine\` and \`@jev-poker/agent\` (each has its own changelog under \`packages/\`).`

`docs/superpowers/specs/2026-09-19-jev-poker-design.md`: add after the構成 (layout) section a short note: 「2026-09-22: `src/engine` は `packages/engine` (`@jev-poker/engine`)、`src/agents` と `src/jev` の判断部分は `packages/agent` (`@jev-poker/agent`) に移動した。`src/jev` に残るのは `connection.ts`、`prefetch.ts`、プロキシ向けの `backend.ts` ラッパー。詳細は `2026-09-22-library-packages-design.md`。」

- [ ] **Step 3: Check and commit**

Run: `pnpm check` (Biome formats Markdown? No — but it lints nothing in `.md`; the check is for the code and the packed READMEs going into `files`).
Run: `pnpm verify:packages` again so publint sees the real READMEs.

```bash
git add -A
git commit -m "docs: package READMEs, library section in the root READMEs, changelog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §3.1–3.7 → Tasks 1, 2, 3, 4, 5, 6. §4 (layout, workspace, Vitest projects) → Task 1 (and the recorded deviation on project references). §5 (build, publishConfig, Changesets, release) → Tasks 1, 2, 7, 8. §6 (tests, CI packages job, `pnpm check` unchanged) → Tasks 5, 7. §7 (migration order) is the task order. §8 (docs) → Task 9. §9 needs nothing.
- Names used across tasks: `createTypeSafeBackend` (library, Task 3) vs `createProxyBackend` (app, Task 3) vs `createNodeBackend` (bench, Task 3); `playHand` exported from the package (Task 5) and imported as `playOneHand` in `bench/runner.ts` to avoid shadowing the bench's own `playHand`; `scripts/add-js-extensions.mjs` created in Task 1, reused in Task 2; `pnpm verify:packages` defined in Task 7, used by `check` and by `release.yml` (Task 8).
