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
| `--label` | 任意の文字列 | `<opponent>-<format>` | 結果ファイル名の末尾 |
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
| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| random | HU | tag | 100 | 200 | +45.2 | [+30.1, +60.3] | 42% | 28% | 0 | 1.3s |
```

| 列 | 意味 |
| --- | --- |
| 相手 | 対照群エージェント。先頭に `⚠` が付いていれば途中終了 (`partial`) の結果 |
| 形式 | `HU` (2 人) または `6-max` (6 人) |
| 人格 | Jev の人格 ID |
| N (群) | **統計の標本数**。1 シード = 1 群で、同じデッキのミラーハンドをまとめて 1 標本として扱う。`30` 未満のときは `(N が小さい)` が付き、数字を真に受けてはいけない目印になる |
| ハンド | 実際にプレイしたハンド数 (= N × 席数) |
| bb/100 | 100 ハンドあたりの収支 (bb)。符号付き小数 1 桁 |
| 95% CI | bb/100 の 95% 信頼区間。0 をまたいでいれば「勝ち越しとは言えない」 |
| VPIP | Jev が自発的にチップを入れたハンドの割合 |
| PFR | Jev がプリフロップでレイズしたハンドの割合 |
| 失敗 | バックエンド呼び出しが失敗してフォールバック (fail-open) した判断の数 |
| 平均応答 | 1 判断あたりの平均応答時間 (秒) |

**なぜミラーハンドか**: ポーカーの分散は大きく、素のハンドごとの収支を平均すると
100 ハンド程度では配牌の運に埋もれてしまう。そこで同じデッキを席を入れ替えて
席数ぶん繰り返し、その平均を 1 標本 (群) とする。配牌の運が相殺され、信頼区間が
大きく縮む。**CI の計算に使う N はハンド数ではなく群の数**なので、表では別列にしている。

## 結果 JSON

- 置き場所: `bench/results/<startedAt>-<label>.json` (例
  `2026-09-19T10-00-00-000Z-random-hu.json`)。1 マッチ 1 ファイル。
- 中身は `BenchResult` (spec §6.2): `config` (相手・形式・シード・人格・バックエンド・
  `sdkVersion`・`gitCommit` など)、`summary`、そして全ハンドの記録 `hands` (Jev の
  判断ログ `decisions` を含む)。
- `partial: true` は **そのマッチを最後まで回しきれなかった** ことを示す (Ctrl-C で中断した
  場合)。表では 相手 列に `⚠` が付く。標本が予定より少ないので、比較にそのまま使わない。
- `hands[].jevWonShowdown`: ショーダウンまで行ったハンドで **Jev がそのハンドを勝ち越したか**
  (`net[jevSeat] > 0`)。ポットを分け合った (チョップ) 場合やサイドポットだけ取った場合は
  `false` になる。ショーダウンに行かなかったハンドは `null`。`summary.jev.showdownWinRate`
  はこの割合。
- 結果ファイルはコミットしてよい (履歴として残す)。

### 再表示

```bash
pnpm bench:report                              # results/ 内の全 JSON
pnpm bench:report bench/results/a.json b.json  # ファイル指定
```

同じ (相手, 形式, 人格) の組み合わせが複数あるときは `finishedAt` が最新のものだけを表にする。

## Ctrl-C の挙動

- **1 回目**: 新しいハンドの開始を止め、実行中のハンドだけ待ってから、そこまでの結果を
  `partial: true` で JSON に書き出して終了する。以降のマッチは実行しない。
- **2 回目**: 即座に終了する (終了コード 130)。書き出しは行われない。

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
