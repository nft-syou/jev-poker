# jev-poker ライブラリ化 設計書 / Library Packages Design Spec

日付: 2026-09-22
状態: 設計承認済み (セクション 1〜9 をチャットで提示しユーザー承認)
前提: `2026-09-19-jev-poker-design.md` (メイン spec)、`2026-09-19-benchmark-design.md` (`Agent` と `bench/`)

## 1. 目的

ゲームの CPU (TypeSafe Jev で考えるプレイヤー) と、それが動くポーカーエンジンを、
このアプリの外から使える npm パッケージにする。想定する使い方は 2 つ:

1. 自前のゲーム進行を持つ別のポーカーアプリが、手番ごとに「この局面で何をするか」だけを尋ねる。
2. エンジンごと使い、対局を丸ごと回す (CPU 同士、人間 vs CPU、Discord bot、CLI など)。

アプリ本体 (UI、プロキシ、Cloudflare Pages) はこのリポジトリに残り、同じパッケージを
workspace 経由で使う側になる。

### 非目標 (YAGNI)

- 先読みキャッシュ (`src/jev/prefetch.ts`) の公開。アプリ固有の最適化として残す。必要になったら
  `Hand.clone()` を使う純粋な関数なので後から出せる。
- プロキシ (`src/proxy`、`src/jev/connection.ts`) の公開。ライブラリ利用者は自分のキーで
  上流を直接呼ぶ。
- UI コンポーネントや i18n 辞書の公開。
- CommonJS 出力。ESM のみ。
- トーナメント形式、新しい機能。今回は境界を切って配布するだけで、挙動は変えない。

## 2. 決定事項

| 論点 | 決定 |
| --- | --- |
| 構成 | pnpm workspace。`packages/engine` と `packages/agent` の 2 パッケージ。アプリはルートの private パッケージのまま |
| 名前 | `@jev-poker/engine`、`@jev-poker/agent` (npm で未使用を確認済み。`@jev-poker` 組織の作成はユーザー作業) |
| 参照 | workspace 内はソース (`src/index.ts`) を直接、公開時は `dist` (`publishConfig` で差し替え) |
| ビルド | `tsc` のみ (ESM + `.d.ts`)。バンドルなし |
| 公開 | Changesets + GitHub Actions、npm trusted publishing (OIDC) で provenance 付き |
| 対応環境 | Node 20 以上とモダンブラウザ。CI のテストは Node 20 と 24 |
| ベースライン bot | `random` / `caller` / `rules` / `heuristic` も `@jev-poker/agent` に含める (対戦相手・テスト用) |
| 先読み | アプリに残す |

## 3. パッケージの境界

### 3.1 `@jev-poker/engine` (依存ゼロ)

`src/engine/` を `packages/engine/src/` へ `git mv` する。公開 API は今の
`src/engine/index.ts` の export と同一:

- 進行: `Table`、`Hand`、`fixedBlinds`、`buildPots` / `awardPots`
- 視点: `playerView`、`positionOf`、`historyEntry`、`betOrRaiseTo`、型 `PlayerView`
- 評価: `evaluate5` / `evaluateBest` / `compareHands` (役判定)、`strength`、`equity`、`ranges`
- 乱数: `createRng`、`hashSeed`、`randomSeed`、`shuffle`
- 型: `GameConfig`、`HandSnapshot`、`GameEvent`、`Action`、`LegalActions`、`SeatId`、`Street` など

`src/engine` にブラウザ・Node 固有の API 呼び出しはない (確認済み)。

### 3.2 `@jev-poker/agent` (依存: `@jev-poker/engine`、`@typesafe-ai/sdk`)

| 移動元 | 移動先 | 備考 |
| --- | --- | --- |
| `src/agents/*` | `packages/agent/src/agents/` | `Agent`、`JevAgent`、ベースライン、`chartPreflop` |
| `src/jev/features.ts` | `packages/agent/src/features.ts` | |
| `src/jev/questions.ts` | `packages/agent/src/questions.ts` | |
| `src/jev/decide.ts` | `packages/agent/src/decide.ts` | |
| `src/jev/personas.ts` | `packages/agent/src/personas.ts` | 3.4 の変更あり |
| `src/jev/backend.ts` | `packages/agent/src/backend.ts` | 3.3 の変更あり |
| `src/jev/mock-backend.ts` | `packages/agent/src/mock-backend.ts` | 公開する (利用者のテスト用) |
| `bench/runner.ts` の 1 ハンド進行ループ | `packages/agent/src/play.ts` | 3.5 の新関数 `playHand` |

`@jev-poker/engine` は `dependencies` (peer ではない)。利用者が engine を直接 import する場合も
同じインスタンスが解決されるよう、agent 側の範囲は `^<同時に公開した版>` にする。

### 3.3 バックエンド

今の `createTypeSafeBackend` はアプリのプロキシ前提 (`Connection` と経路ヘッダ) なので、
ライブラリでは素の SDK クライアントを作る関数に置き換える:

```ts
export interface JevBackend {
  readonly kind: "typesafe" | "mock";
  systemOne<const Q extends Questions>(request: SystemOneRequest<Q>, options?: RequestOptions): Promise<SystemOneResult<Q>>;
}

export interface TypeSafeBackendOptions {
  apiKey: string;
  /** 省略時は SDK の既定 (api.typesafe.ai)。ゲートウェイを直接呼ぶならその URL */
  baseURL?: string;
  /** 省略時は "jev-latest" */
  model?: string;
  /** 全リクエストに付ける追加ヘッダ */
  headers?: Record<string, string>;
  /** 省略時は 10_000 */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** ブラウザで動かすとき true。SDK の dangerouslyAllowBrowser に渡す */
  browser?: boolean;
}

export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend;
export function createMockBackend(): JevBackend;
export const DEFAULT_MODEL = "jev-latest";
```

- アプリ側は `src/jev/backend.ts` を「`connection` から `apiKey` / `headers` / `model` を組み立てて
  ライブラリの `createTypeSafeBackend` を呼ぶ薄いラッパー」に書き換える (`baseURL` は
  `${origin}/api/jev`、`browser: true`)。
- `bench/backend.ts` の `createNodeBackend` はライブラリの関数に置き換え、`getPersona` だけ残す。

### 3.4 人格の永続化

`personas.ts` は `KeyValueStorage` 注入で保存する設計だが、読み込み側に「引数省略時は
`localStorage` を探す」分岐がある。ライブラリはグローバルに触らない方針にし、
`storage` を必須引数にする。アプリの `src/ui/storage.ts` が `localStorage` を渡す。
`PRESET_PERSONAS`、`personaPrompt`、`Persona` 型、読み書き関数を公開する。

### 3.5 対局を回す `playHand`

`bench/runner.ts` の「`Table.startHand()` から `complete` まで手番ごとに agent に聞く」
ループを切り出す。bench 固有の集計 (VPIP、ネット収支、`HandRecord`) は bench に残す。

```ts
export interface PlayHandOptions {
  signal?: AbortSignal;
  /** テーブルのイベントを流す。bench はこれで集計する */
  onEvent?: (event: GameEvent) => void;
}

/**
 * 1 ハンドを最後まで進め、完了時のスナップショットを返す。`agents[seat]` が各席の判断者。
 * 席に agent が無い、または手番が無いのにハンドが終わらない場合は例外。
 */
export function playHand(table: Table, agents: ReadonlyArray<Agent>, options?: PlayHandOptions): Promise<HandSnapshot>;
```

- `PlayerView` の組み立てには、その席から見えるこれまでの `ActionTaken` が要る。`playHand` が
  `table.on` で集め、`playerView(snapshot, seat, taken)` に渡す (今の bench と同じ)。
- `signal` が abort されたら次の手番の前に `AbortError` (`DOMException` 名 `"AbortError"`) で reject する。
- 利用例 (CPU 同士、5 ハンド):

```ts
import { Table, fixedBlinds } from "@jev-poker/engine";
import { JevAgent, RulesAgent, createTypeSafeBackend, PRESET_PERSONAS, playHand } from "@jev-poker/agent";

const table = new Table({ format: "cash", blinds: fixedBlinds(1, 2), startingStack: 200,
  seats: [{ id: 0, name: "Jev", kind: "cpu" }, { id: 1, name: "Rules", kind: "cpu" }], seed: 1 });
const backend = createTypeSafeBackend({ apiKey: process.env.TYPESAFE_API_KEY! });
const tag = PRESET_PERSONAS.find((p) => p.id === "tag")!;
const agents = [new JevAgent({ persona: tag, backend, seed: 1 }), new RulesAgent()];
for (let i = 0; i < 5; i++) await playHand(table, agents);
```

### 3.6 アプリに残るもの

`src/ui`、`src/i18n`、`src/proxy`、`functions/`、`src/jev/connection.ts`、`src/jev/prefetch.ts`、
書き換え後の `src/jev/backend.ts`。`src/jev/index.ts` はアプリ内の再 export として残し、
中身をライブラリからの再 export + アプリ固有分に変える。`tsconfig.functions.json` の include は
`src/jev/connection.ts` のままで変更なし。

### 3.7 公開 API の一覧 (`@jev-poker/agent`)

- `Agent`、`BaselineId`、`createAgent`、`RandomAgent`、`CallerAgent`、`RulesAgent`、`HeuristicAgent`、`chartPreflop`
- `JevAgent`、`JevAgentOptions`、`AgentDecision`
- `JevBackend`、`createTypeSafeBackend`、`TypeSafeBackendOptions`、`createMockBackend`、`DEFAULT_MODEL`
- `Persona`、`PRESET_PERSONAS`、`personaPrompt`、`duplicatePersona`、`clampVariance`、`loadPersonas` / `saveCustomPersonas`、`KeyValueStorage`
- `featuresFromView`、`buildFeatures`、`DecisionFeatures`、`FeatureOptions`、`OpponentStats`
- `decideAction`、`fallbackAction`、`sizingToAmount`、`DecisionRecord`、`DecideInput`、`SizingSnapshot`
- `buildQuestions`、`legalLabels`、`ACTION_LABELS`、`SIZING_RUBRIC`、型 `ActionLabel`、`PromptStyle`、`PokerQuestions`
- `playHand`、`PlayHandOptions`

内部だけで使うものは `index.ts` から出さない。今 `export *` している箇所は、
名前を列挙する形に改める (公開面を意図したものに限るため)。

## 4. リポジトリ構成

```
packages/
  engine/
    package.json      name @jev-poker/engine, type module, exports → ./src/index.ts, publishConfig.exports → ./dist
    tsconfig.json     extends ../../tsconfig.base.json, composite, rootDir src, outDir dist, declaration
    src/              (旧 src/engine、テスト同居)
  agent/
    package.json      name @jev-poker/agent, dependencies: @jev-poker/engine (workspace:^), @typesafe-ai/sdk
    tsconfig.json     references: ../engine
    src/
src/                  アプリ (ui, i18n, proxy, jev/{connection,prefetch,backend,index})
bench/                @jev-poker/* を import する側に書き換え
functions/, wrangler.jsonc, vite.config.ts, index.html   変更なし
tsconfig.base.json    共通 compilerOptions (今の tsconfig.json から抽出)
tsconfig.json         アプリ用。references で 2 パッケージを参照
pnpm-workspace.yaml   packages: ["packages/*"] を追加 (既存の allowBuilds は維持)
.changeset/           config.json (access public, baseBranch main)
```

- `exports` がソースを指すので、Vite / Vitest / `tsc` (`moduleResolution: Bundler`) は
  ビルドなしで解決する。`pnpm install` が `node_modules/@jev-poker/*` にシンボリックリンクを張る。
- `publishConfig` で `exports` / `main` / `types` を `dist` に差し替える。pnpm は publish 時に
  この上書きを適用する。`files` は `dist` と `README.md` と `LICENSE`。
- `biome.json` の対象は変えない (`**` なので `packages/` も含まれる)。
- Vitest は `projects` で `engine` / `agent` / `app` (`src`、`functions`) / `bench` の 4 つに分け、
  `pnpm test` は全部を回す。テストファイルは移動するだけで内容は変えない。

## 5. ビルドと公開

- `pnpm -r --filter "./packages/*" build` = 各パッケージで `tsc -p tsconfig.json` (`outDir dist`)。
  `dist` は `.gitignore` 済み。
- `package.json` (両方共通): `type: module`、`sideEffects: false`、`engines.node: ">=20"`、
  `license: MIT`、`repository` (directory 付き)、`publishConfig.access: public`。
- Changesets:
  - PR は `.changeset/*.md` を添える (`pnpm changeset`)。CI は「`packages/` に変更があるのに
    changeset が無い PR」を落とさない (bot 運用は後回し。CONTRIBUTING に手順を書く)。
  - `release.yml`: `main` への push で `changesets/action` を実行。changeset が溜まっていれば
    「Version Packages」PR を作り、それがマージされた push では `pnpm changeset publish` で
    npm に公開する。`permissions: id-token: write, contents: write, pull-requests: write`、
    `NPM_CONFIG_PROVENANCE=true`。npm 側は trusted publishing (GitHub Actions の OIDC) を
    各パッケージに設定する (ユーザー作業。設定前は公開ステップが 404 で失敗するだけで、
    PR 作成までは動く)。
  - engine と agent は独立バージョン。agent が engine の新 API を使う変更では両方の
    changeset を書く。

## 6. テストと CI

- 既存の 653 テストは移動のみ。`playHand` と新しい `createTypeSafeBackend` にはテストを足す
  (`playHand`: mock backend + `RulesAgent` で 1 ハンド完走、abort で reject、agent 不足で例外。
  backend: fake `fetch` で `Authorization`、`baseURL`、追加ヘッダ、model が届くこと)。
- `ci.yml` に `packages` ジョブを足す: Node 20 と 24 のマトリクスで
  `pnpm -r --filter "./packages/*" build` → `publint` → `attw --pack` (Are The Types Wrong)。
  `exports` と型の整合が PR 時点で分かる。
- `pnpm check` は今のまま 1 コマンド (lint → typecheck → test → build)。`typecheck` は
  `tsc -b` (references) + `tsconfig.functions.json` にする。

## 7. 移行手順の方針

1. `git mv` で履歴を保ったまま移動し、import パスを `@jev-poker/engine` / `@jev-poker/agent` に置換する。
2. アプリと bench が新しい import で `pnpm check` を通る状態を、1 つの変更単位として作る
   (途中の壊れた状態を main に入れない)。
3. その後、`createTypeSafeBackend` の分割、`personas` の storage 必須化、`playHand` の切り出し、
   `index.ts` の名前列挙化を順に行う。
4. 最後に Changesets、release workflow、CI の packages ジョブ、各パッケージの README。

## 8. ドキュメント

- `packages/engine/README.md`、`packages/agent/README.md` (英語。インストール、最小の使い方、
  API 一覧へのリンク)。
- ルート README に「Use it as a library」節を足し、2 パッケージへリンクする。`README.ja.md` も同様。
- `CONTRIBUTING.md` に changeset の書き方と、`packages/` の変更時の注意 (公開 API になる) を足す。
- メイン spec §構成に、パッケージ境界を反映する注記を足す。

## 9. 将来拡張 (実装しないが壊さない)

- `prefetch.ts` を `@jev-poker/agent` に出す (`Hand.clone()` と `Agent` だけで書けるように保つ)。
- トーナメント形式は engine の `BlindSchedule` 側の話で、パッケージ境界は変わらない。
- ブラウザ向け ESM の CDN 配布 (バンドルなしで ESM を出すので、そのまま import できる)。
