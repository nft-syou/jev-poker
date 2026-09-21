# ベンチマーク (`bench/`)

> **In short (English):** `pnpm bench` plays Jev against three baseline agents
> (`random`, `caller`, `rules`) in heads-up and 6-max, using mirrored hands (the
> same deck is replayed with Jev in every seat) to cut variance. Results are
> written as JSON to `bench/results/` and rendered as a Markdown table on stdout;
> `pnpm bench:report` re-renders the latest result per matchup. The real backend
> needs `TYPESAFE_API_KEY`; CI only ever runs `--backend mock`.

## 実行方法

```bash
export TYPESAFE_API_KEY=...        # --backend typesafe に必須 (無ければ 1 ハンドも回さず終了)
pnpm bench                         # 既定: 3 相手 × 2 形式 = 6 マッチ
pnpm bench --opponent rules --format hu --seeds 100
pnpm bench --backend mock --seeds 3 --opponent rules --format hu   # API を使わない動作確認
pnpm bench --help
```

`TYPESAFE_BASE_URL` は SDK の既定どおり環境変数で上書きできる (Pages Functions は経由しない)。

実行には Node 24 と pnpm が必要 (リポジトリ全体と同じ)。

### オプション

| オプション | 値 | 既定 | 説明 |
| --- | --- | --- | --- |
| `--opponent` | `random` / `caller` / `rules` / `all` | `all` | 対戦相手 (対照群) |
| `--format` | `hu` / `6max` / `all` | `all` | テーブル形式 |
| `--seeds` | 正の整数 | `100` | 独立デッキ数。ハンド数 = シード数 × 席数 |
| `--persona` | 人格 ID (`rock` / `tag` / `lag` / `maniac` / `station`) | `tag` | Jev の人格 |
| `--backend` | `typesafe` / `mock` | `typesafe` | `mock` は API を呼ばず決定論的に答える |
| `--concurrency` | 正の整数 | `4` | 同時に進めるハンド数 |
| `--base-seed` | 正の整数 | `1` | デッキ生成の基準シード。同じ値なら同じ配牌 |
| `--label` | 任意の文字列 | なし | 結果ファイル名に挟むタグ。マッチ名は常に残るので、全マッチ共通のラベルでも衝突しない |
| `--model` | モデル名 | SDK の既定 | SDK に渡す model |

`--flag value` と `--flag=value` のどちらでも書ける。未知のフラグ、不正な値、0 以下の
整数はいずれも起動時にエラー終了する (終了コード 1)。

## コスト見積 (spec §9)

| 設定 | ハンド数 | API 呼び出し数の目安 |
| --- | --- | --- |
| HU 100 シード | 200 ハンド | 1 ハンド 2〜4 判断 → 400〜800 |
| 6-max 100 シード | 600 ハンド | Jev は 1 席なので 1 ハンド 1〜3 判断 → 600〜1,800 |
| `--opponent all --format all` (既定) | (200 + 600) × 3 相手 = 2,400 ハンド | 合計 3,000〜8,000 |

1 呼び出し 1〜2 秒、`--concurrency 4` で既定の全マッチはおよそ **20〜70 分**。
まず `--seeds 5` 程度で試してから本番の規模を決めるとよい。`--backend mock` の呼び出し数は 0。

## 表の読み方

```
| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 | コード | 条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| random | HU | tag | 100 | 200 | +45.2 | [+30.1, +60.3] | 42% | 28% | 0 | 1.3s | 7afd6d1 | base 1 |
```

| 列 | 意味 |
| --- | --- |
| 相手 | 対照群エージェント。先頭に `⚠` が付いていれば途中終了 (`partial`) の結果 |
| 形式 | `HU` (2 人) または `6-max` (6 人) |
| 人格 | Jev の人格 ID |
| N (群) | **統計の標本数**。1 シード = 1 群で、同じデッキのミラーハンドをまとめて 1 標本として扱う。全ローテーションが揃った群だけを数え、中断で欠けた群は bb/100 と CI から除外する。`30` 未満のときは `(N が小さい)` が付き、数字を真に受けてはいけない目印になる |
| ハンド | 実際にプレイしたハンド数 (= N × 席数) |
| bb/100 | 100 ハンドあたりの収支 (bb)。符号付き小数 1 桁 |
| 95% CI | bb/100 の 95% 信頼区間。0 をまたいでいれば「勝ち越しとは言えない」。完全な群が 2 つ未満なら `n/a` (区間を推定できない) |
| VPIP | Jev が自発的にチップを入れたハンドの割合 |
| PFR | Jev がプリフロップでレイズしたハンドの割合 |
| 失敗 | バックエンド呼び出しが失敗してフォールバック (fail-open) した判断の数 |
| 平均応答 | 1 判断あたりの平均応答時間 (秒) |
| コード | 実行時の git コミット。コードが違えば別の実験として別の行になる |
| 条件 | `base <N>` はシード集合 (`--base-seed`)、`split` は分割プロンプト形式、`mock` はモックバックエンド、モデル名は `--model` 指定時 |

`pnpm bench:report` は相手・形式・人格・バックエンド・モデル・プロンプト形式・シード数・ベースシード・コードが
すべて同じ結果の中で最新の 1 件だけを残す (再実行は置き換え、別の実験は並べて表示)。集計値は毎回
生のハンド記録から計算し直すので、統計コードの修正は古いファイルにも反映される。

### Slumbot との対戦 (`pnpm bench:slumbot`)

本格的なポーカー AI である [Slumbot](https://www.slumbot.com/) (CFR 系、ACPC 複数回優勝) の公開 API と
ヘッズアップで対戦する。ゲームは Slumbot 側の固定仕様 (ブラインド 50/100、**200bb スタック**、毎ハンドリセット)。
配牌はサーバー側なのでミラーハンドは使えず、CI は独立したハンドに対して計算する (1 ハンドの標準偏差は約 10bb、
±20 bb/100 の精度に約 1 万ハンド必要)。

```sh
TYPESAFE_API_KEY=... pnpm bench:slumbot --hero jev --persona tag --hands 2000 --sessions 4
pnpm bench:slumbot --hero heuristic --hands 2000 --sessions 2   # API キー不要
pnpm bench:slumbot:report                                       # 同じ構成の結果ファイルをまとめて集計
```

- `--hero` は `jev` / `heuristic` / `rules` / `caller` / `random`。結果は `bench/results-slumbot/` に保存される。
- **他人のサーバーなので `--sessions` は小さく保つこと** (同時接続の合計で 8 程度まで)。2,000 ハンドで約 8〜20 分。
- 長時間の計測は 2,000 ハンドずつに分けて回すと、途中で止まっても結果が残る。

### 実験用オプション

既定のエージェントは変えずに、案を同じシードで比較するためのオプション。どれも既定では無効で、
`bench/EXPERIMENTS.md` に計測結果がある (いずれも既定を上回らなかった)。

| オプション | 内容 |
| --- | --- |
| `--variance X` | 人格の variance を上書き (0 = 常に最尤の行動) |
| `--prompt split` | プリフロップ用とポストフロップ用で、タスク文・指針・サイズの選択肢を分ける |
| `--range-equity` | 相手のこのハンドの行動から推定したレンジに対するエクイティ `equityVsRangePct` を状態に足す |
| `--preflop chart` | プリフロップは位置別チャート (コード) で決め、Jev にはポストフロップだけ聞く。6-max の API 呼び出しが約 85% 減る |
| `--route lolipop` | TypeSafe の API ではなくロリポップ！AIゲートウェイ (`https://ai-gateway.lolipop.jp`、モデル `typesafe/jev-latest`) 経由で Jev を呼ぶ。キーは環境変数 `LOLIPOP_API_KEY` (既定の `typesafe` は `TYPESAFE_API_KEY`)。`pnpm bench:slumbot` でも使える |
| `--opponent mixed` / `mixed-jev` | 傾向の違うプレイヤーが混ざった 6-max 卓。`mixed` は rules / caller / random / heuristic / rules、`mixed-jev` は rock / lag / maniac / station / tag の Jev CPU。席が変わっても同じ人物として扱う |
| `--profile [numbers|label|jev-label]` | マッチ内で蓄積した相手ごとの傾向を状態に足す。`numbers` (既定) は参加率・レイズ率・ポストフロップの攻撃頻度・ベットに降りる率、`label` はコードの閾値で決めたタイプ名と対策の一言、`jev-label` は同じタイプを Jev に別呼び出しで判定させる (exp10) |
| `--profile-window N` | 相手ごとに直近 N ハンドだけを覚える (既定はマッチ全体) |
| `--hero heuristic` | 計測席に Jev ではなく「Jev と同じ特徴量だけを読む固定ルール」を座らせる (API 不要)。分類器が何を上乗せしているかの物差し |
| `--model <名前>` | SDK に渡すモデル。2026-09-21 時点で `jev-latest` と `jev-preview` はどちらも `jev-1.13.0` として応答する |

**チューニングと確認でシードを分ける**: 改善の試行錯誤は `--base-seed 1` で行い、結論を出すときは
一度も使っていないベースシード (例: `--base-seed 100001`) で方策を変えずに測り直す。同じシードで
何度も選んだ結果の CI は選択バイアスを含む。

**必要なシード数の目安**: 6-max は 1,000 シード (6,000 ハンド) で CI がおよそ ±12〜16、HU も 1,000 シード
(2,000 ハンド) で ±15〜20。HU の 100 シードは、プリフロップのオールインが 1 回入るだけで結果が 60 bb/100
動くので、結論には使わない。変更の効果は、同じシードで新旧を回して**シード群ごとの差**の CI で判定する
(Jev の応答は非決定的だが、配牌が対応しているので対比較は有効)。

**なぜミラーハンドか**: ポーカーの分散は大きく、素のハンドごとの収支を平均すると
100 ハンド程度では配牌の運に埋もれてしまう。そこで同じデッキを席を入れ替えて
席数ぶん繰り返し、その平均を 1 標本 (群) とする。配牌の運が相殺され、信頼区間が
大きく縮む。**CI の計算に使う N はハンド数ではなく群の数**なので、表では別列にしている。

## 結果 JSON

- 置き場所: `bench/results/<startedAt>-<opponent>-<format>.json` (例
  `2026-09-19T10-00-00-000Z-random-hu.json`)。1 マッチ 1 ファイル。`--label smoke` を
  付けた場合は `<startedAt>-smoke-<opponent>-<format>.json` (例
  `2026-09-19T10-00-00-000Z-smoke-random-hu.json`) になり、**マッチ名は常に残る**ので
  `--opponent all` でもファイル名が衝突しない。
- 書き込みは `<file>.tmp` に出してから `rename` する (アトミック)。途中で落ちても
  壊れかけの JSON が残ることはない。
- 中身は `BenchResult` (spec §6.2): `config` (相手・形式・シード・人格・バックエンド・
  `sdkVersion`・`gitCommit` など)、`summary`、そして全ハンドの記録 `hands` (Jev の
  判断ログ `decisions` を含む)。
- `partial: true` は **そのマッチを最後まで回しきれなかった** ことを示す (Ctrl-C で中断した
  場合)。表では 相手 列に `⚠` が付く。標本が予定より少ないので、比較にそのまま使わない。
- `hands[].wentToShowdown` は**卓が**ショーダウンに行ったか (Jev が降りた後でも true になる)。
  `hands[].jevAtShowdown` は **Jev 自身が**ショーダウンまで残ったか。古い結果ファイルにはこの項目が
  無く、その場合は「卓がショーダウンし、かつ Jev が一度もフォールドしていない」で補う。
- `hands[].jevWonShowdown`: Jev 自身がショーダウンまで行ったハンドで **Jev がそのハンドを勝ち越したか**
  (`net[jevSeat] > 0`)。ポットを分け合った (チョップ) 場合やサイドポットだけ取った場合は
  `false` になる。Jev がショーダウンに行かなかったハンドは `null`。`summary.jev.showdowns` は
  Jev 自身のショーダウン数、`summary.jev.showdownWinRate` はその中で勝ち越した割合。
- 結果ファイルはコミットしてよい (履歴として残す)。

### 再表示

```bash
pnpm bench:report                              # results/ 内の全 JSON
pnpm bench:report bench/results/a.json b.json  # ファイル指定
```

> **Windows PowerShell**: PowerShell はグロブ (`bench/results/*.json`) を展開しないので、
> ワイルドカードをそのまま渡しても動かない。引数なしの形 (`pnpm bench:report`) を使うか、
> `pnpm bench:report (Get-ChildItem bench/results/*.json).FullName` のように展開して渡す。

同じ (相手, 形式, 人格) の組み合わせが複数あるときは `finishedAt` が最新のものだけを表にする。

## Ctrl-C の挙動

- **1 回目**: 新しいハンドの開始を止め、実行中のハンドだけ待ってから、そこまでの結果を
  `partial: true` で JSON に書き出して終了する。以降のマッチは実行しない。
- **2 回目**: その場で即座に終了する (終了コード 130)。実行中だったマッチの JSON は
  **書き出されない** (ファイルごと存在しない)。書き込みは一時ファイル + `rename` なので、
  中途半端に切り詰められたファイルが残ることはない。それ以前のマッチのファイルは無事。

## バックエンドが壊れているとき (fail-fast)

Jev の呼び出しが失敗した判断は **fail-open** する (安全側の行動にフォールバックして続行し、
`decisions[].error` と `summary.jev.failOpen` に記録される)。ただし壊れたバックエンドで
全ハンドを回しても測れるのはフォールバックの強さだけなので、次のようにしている。

- **1 件目の fail-open で** `warning: Jev decision failed open: <error>` を標準エラーに出す
  (マッチごとに 1 回だけ)。
- **そのマッチの最初の 10 判断がすべて失敗していたら**、そこでマッチを中断してエラー終了する
  (`Jev backend failing on every decision (first 10): <error>`)。残りのハンドは開始しない。
  API キーやモデル名の間違いで全額を無駄にしないための歯止め。
- 表を出したあと、`failOpen > 0` のマッチごとに件数の警告を標準エラーに出す。

## CI

CI では `--backend typesafe` を実行しない (API キーもコストも要らない `--backend mock`
のみ)。`mock` はハンド強度から決定論的に確率を作るので、配線の回帰テストには使えるが
Jev の強さの指標にはならない。

## リポジトリ直下の README

直下 `README.md` の「ベンチマーク」節の表は、`pnpm bench:report` の出力を**手で貼る**。
自動生成はしない。
