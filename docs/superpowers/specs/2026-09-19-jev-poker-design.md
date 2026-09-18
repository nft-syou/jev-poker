# jev-poker 設計書 / Design Spec

日付: 2026-09-19
状態: 実装済み (実装計画: docs/superpowers/plans/2026-09-19-jev-poker.md)

## 1. 目的

TypeSafe Jev (`@typesafe-ai/sdk` の `systemOne`) を CPU プレイヤーの意思決定に使う
テキサスホールデム(ノーリミット)のブラウザゲーム。人間 1 人 + CPU、または全席 CPU の
観戦モードで動く。Cloudflare Pages にデプロイし、プレイには各ユーザー自身の
TypeSafe API キーが必要。MIT ライセンスの OSS。

### 非目標 (YAGNI)

- マルチプレイヤー(複数の人間)。
- サーバー側での状態保持・アカウント・ランキング。
- トーナメント形式の実装 (ただし拡張できる形にしておく)。
- 鍵をサーバー側で保有すること。

## 2. 決定事項

| 項目 | 決定 |
| --- | --- |
| ルール | NL テキサスホールデム、2〜6 席、キャッシュゲーム。トーナメントは後で追加可能に設計 |
| スタック | Vite + React + TypeScript、Vitest、pnpm |
| i18n | i18next + react-i18next、`ja` / `en`。README は英日併記 |
| CPU 人格 | プリセット 5 種 + ユーザー編集可 (localStorage 保存) |
| API キー | ブラウザ側 BYOK。localStorage 保存、Pages Functions プロキシ経由で送信 |
| ライセンス | MIT |

## 3. アーキテクチャ

### 3.1 API キーの扱い (採用: プロキシ + BYOK)

`api.typesafe.ai` への CORS プリフライト (任意オリジン) は `Access-Control-Allow-Origin`
を返さず 400 だった (2026-09-19 検証)。よってブラウザ直叩きは採らず、Cloudflare Pages
Functions を薄いプロキシとする。

- ブラウザは入力されたキーを `localStorage` に保存し、`POST /api/jev/v1/systemone` に
  ヘッダ `X-TypeSafe-Key: <key>` を付けて送る。
- Function はヘッダを `Authorization: Bearer <key>` に載せ替え、ボディをそのまま
  `https://api.typesafe.ai/v1/systemone` に転送し、ステータス・ボディをそのまま返す。
- Function はキーとボディをログしない。許可するのは `POST /api/jev/v1/systemone` と
  `GET /api/jev/v1/models` のみ。それ以外は 404。
  (パスが `/v1/...` なのは SDK が `baseURL + "/v1/systemone"` を叩くため。)
- キーが無いリクエストは 401 を返す (上流に到達させない)。
- 検討して却下した案: (B) ブラウザ直叩き。CORS で動かない可能性が高い。
  (C) ホスト側で 1 本のキーを Secret 保持。「プレイにはキー必要」と逆で運営者が全額負担。

### 3.2 リポジトリ構成 (単一パッケージ)

```
jev-poker/
  src/engine/        純 TS、依存ゼロ。React・DOM・Jev を import しない (テストで機械的に検証)
  src/jev/           Jev エージェント: 状態圧縮、質問セット、回答→合法アクション、Mock バックエンド
  src/ui/            React コンポーネント、状態管理、観戦モード
  src/i18n/          i18next 初期化、locales/ja.json、locales/en.json
  src/main.tsx       エントリ
  functions/api/jev/[[path]].ts   Pages Functions プロキシ
  docs/superpowers/specs/          設計書
  LICENSE            MIT
  README.md          英語 + 日本語
  wrangler.jsonc     `wrangler pages dev` 用
  .github/workflows/ci.yml        lint / typecheck / test / build
```

モノレポにしない理由: Pages デプロイと貢献者の導線を単純にするため。
境界はフォルダとテスト (`engine` の import グラフ検査) で守る。

## 4. ゲームエンジン (`src/engine`)

### 4.1 型

```ts
type Suit = 'c' | 'd' | 'h' | 's';
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;   // 14 = A
interface Card { rank: Rank; suit: Suit }

type SeatId = number;                     // 0..5
interface SeatConfig { id: SeatId; name: string; kind: 'human' | 'cpu'; personaId?: string }

interface BlindSchedule {
  /** ハンド番号 (0 始まり) と経過ミリ秒から現在のブラインドを返す */
  blindsFor(handNumber: number, elapsedMs: number): { small: number; big: number; ante: number };
}
interface GameConfig {
  format: 'cash' | 'tournament';
  blinds: BlindSchedule;                  // cash: 固定値を返す実装
  startingStack: number;
  seats: SeatConfig[];
  seed?: number;                          // 乱数シード (テスト用)
}

type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }       // 誰もベットしていないとき
  | { type: 'raise'; amount: number }     // amount = 合計のベット額 (raise to)
  | { type: 'allin' };

interface LegalActions {
  canFold: boolean; canCheck: boolean; callAmount: number | null;
  minRaiseTo: number | null; maxRaiseTo: number | null;   // 合計額。null = レイズ不可
}
```

### 4.2 状態機械

- `Table` クラスがハンドをまたぐ状態 (席、スタック、ボタン位置、ハンド番号) を持つ。
- `Hand` がハンド内状態 (デッキ、ボード、各街の投入額、現在の手番、ポット) を持つ。
- `table.startHand()` → `hand.legalActions(seat)` → `hand.act(seat, action)` の API。
  `act` は不正なアクションを投げる (UI/エージェント側が `legalActions` で先に整形する)。
- 街の終了判定: 全アクティブプレイヤーの投入額が揃い、かつ最後のアグレッサーまで一周。
- オールイン・サイドポット: 投入額ごとに層を分けて分配。端数チップはボタン左から配る。
- ショーダウン: 7 枚から最良 5 枚役を評価 (21 通りの 5 枚組合せを全探索)。
- キャッシュゲーム: スタック 0 の席はハンド終了時に `startingStack` で自動リバイ。
  トーナメント (将来): 同じ場所で `eliminated` にする分岐を入れるだけ。
- 乱数は `seed` から生成する xorshift 系 PRNG。未指定時は `crypto.getRandomValues` でシード。

### 4.3 イベント

`Table` は以下を発行し、UI と履歴が購読する:
`HandStarted`, `BlindsPosted`, `HoleCardsDealt`, `ActionTaken`, `StreetDealt`,
`Showdown`, `PotAwarded`, `HandEnded`, `SeatRebought`。
各イベントはシリアライズ可能な plain object。

## 5. Jev エージェント (`src/jev`)

### 5.1 原則

コードで正確に計算できるものはコードで計算し、Jev には圧縮済みの状態だけを渡す。
生のイベントログや相手のホールカードは渡さない。

### 5.2 Jev に渡す状態 (`state`)

```ts
{
  task: "Decide the next poker action for the acting player in No-Limit Texas Hold'em.",
  persona: { name, description },                 // 人格の説明文 (常に英語で送る)
  importantContext: [ "Only legal actions are offered.", "Amounts are in big blinds.", ... ],
  hand: {
    street, holeCards, board,
    madeHand: "high_card" | "pair" | "two_pair" | ... ,   // コードで判定
    draws: ["flush_draw", "open_ended", "gutshot"],       // コードで判定
    preflopStrength: "premium" | "strong" | "medium" | "weak" | "trash",  // 169 ハンド表
  },
  table: {
    position: "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO",
    playersInHand, playersToAct,
    potBB, toCallBB, potOddsPct, effectiveStackBB,
    stacksBB: [{ seat, stackBB, isAllIn }],
  },
  history: [ { street, seat, action, committedBB } ]   // 今ハンドのみ
  // committedBB: このアクションでポットに投入したチップ (BB 換算)。
  // 「raise to X」の合計額は action の文字列側に入る。
}
```

### 5.3 質問 (1 回の `systemOne`)

```ts
{
  action: choice("What should the acting player do?", {
    fold: "...", check_or_call: "...", bet_or_raise: "..."       // 非合法な選択肢はキーごと削除
  }),
  sizing: score("If betting or raising, how large?", [
    "minimum", "about one third of the pot", "about two thirds of the pot",
    "about the pot", "an overbet", "all in"
  ]),
  bluff_intent: noul("Would a bet or raise here be primarily a bluff?"),
}
```

### 5.4 回答 → アクション

1. `action.probabilities` を人格の `variance` (0..1) で平滑化し (`variance=0` で argmax、
   `1` で確率通りサンプリング)、`seed` 付き PRNG で 1 つ選ぶ。
2. `bet_or_raise` なら `sizing.score` (連続値) を額に写像し、`LegalActions` の
   `minRaiseTo..maxRaiseTo` にクランプ。`check_or_call` は `canCheck ? check : call`。
3. 結果と Jev の生の確率 (`probabilities`, `bluff_intent`) を `DecisionRecord` として履歴に残す。

### 5.5 失敗時

- SDK のリトライ (429/5xx) を使い、それでも失敗したらフェイルオープン:
  `canCheck ? check : fold` にし、`DecisionRecord.error` に理由を残して UI に警告。
- 401/403 はイベント `AuthFailed` を発行し、UI がキー入力モーダルを開く。
- タイムアウトは 1 呼び出し 10 秒 (SDK 既定)。

### 5.6 バックエンド抽象

```ts
interface JevBackend { kind: 'typesafe' | 'mock'; systemOne(req, opts?): Promise<SystemOneResult> }
```
- `typesafe`: SDK の `TypeSafeClient` を `baseURL = <origin>/api/jev`、
  `dangerouslyAllowBrowser: true`、`defaultHeaders: { 'X-TypeSafe-Key': key }` で生成。
  SDK も `Authorization` を付けるが、Function 側で `X-TypeSafe-Key` から作り直して上書きする。
- `mock`: 決定論的 (ハンド強度から確率を作る)。テストと開発用。
  本番 UI にはキー無しで遊ぶ導線を置かない。

## 6. 人格 (`src/jev/personas.ts`)

```ts
interface Persona {
  id: string;
  name: { ja: string; en: string };
  description: { ja: string; en: string };   // Jev には en を送る
  variance: number;                          // 0..1
  isPreset: boolean;
}
```
プリセット: `rock` (超タイト・パッシブ), `tag` (タイト・アグレッシブ),
`lag` (ルース・アグレッシブ), `maniac` (何でもレイズ), `station` (何でもコール)。
設定画面で複製・編集・削除 (プリセットは複製のみ) でき、`localStorage` に保存。
席ごとに人格を割当。

## 7. UI (`src/ui`)

- 画面: `Setup` (席数・人間/CPU・人格・スタック・ブラインド・言語) → `Table`。
- `Table`: 席・カード・ポット・ボード。人間の手番ならアクションバー (Fold / Check-Call /
  Bet-Raise + 額スライダー)。CPU の手番は「思考中」表示。
- 観戦モード (全席 CPU): 再生速度 (0.5x / 1x / 2x / 最速) と一時停止。
- ハンド履歴パネル: 各アクション。CPU は Jev の確率分布とブラフ意図を展開表示。
- キー入力モーダル: 初回 / 401 時。「キーはこのブラウザの localStorage のみに保存され、
  当サイトのサーバーには保存されない」旨を表示。削除ボタン付き。
- 状態管理は React の `useReducer` + エンジンのイベント購読。外部ライブラリ不要。
- i18n: 全文字列を `locales/*.json` に置く。初期言語はブラウザ言語、切替は設定に保存。

## 8. プロキシ (`functions/api/jev/[[path]].ts`)

- `POST /v1/systemone`, `GET /v1/models` のみ許可。他は 404。
- `X-TypeSafe-Key` が無ければ 401 (JSON `{ error: "missing_api_key" }`)。
- 上流へ: メソッド、`Content-Type`、ボディをそのまま。`Authorization: Bearer <key>`。
- 上流から: ステータス、`Content-Type`、ボディをそのまま。
- ログ出力なし。上流 URL は環境変数 `TYPESAFE_BASE_URL` で上書き可 (既定 `https://api.typesafe.ai`)。

## 9. テスト

- Vitest。
- engine: 役判定 (既知の順位ケース、同値・キッカー)、ベッティング遷移 (チェック一周、
  レイズ・リレイズ、オールインで街スキップ)、サイドポット分配、リバイ、`legalActions` の正しさ、
  シード再現性。import グラフ検査 (engine が react/dom/jev を import しない)。
- jev: 状態圧縮の出力スナップショット、非合法選択肢の除去、確率→アクションのサンプリング
  (シード固定)、額のクランプ、失敗時フェイルオープン。
- functions: `fetch` モックでヘッダ載せ替え・401・404 を検証。
- ui: Setup→Table のスモーク (Testing Library)。
- CI では Jev の実呼び出しをしない。

## 10. デプロイ・運用

- Cloudflare Pages: ビルド `pnpm build`、出力 `dist/`、Functions は `functions/` を自動検出。
- ローカル: `pnpm dev` は Vite のみ (Jev 呼び出しは失敗する)。Functions 込みは
  `pnpm dev:pages` (= `wrangler pages dev`) で起動する。
- GitHub Actions: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
- README: 概要、デモ手順、キーの取得と扱い、アーキテクチャ図、貢献方法 (英日併記)。

## 11. 将来拡張 (実装しないが壊さない)

- トーナメント: `BlindSchedule` の時間/ハンド数ベース実装と、リバイの代わりに離脱処理。
- Jev 質問セットのバージョニング (`questions/v1.ts` として置き、`DecisionRecord` に版を記録)。
