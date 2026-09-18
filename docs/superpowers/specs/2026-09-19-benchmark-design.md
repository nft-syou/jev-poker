# jev-poker ベンチマーク 設計書 / Benchmark Design Spec

日付: 2026-09-19
状態: 設計承認済み (セクション 1 はユーザー承認、2 以降はセルフレビュー)
前提: `2026-09-19-jev-poker-design.md` (以下「メイン spec」)

## 1. 目的

Jev で作る CPU プレイヤーが、古典的な対照群 CPU (ランダム / 常にコール / ルールベース)
より強いかを、統計的に言える形で測る。結果は README に「実績表」として載せる。

対照群を TS で自前実装する理由: 6-max NLHE をブラウザ/Node から直接呼べる「強い OSS
ボット」は事実上存在しない (Slumbot、Pluribus 再現は Python/C++ でヘッズアップ限定か
学習が必要)。ランダム / 常にコール / ルールベースの 3 段階は、JsPoker の
TimidBot・UnpredictableBot、PyPokerEngine の FishPlayer と同じ定番の対照群である。

### 非目標 (YAGNI)

- 外部ボット (Slumbot API、Python エンジン) との対戦。
- ブラウザ UI からのベンチマーク実行 (CLI のみ)。
- README の自動更新 (手動で貼る)。
- 全人格 × 全対照群の総当たりの自動化 (CLI オプションで 1 組ずつ回せれば十分)。

## 2. 決定事項

| 項目 | 決定 |
| --- | --- |
| 対照群 | `random` / `caller` / `rules` の 3 種を `src/agents/` に TS で実装 |
| 実行環境 | Node の CLI (`pnpm bench`)。`tsx` で実行。本物の TypeSafe API を SDK から直接叩く |
| 対戦形式 | ヘッズアップ (Jev vs 各対照群) と 6-max (Jev 1 席 + 同種対照群 5 席) の両方 |
| Jev 側人格 | 既定 `tag`。`--persona` で差し替え |
| 指標 | bb/100 と 95% 信頼区間。ミラーハンド (同一配牌で席を入れ替え) で分散削減 |
| 出力 | `bench/results/<日時>-<ラベル>.json` + 標準出力に Markdown 表。`pnpm bench:report` で再集計 |
| README | 最新の集計表を手動で貼る。結果 JSON はコミットする |
| 実装順 | engine → agents (対照群) → jev (JevAgent + mock) → bench |

## 3. `Agent` インターフェースと対照群 (`src/agents/`)

### 3.1 インターフェース

```ts
interface PlayerView {              // engine が公開する、その席から見える情報だけ
  seat: SeatId; street: Street;
  holeCards: Card[]; board: Card[];
  stacks: { seat: SeatId; stack: number; isAllIn: boolean; folded: boolean }[];
  pot: number; toCall: number; bigBlind: number;
  position: 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'CO';
  history: { street: Street; seat: SeatId; action: Action }[];   // 今ハンドのみ
}

interface Agent {
  readonly id: string;              // 'random' | 'caller' | 'rules' | 'jev:<personaId>'
  decide(view: PlayerView, legal: LegalActions): Promise<Action>;
}
```

- 返す `Action` は必ず `legal` の範囲内。engine の `act` が投げたらボットのバグ (テストで検証)。
- 乱数は `Agent` 生成時に `seed` を受け取り、engine と同じ xorshift PRNG を使う。
- 相手のホールカードは `PlayerView` に含まれない。`JevAgent` (メイン spec §5) も
  この `PlayerView` から状態を圧縮する。
- `position` はヘッズアップでは `BTN` (= SB) と `BB`。3〜6 人では
  BTN / SB / BB / UTG / MP / CO を人数に応じて割り当てる (engine の責務)。

### 3.2 対照群 3 種

| id | 戦略 |
| --- | --- |
| `random` | 合法な `fold` / `check or call` / `bet or raise` から一様に選ぶ。額は `{min, ポット半分, ポット, オールイン}` から一様に選びクランプ |
| `caller` | 常に `check` か `call`。フォールドもレイズもしない |
| `rules` | 下記 |

`rules` の戦略:

- プリフロップ: `preflopStrength` (169 ハンド表) で判定。
  - `premium` / `strong`: 誰もレイズしていなければ 3bb にレイズ。レイズされていれば
    相手のレイズ額の 3 倍にリレイズ (クランプ)。
  - `medium`: レイズされていなければコール (BB でチェック可ならチェック)。
    レイズされていればフォールド。
  - `weak` / `trash`: チェック可ならチェック、それ以外はフォールド。
- ポストフロップ: `madeHand` と `draws` で判定。
  - 2 ペア以上: ポットの 2/3 をベット。ベットされていればポットの 2/3 相当までレイズ。
  - 1 ペア: チェック可ならチェック。コール額がポットの 1/3 以下ならコール、それ以外はフォールド。
  - ドローあり (フラッシュドロー、オープンエンド、ガットショット): チェック可ならチェック。
    コール額がポットの 1/4 以下ならコール、それ以外はフォールド。
  - それ以外: チェック可ならチェック、それ以外はフォールド。
- ハンド評価関数 (`preflopStrength`, `madeHand`, `draws`, `position`) は
  `src/engine/evaluate.ts` と `src/engine/strength.ts` に置き、Jev の状態圧縮と共用する。

3 種とも決定論的 (`seed` 固定で同じ入力 → 同じ出力)。

### 3.3 メイン spec への追記

- §5 の Jev エージェントは `Agent` を実装する (`JevAgent` クラス)。
- §7 の `Setup` 画面で席の CPU 種別に `jev` のほか `random` / `caller` / `rules` を選べる
  (キー無しで動く CPU として)。

## 4. ベンチマーク実行モデル (`bench/`)

### 4.1 独立ハンド

- 各ハンドは独立に回す。ハンドごとに `Table` を新規作成し、全席のスタックを
  `100 bb` にリセットする (キャッシュゲームのリバイ機構は使わない)。
- ブラインドは SB 0.5 / BB 1、アンティ 0。チップ単位は bb の 1/100 に固定
  (engine には整数 50 / 100 を渡す)。
- ハンドの配牌は `seed = hash(baseSeed, seedIndex)` で決まる。同じ `seedIndex` なら
  同じデッキ順。

### 4.2 ミラーハンドと席ローテーション

- 1 つの `seedIndex` に対し、席の割り当てを全通り回し、そのグループを 1 単位として集計する。
  - ヘッズアップ: 2 通り (Jev が席 0 / 席 1)。
  - 6-max: 6 通り (Jev が席 0..5。対照群は残りの席)。
- ボタンは常に席 0。Jev の席を回すことで、Jev はどのポジションも同じ回数経験する。
- 対照群のエージェントの `seed` は `hash(baseSeed, seedIndex, seatIndex)` で固定し、
  ローテーション間で相手の挙動が同じ配牌に対して同じになるようにする
  (Jev の応答は非決定的なので完全な鏡像にはならないが、カード運は打ち消される)。

### 4.3 実行

- `--seeds N` で `seedIndex = 0..N-1`。総ハンド数はヘッズアップ `2N`、6-max `6N`。
- 同時実行数 `--concurrency` (既定 4)。ハンド単位で並列化する (自前の小さなセマフォ。
  依存追加なし)。Jev の同時呼び出し数はハンド数と同じ (1 ハンドに Jev は 1 席)。
- 1 ハンドの進行:
  1. `Table` を作り `startHand()`。
  2. 手番の席の `Agent.decide(view, legal)` を待ち、`hand.act()`。
  3. `HandEnded` まで繰り返す。各席の「終了時スタック − 100bb」を収支とする。
- Jev の判断ごとに `DecisionRecord` (確率分布、ブラフ意図、応答 ms、エラー) を記録する。
- Jev 側がフェイルオープン (メイン spec §5.5) した場合もハンドは続行し、回数を数える。
- 中断 (Ctrl-C) 時は、そこまでの結果で JSON を書いて終了する (`partial: true`)。

## 5. 統計 (`bench/stats.ts`)

- 集計単位は「seedIndex ごとのローテーション群」。群内の Jev の収支を合計し、
  ハンド数で割って 1 ハンドあたりの bb 収支 `x_i` を出す。
- `bb/100 = mean(x_i) × 100`。
- 95% 信頼区間 = `mean ± 1.96 × sd(x_i) / sqrt(N) × 100`。N ≥ 30 を想定し正規近似。
  N < 30 のときは表に「(N が小さい)」と注記する。
- 補助指標 (Jev の席のみ):
  - `decisions`: 判断回数、`apiCalls`: 実 API 呼び出し数、`failOpen`: フェイルオープン回数。
  - `latencyMs`: 応答時間の平均 / p50 / p95。
  - `vpip`: プリフロップで自発的にチップを入れたハンドの割合、`pfr`: プリフロップでレイズした割合。
  - `showdownWinRate`: ショーダウンに到達したハンドの勝率。
- 対照群の席も収支 / vpip / pfr を出す (6-max では 5 席の合計と平均)。

## 6. CLI と出力

### 6.1 コマンド

```
pnpm bench [options]
  --opponent random|caller|rules|all      既定 all
  --format hu|6max|all                    既定 all
  --seeds N                               既定 100
  --persona <id>                          既定 tag
  --backend typesafe|mock                 既定 typesafe
  --concurrency N                         既定 4
  --base-seed N                           既定 1
  --label <text>                          結果ファイル名に付く。既定 "<opponent>-<format>"
  --model <name>                          SDK に渡す model。既定は SDK の既定 (jev-latest)

pnpm bench:report [bench/results/*.json ...]   既定は results/ 内の全ファイル
```

- `--backend typesafe` は環境変数 `TYPESAFE_API_KEY` を要求。無ければ起動時にエラー終了
  (ハンドを 1 つも回さない)。
- `TYPESAFE_BASE_URL` は SDK の既定どおり環境変数で上書き可。Pages Functions は経由しない。
- `--opponent all --format all` は 3 × 2 = 6 マッチを順に回し、6 ファイルを書く。

### 6.2 結果 JSON (`bench/results/<ISO日時>-<label>.json`)

```ts
interface BenchResult {
  version: 1;
  startedAt: string; finishedAt: string; partial: boolean;
  config: { opponent, format, seeds, persona, backend, model, baseSeed, concurrency, sdkVersion, gitCommit };
  summary: {
    jev: { bb100, ci95: [lo, hi], n, hands, decisions, apiCalls, failOpen,
           latencyMs: { mean, p50, p95 }, vpip, pfr, showdownWinRate };
    opponent: { bb100PerSeat, vpip, pfr };
  };
  hands: {
    seedIndex: number; rotation: number; jevSeat: SeatId;
    net: number[];                          // 席ごとの収支 (bb)
    wentToShowdown: boolean;
    decisions: DecisionRecord[];            // Jev の席のみ
  }[];
}
```

`DecisionRecord` はメイン spec §5.4 のものに `latencyMs` と `street` を足したもの。

### 6.3 Markdown 表 (標準出力と `bench:report`)

```
| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| random | HU | tag | 100 | 200 | +45.2 | [+30.1, +60.3] | 42% | 28% | 0 | 1.3s |
```

`bench:report` は複数 JSON を読み、同じ (相手, 形式, 人格) の最新ファイルだけを表にする。

### 6.4 README

`bench/README.md` に実行方法、コスト目安 (呼び出し回数の見積式)、表の読み方を書く。
リポジトリ直下の README には「ベンチマーク」節を設け、最新の表を手動で貼る。

## 7. Jev バックエンド (bench から見た差分)

- `JevAgent` はメイン spec §5 のとおり。バックエンド `typesafe` は
  `new TypeSafeClient({ apiKey, defaultModel })` を Node で直接生成する
  (`dangerouslyAllowBrowser` 不要、`baseURL` 上書き不要)。
- `mock` バックエンドはハンド強度から決定論的に確率を作る (メイン spec §5.6)。
  bench の配線テストと CI 用。`--backend mock` では API 呼び出し数は 0 として記録。
- SDK のリトライ既定 (2 回、429/5xx) をそのまま使う。1 判断のタイムアウトは 10 秒。

## 8. テスト (Vitest)

- agents: 3 種とも、ランダムに生成した多数の `(view, legal)` に対して返す `Action` が
  合法であること。`seed` 固定で同じ出力。`rules` の各分岐の代表ケース。
- bench/runner: `mock` バックエンドで HU / 6-max をそれぞれ数シード回し、
  ハンド数、ローテーション数、席の収支の合計が 0 (ゼロサム) であること。
  Ctrl-C 相当の中断で `partial: true` の結果が返ること。
- bench/stats: 既知の系列で bb/100 と CI、p50/p95、vpip/pfr が手計算と一致すること。
- bench/report: JSON → Markdown 表のスナップショット。同一マッチの最新ファイル選択。
- CI では `--backend typesafe` を実行しない。

## 9. 実行コストの目安

- ヘッズアップ 100 シード = 200 ハンド。Jev は 1 ハンドに約 2〜4 判断 → 400〜800 呼び出し。
- 6-max 100 シード = 600 ハンド。Jev は 1 席なので 1 ハンド 1〜3 判断 → 600〜1,800 呼び出し。
- `--opponent all --format all` の既定は合計 3,000〜8,000 呼び出し。
  1 呼び出し 1〜2 秒、同時 4 で 20〜70 分。

## 10. 将来拡張 (実装しないが壊さない)

- 対戦カードの追加 (`bench/matchups.ts` に定義を足すだけ)。
- 人格総当たり (`--persona all`)。
- Slumbot API アダプタ (`Agent` を実装すればよい)。
