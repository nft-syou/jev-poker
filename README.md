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

- Node >= 20
- `pnpm install`
- `pnpm test`
- `pnpm typecheck`

**JA:**

- Node >= 20
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

目安として (ベンチマーク spec §9 参照)、既定の 100 シードで `--opponent all --format all`
を実行すると Jev の呼び出しはおよそ 3,000〜8,000 回になり、1 呼び出し 1〜2 秒・同時実行数 4
であれば全体でおよそ 20〜70 分かかる見積もりです。実際のコストと所要時間は TypeSafe の
プランやネットワーク状況によって変わります。

CLI の詳細な使い方と結果フォーマットは [`bench/README.md`](bench/README.md) を参照してください。

### 結果 / Results

最新の結果表はベンチマーク実行後にここへ手動で貼る (`pnpm bench:report` の出力)。

| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

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

MIT
