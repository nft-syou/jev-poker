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

**Run: 2026-09-19** — model `jev-1.13.0`, SDK 0.6.0, code `2af5f01`, all 5 presets, `--seeds 100 --concurrency 8`
(25,404 API calls in total, 0 fail-open, p95 latency 0.45 s, ≈ 90 s wall clock per persona). Raw data: [`bench/results/`](bench/results/).

#### Persona × matchup (bb/100) / 人格 × 対戦 (bb/100)

| 人格 | random HU | random 6-max | caller HU | caller 6-max | rules HU | rules 6-max | VPIP | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock | +115.3 | +360.8 ✅ | +144.1 ✅ | +47.6 | -17.6 | -18.9 | 7% | 0 |
| tag | -41.6 | +404.2 ✅ | +405.1 ✅ | +984.8 ✅ | -9.0 | -40.0 | 13% | 0 |
| lag | +226.8 | +497.5 | +210.2 | +895.3 ✅ | -66.8 | -133.4 | 57% | 0 |
| maniac | +288.4 | -55.0 | +57.0 | -32.7 | -341.5 | -1230.5 ❌ | 85% | 0 |
| station | +59.9 | +284.1 | +0.0 | +0.0 | -122.1 ❌ | -731.8 ❌ | 73% | 0 |

✅ = 95% CI above zero / 95% CI が 0 より上, ❌ = 95% CI below zero / 95% CI が 0 より下. VPIP is averaged over the six matchups.

#### Full table (`pnpm bench:report`) / 全結果

| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| random | HU | lag | 100 | 200 | +226.8 | [-234.0, +687.7] | 55% | 51% | 0 | 0.3s |
| random | HU | maniac | 100 | 200 | +288.4 | [-389.1, +965.9] | 79% | 75% | 0 | 0.3s |
| random | HU | rock | 100 | 200 | +115.3 | [-139.1, +369.8] | 8% | 2% | 0 | 0.3s |
| random | HU | station | 100 | 200 | +59.9 | [-507.2, +626.9] | 66% | 0% | 0 | 0.3s |
| random | HU | tag | 100 | 200 | -41.6 | [-315.6, +232.5] | 13% | 11% | 0 | 0.3s |
| random | 6-max | lag | 100 | 600 | +497.5 | [-72.7, +1067.7] | 51% | 39% | 0 | 0.3s |
| random | 6-max | maniac | 100 | 600 | -55.0 | [-1109.8, +999.7] | 97% | 77% | 0 | 0.3s |
| random | 6-max | rock | 100 | 600 | +360.8 | [+110.2, +611.4] | 7% | 0% | 0 | 0.3s |
| random | 6-max | station | 100 | 600 | +284.1 | [-829.6, +1397.7] | 98% | 0% | 0 | 0.3s |
| random | 6-max | tag | 100 | 600 | +404.2 | [+72.5, +735.9] | 11% | 8% | 0 | 0.3s |
| caller | HU | lag | 100 | 200 | +210.2 | [-243.7, +664.2] | 60% | 56% | 0 | 0.3s |
| caller | HU | maniac | 100 | 200 | +57.0 | [-163.2, +277.2] | 89% | 89% | 0 | 0.3s |
| caller | HU | rock | 100 | 200 | +144.1 | [+6.9, +281.3] | 8% | 2% | 0 | 0.3s |
| caller | HU | station | 100 | 200 | +0.0 | [+0.0, +0.0] | 50% | 0% | 0 | 0.3s |
| caller | HU | tag | 100 | 200 | +405.1 | [+155.9, +654.3] | 14% | 13% | 0 | 0.2s |
| caller | 6-max | lag | 100 | 600 | +895.3 | [+112.8, +1677.8] | 67% | 51% | 0 | 0.3s |
| caller | 6-max | maniac | 100 | 600 | -32.7 | [-100.6, +35.3] | 96% | 95% | 0 | 0.3s |
| caller | 6-max | rock | 100 | 600 | +47.6 | [-46.3, +141.4] | 7% | 0% | 0 | 0.3s |
| caller | 6-max | station | 100 | 600 | +0.0 | [+0.0, +0.0] | 83% | 0% | 0 | 0.3s |
| caller | 6-max | tag | 100 | 600 | +984.8 | [+338.2, +1631.5] | 13% | 11% | 0 | 0.3s |
| rules | HU | lag | 100 | 200 | -66.8 | [-208.5, +75.0] | 50% | 45% | 0 | 0.3s |
| rules | HU | maniac | 100 | 200 | -341.5 | [-683.9, +0.9] | 59% | 59% | 0 | 0.3s |
| rules | HU | rock | 100 | 200 | -17.6 | [-56.3, +21.2] | 7% | 2% | 0 | 0.3s |
| rules | HU | station | 100 | 200 | -122.1 | [-210.3, -33.8] | 55% | 0% | 0 | 0.3s |
| rules | HU | tag | 100 | 200 | -9.0 | [-37.8, +19.8] | 11% | 11% | 0 | 0.3s |
| rules | 6-max | lag | 100 | 600 | -133.4 | [-274.4, +7.7] | 62% | 51% | 0 | 0.3s |
| rules | 6-max | maniac | 100 | 600 | -1230.5 | [-1873.8, -587.1] | 92% | 90% | 0 | 0.3s |
| rules | 6-max | rock | 100 | 600 | -18.9 | [-103.1, +65.3] | 7% | 0% | 0 | 0.3s |
| rules | 6-max | station | 100 | 600 | -731.8 | [-1082.3, -381.3] | 88% | 0% | 0 | 0.3s |
| rules | 6-max | tag | 100 | 600 | -40.0 | [-80.4, +0.5] | 14% | 11% | 0 | 0.3s |

**EN:** Every persona beats `caller` and `random` in at least one format, and `tag`/`rock` beat `random` 6-max
and `caller` heads-up with the CI above zero. **No persona beats the rule-based bot**: `tag` and `rock` are
break-even against `rules` (CI straddles zero), while `lag`, `maniac` and `station` lose clearly. So "stronger
than a rule-based bot" is not established by this run. Heads-up against `random` is inconclusive for everyone
because random all-ins make the variance enormous. `station` vs `caller` is exactly 0.0 by construction: neither
side ever raises, so mirrored hands cancel perfectly.

**JA:** どの人格も `caller` と `random` には少なくとも一方の形式で勝ち、`tag`/`rock` は `random` 6-max と
`caller` HU で CI が 0 より上です。**ルールベースの `rules` に勝てる人格はありません**。`tag` と `rock` は
互角 (CI が 0 をまたぐ)、`lag`/`maniac`/`station` は明確に負けています。「ルールベースより強い」はこの実行では
言えません。`random` とのヘッズアップはランダムなオールインで分散が大きすぎて、どの人格でも結論が出ません。
`station` vs `caller` がちょうど 0.0 なのは仕様どおりで、両者ともレイズしないためミラーハンドが完全に相殺します。

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
