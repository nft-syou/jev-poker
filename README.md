# jev-poker

**EN:** A No-Limit Texas Hold'em game where CPU players decide their actions with TypeSafe
Jev (`systemOne`), plus a benchmark that measures how the Jev CPU performs against classic
baseline bots.

**JA:** TypeSafe Jev (`systemOne`) が CPU プレイヤーの意思決定を行う、ノーリミット・
テキサスホールデムです。あわせて、Jev CPU が古典的なベースラインボットに対してどれだけ
強いかを測るベンチマークを備えています。

## Status / ステータス

**EN:** Implemented: the game engine (`src/engine`), the baseline agents (`src/agents`:
`random` / `caller` / `rules`), the Jev agent (`src/jev`, with TypeSafe and mock backends),
and the benchmark CLI (`bench/`). Not yet implemented: the browser UI (`src/ui`), i18n, and
the Cloudflare Pages Functions proxy.

See the design specs for details:
[main design spec](docs/superpowers/specs/2026-09-19-jev-poker-design.md),
[benchmark design spec](docs/superpowers/specs/2026-09-19-benchmark-design.md).

**JA:** 実装済み: ゲームエンジン (`src/engine`)、ベースラインエージェント (`src/agents`:
`random` / `caller` / `rules`)、Jev エージェント (`src/jev`、TypeSafe / mock バックエンド)、
ベンチマーク CLI (`bench/`)。未実装: ブラウザ UI (`src/ui`)、i18n、Cloudflare Pages
Functions プロキシ。

設計書: [メイン設計書](docs/superpowers/specs/2026-09-19-jev-poker-design.md)、
[ベンチマーク設計書](docs/superpowers/specs/2026-09-19-benchmark-design.md)。

## Getting Started / はじめに

**EN:**

- Node 20+ (developed on 24)
- `pnpm install`
- `pnpm test`
- `pnpm typecheck`

**JA:**

- Node 20+ (開発は 24 で実施)
- `pnpm install`
- `pnpm test`
- `pnpm typecheck`

## Benchmark / ベンチマーク

**EN:** The benchmark measures bb/100 with a 95% confidence interval. Hands are mirrored
across seat rotations (the same deals are replayed with the Jev seat rotated) to reduce
variance from card luck. It runs both heads-up and 6-max matches with the Jev agent against
each baseline (`random` / `caller` / `rules`).

Run it with a real TypeSafe API key:

```sh
TYPESAFE_API_KEY=... pnpm bench --opponent all --format all --seeds 100
```

Use `--backend mock` for a dry run that exercises the full pipeline without any API key or
cost:

```sh
pnpm bench --opponent all --format all --seeds 100 --backend mock
```

After one or more runs, re-aggregate the saved results into a table with:

```sh
pnpm bench:report
```

Results are saved as `bench/results/<startedAt>-<opponent>-<format>.json`, with `--label`
inserted before the matchup when given. On Windows PowerShell, note that the shell does not
expand globs such as `bench/results/*.json`: use the no-argument form above, or pass explicit
paths (`pnpm bench:report (Get-ChildItem bench/results/*.json).FullName`).

As a rough estimate (see benchmark spec §9), `--opponent all --format all` with the default
100 seeds makes on the order of 3,000–8,000 Jev calls; at roughly 1–2 seconds per call and
concurrency 4, a full run takes on the order of 20–70 minutes. Actual cost and time depend on
the TypeSafe plan and network conditions.

See [`bench/README.md`](bench/README.md) for the full CLI reference and result format.

**JA:** ベンチマークは bb/100 と 95% 信頼区間を測定します。同一配牌で席を入れ替える
「ミラーハンド」でカード運による分散を減らし、ヘッズアップと 6-max の両方で Jev エージェント
を各ベースライン (`random` / `caller` / `rules`) と対戦させます。

実際の TypeSafe API キーで実行する場合:

```sh
TYPESAFE_API_KEY=... pnpm bench --opponent all --format all --seeds 100
```

API キーやコストなしで一通り動作確認したい場合は `--backend mock` を使います:

```sh
pnpm bench --opponent all --format all --seeds 100 --backend mock
```

実行後、保存済みの結果をまとめて表にするには:

```sh
pnpm bench:report
```

結果は `bench/results/<startedAt>-<opponent>-<format>.json` に保存される (`--label` を
付けるとマッチ名の前に挟まる)。Windows PowerShell では `bench/results/*.json` のような
グロブがシェルで展開されないので、引数なしの形を使うか、明示的なパスを渡すこと
(`pnpm bench:report (Get-ChildItem bench/results/*.json).FullName`)。

目安として (ベンチマーク spec §9 参照)、既定の 100 シードで `--opponent all --format all`
を実行すると Jev の呼び出しはおよそ 3,000〜8,000 回になり、1 呼び出し 1〜2 秒・同時実行数 4
であれば全体でおよそ 20〜70 分かかる見積もりです。実際のコストと所要時間は TypeSafe の
プランやネットワーク状況によって変わります。

CLI の詳細な使い方と結果フォーマットは [`bench/README.md`](bench/README.md) を参照してください。

### 結果 / Results

最新の結果表はベンチマーク実行後にここへ手動で貼る (`pnpm bench:report` の出力)。

**Run: 2026-09-19** — model `jev-1.13.0`, SDK 0.6.0, all 5 presets, `--seeds 100 --concurrency 8`
(≈ 3,500 API calls and ≈ 90 s per persona, 0 fail-open). Raw data: [`bench/results/`](bench/results/).
Two code versions are shown: the first Jev agent (`2af5f01`) and the version after eight rounds of
improvement (`7afd6d1`, see [`bench/EXPERIMENTS.md`](bench/EXPERIMENTS.md)).

#### After improvements (`7afd6d1`) — persona × matchup, bb/100 / 改善後

| 人格 | random HU | random 6-max | caller HU | caller 6-max | rules HU | rules 6-max | VPIP | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock | +47.7 | +315.3 ✅ | +189.1 ✅ | +210.0 | +28.5 ✅ | -8.4 | 18% | 0 |
| tag | +161.9 | +445.9 ✅ | +340.0 ✅ | +1196.4 ✅ | +59.8 ✅ | +14.3 ✅ | 33% | 0 |
| lag | +152.8 | +352.9 ✅ | +245.7 ✅ | +1745.6 ✅ | +59.3 ✅ | +26.7 | 45% | 0 |
| maniac | +130.4 | -146.5 | +110.0 | +1206.3 ✅ | +57.3 ✅ | -25.1 | 68% | 0 |
| station | +434.5 | +588.6 ✅ | +170.8 ✅ | +801.8 ✅ | +57.4 ✅ | -9.9 | 49% | 0 |

#### Before improvements (`2af5f01`) / 改善前

| 人格 | random HU | random 6-max | caller HU | caller 6-max | rules HU | rules 6-max | VPIP | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock | +115.3 | +360.8 ✅ | +144.1 ✅ | +47.6 | -17.6 | -18.9 | 7% | 0 |
| tag | -41.6 | +404.2 ✅ | +405.1 ✅ | +984.8 ✅ | -9.0 | -40.0 | 13% | 0 |
| lag | +226.8 | +497.5 | +210.2 | +895.3 ✅ | -66.8 | -133.4 | 57% | 0 |
| maniac | +288.4 | -55.0 | +57.0 | -32.7 | -341.5 | -1230.5 ❌ | 85% | 0 |
| station | +59.9 | +284.1 | +0.0 | +0.0 | -122.1 ❌ | -731.8 ❌ | 73% | 0 |

✅ = 95% CI above zero / 95% CI が 0 より上, ❌ = 95% CI below zero / 95% CI が 0 より下. VPIP is averaged over the six matchups.

#### Full table for the current code (`pnpm bench:report`) / 現行コードの全結果

| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| random | HU | lag | 100 | 200 | +152.8 | [-200.2, +505.8] | 53% | 51% | 0 | 0.3s |
| random | HU | maniac | 100 | 200 | +130.4 | [-266.5, +527.3] | 61% | 57% | 0 | 0.3s |
| random | HU | rock | 100 | 200 | +47.7 | [-183.3, +278.7] | 28% | 27% | 0 | 0.3s |
| random | HU | station | 100 | 200 | +434.5 | [-17.9, +886.9] | 54% | 49% | 0 | 0.4s |
| random | HU | tag | 100 | 200 | +161.9 | [-133.5, +457.4] | 49% | 48% | 0 | 0.3s |
| random | 6-max | lag | 100 | 600 | +352.9 | [+0.6, +705.2] | 26% | 18% | 0 | 0.3s |
| random | 6-max | maniac | 100 | 600 | -146.5 | [-639.4, +346.4] | 59% | 48% | 0 | 0.3s |
| random | 6-max | rock | 100 | 600 | +315.3 | [+55.6, +575.1] | 6% | 3% | 0 | 0.3s |
| random | 6-max | station | 100 | 600 | +588.6 | [+67.5, +1109.8] | 35% | 6% | 0 | 0.4s |
| random | 6-max | tag | 100 | 600 | +445.9 | [+150.2, +741.5] | 11% | 9% | 0 | 0.3s |
| caller | HU | lag | 100 | 200 | +245.7 | [+14.5, +477.0] | 53% | 53% | 0 | 0.4s |
| caller | HU | maniac | 100 | 200 | +110.0 | [-266.5, +486.6] | 70% | 70% | 0 | 0.4s |
| caller | HU | rock | 100 | 200 | +189.1 | [+59.2, +319.0] | 25% | 25% | 0 | 0.4s |
| caller | HU | station | 100 | 200 | +170.8 | [+40.2, +301.5] | 49% | 49% | 0 | 0.4s |
| caller | HU | tag | 100 | 200 | +340.0 | [+143.9, +536.0] | 49% | 49% | 0 | 0.4s |
| caller | 6-max | lag | 100 | 600 | +1745.6 | [+999.2, +2492.0] | 44% | 29% | 0 | 0.4s |
| caller | 6-max | maniac | 100 | 600 | +1206.3 | [+605.8, +1806.9] | 86% | 79% | 0 | 0.4s |
| caller | 6-max | rock | 100 | 600 | +210.0 | [-28.3, +448.3] | 8% | 4% | 0 | 0.4s |
| caller | 6-max | station | 100 | 600 | +801.8 | [+400.9, +1202.8] | 62% | 4% | 0 | 0.4s |
| caller | 6-max | tag | 100 | 600 | +1196.4 | [+600.7, +1792.1] | 16% | 12% | 0 | 0.4s |
| rules | HU | lag | 100 | 200 | +59.3 | [+51.1, +67.4] | 49% | 49% | 0 | 0.3s |
| rules | HU | maniac | 100 | 200 | +57.3 | [+44.8, +69.7] | 54% | 53% | 0 | 0.3s |
| rules | HU | rock | 100 | 200 | +28.5 | [+20.3, +36.7] | 27% | 27% | 0 | 0.3s |
| rules | HU | station | 100 | 200 | +57.4 | [+48.8, +66.1] | 50% | 50% | 0 | 0.4s |
| rules | HU | tag | 100 | 200 | +59.8 | [+52.2, +67.3] | 50% | 50% | 0 | 0.3s |
| rules | 6-max | lag | 100 | 600 | +26.7 | [-12.5, +65.8] | 47% | 41% | 0 | 0.3s |
| rules | 6-max | maniac | 100 | 600 | -25.1 | [-82.8, +32.5] | 77% | 72% | 0 | 0.3s |
| rules | 6-max | rock | 100 | 600 | -8.4 | [-22.8, +6.0] | 13% | 9% | 0 | 0.3s |
| rules | 6-max | station | 100 | 600 | -9.9 | [-108.1, +88.3] | 43% | 21% | 0 | 0.3s |
| rules | 6-max | tag | 100 | 600 | +14.3 | [+7.1, +21.5] | 25% | 22% | 0 | 0.4s |

**EN:** After the improvements every persona beats the rule-based bot heads-up with the CI above
zero, and `tag` beats it in 6-max too: a dedicated 1,000-seed run (6,000 hands) gives **+19.0 bb/100,
95% CI [+3.1, +35.0]** (`bench/results/*final6max*`). Smaller runs swing by ±20 because single -100 bb
coolers dominate them. Because those runs shared seeds with the tuning experiments, the unchanged
agent was re-evaluated on seeds never used before (`--base-seed 100001`): **heads-up +60.6
[+52.9, +68.3], 6-max +16.3 [+3.1, +29.4]** over 1,000 seeds — the result holds on fresh data. The
improvements were all in what Jev is told — exact hand strength, equity vs. pot odds, whether its bet
was raised, pot commitment, blind-stealing spots — plus conventional preflop raise sizes; the engine
and the baselines are unchanged. Heads-up vs `random` remains inconclusive (random all-ins). `station`
vs `caller` was exactly 0.0 before the changes because neither side ever raised; now the station
persona raises occasionally.

**JA:** 改善後は、全人格がルールベースの `rules` にヘッズアップで有意に勝ち、`tag` は 6-max でも勝っています
(1,000 シード = 6,000 ハンドの専用 run で **+19.0 bb/100、95% CI [+3.1, +35.0]**。小さい run は -100bb のクーラー 1 回で ±20 揺れる)。
これらの run はチューニングと同じシードを含むため、方策を変えずに未使用シード (`--base-seed 100001`) で
再評価しました: **HU +60.6 [+52.9, +68.3]、6-max +16.3 [+3.1, +29.4]** (1,000 シード)。未使用データでも結論は変わりません。
改善はすべて「Jev に何を伝えるか」(正確なハンド強度、エクイティと必要エクイティ、自分のベットがレイズされたか、
ポットコミット、スティールの機会) とプリフロップの標準的なレイズ額で、エンジンと対照群は変えていません。
`random` とのヘッズアップは依然として結論が出ません (ランダムなオールイン)。

## Architecture / アーキテクチャ

**EN:**

| Path | Description |
| --- | --- |
| `src/engine` | Dependency-free No-Limit Hold'em engine: cards, hand evaluation, betting state machine, side pots. |
| `src/agents` | The `Agent` interface and the `random` / `caller` / `rules` baseline bots. |
| `src/jev` | `JevAgent`, which implements `Agent` using TypeSafe Jev (`systemOne`), plus a deterministic mock backend for tests. |
| `bench/` | The benchmark runner, statistics, and CLI that compare the Jev agent against the baselines. |

**API key handling:** the TypeSafe API key is read from the `TYPESAFE_API_KEY` environment
variable when running the benchmark. It stays local to your environment (an env var, never a
committed file) and is never sent anywhere other than the TypeSafe API.

**JA:**

| パス | 説明 |
| --- | --- |
| `src/engine` | 依存ゼロのノーリミット・ホールデムエンジン。カード、役判定、ベッティングの状態機械、サイドポット。 |
| `src/agents` | `Agent` インターフェースと `random` / `caller` / `rules` ベースラインボット。 |
| `src/jev` | TypeSafe Jev (`systemOne`) を使って `Agent` を実装する `JevAgent`、およびテスト用の決定論的な mock バックエンド。 |
| `bench/` | Jev エージェントを各ベースラインと比較するベンチマークのランナー・統計処理・CLI。 |

**API キーの扱い:** ベンチマーク実行時、TypeSafe API キーは環境変数 `TYPESAFE_API_KEY` から
読み込まれます。キーはローカル環境 (環境変数) にとどまり、リポジトリにコミットされることは
なく、TypeSafe API 以外へ送信されることもありません。

## License / ライセンス

MIT — see [`LICENSE`](LICENSE).
