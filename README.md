# jev-poker

No-Limit Texas Hold'em in the browser where every CPU player thinks with
[TypeSafe Jev](https://typesafe.ai). Play against them, or let a full table of
CPUs play each other while you watch. Bring your own TypeSafe API key.

ブラウザで遊べるノーリミット・テキサスホールデム。CPU プレイヤーは全員
[TypeSafe Jev](https://typesafe.ai) で考えます。人間 1 人 + CPU、または全席 CPU の
観戦モード。プレイにはあなた自身の TypeSafe API キーが必要です。

## How it works / 仕組み

1. The game engine (`src/engine`, zero dependencies) deals, enforces betting rules, builds side pots and evaluates hands.
2. For every CPU decision, `src/jev` compresses the situation (position, made hand, draws, exact hand strength and equity, pot odds, stacks in BB, this hand's actions) and asks Jev three typed questions in one call: `action` (choice among the legal options), `sizing` (score 0–5) and `bluff_intent` (yes/no probability).
3. Jev returns probabilities. The persona's *variance* decides whether the CPU always takes the most likely action or samples. The result is clamped to a legal bet size.
4. If Jev is unreachable the CPU checks or folds and the history shows why.

Your API key never leaves your browser except inside requests to this site's
`/api/jev/*` proxy (a Cloudflare Pages Function), which forwards them to
`api.typesafe.ai` with `Authorization: Bearer <your key>` and stores nothing.

1. ゲームエンジン (`src/engine`、依存ゼロ) が配札・ベッティング・サイドポット・役判定を行う。
2. CPU の手番ごとに `src/jev` が状況を圧縮し (ポジション、完成役、ドロー、正確なハンド強度とエクイティ、ポットオッズ、BB 換算スタック、今ハンドのアクション)、Jev に 3 つの型付き質問を 1 回で投げる: `action` (合法な選択肢からの choice)、`sizing` (0〜5 の score)、`bluff_intent` (yes/no の確率)。
3. Jev は確率を返す。人格の「ぶれ」で argmax かサンプリングかが決まり、最後に合法なベット額にクランプされる。
4. Jev に届かない場合は check か fold にし、履歴にその理由が出る。

API キーはブラウザの localStorage にだけ保存され、このサイトの `/api/jev/*`
プロキシ (Cloudflare Pages Function) 経由の送信にのみ使われます。プロキシは
`Authorization: Bearer <key>` に載せ替えて `api.typesafe.ai` に転送し、何も保存しません。

## Play / 遊ぶ

1. Open the deployed site (or run it locally, below).
2. Paste your TypeSafe API key when asked. It is stored in your browser only.
3. Choose seats (2–6), who is human, a persona for each CPU, blinds and stack. With no human seat you get spectator mode.
4. Open "Jev" in the hand history to see the probabilities behind each CPU action.

## Run locally / ローカルで動かす

Requires Node.js 24 and pnpm.

    pnpm install
    pnpm dev          # Vite dev server; /api/jev is proxied to api.typesafe.ai with the same header rewrite
    pnpm dev:pages    # build + `wrangler pages dev dist` with the real Pages Function
    pnpm check        # lint + typecheck + tests + build

`pnpm dev:pages` requires `wrangler` to be able to run (it is installed as a
dev dependency, no separate install needed); `.node-version` pins this project
to Node 24 for tools that read it.

## Deploy to Cloudflare Pages / デプロイ

1. Fork or push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command `pnpm build`, output directory `dist`. Set the environment variable `NODE_VERSION=24`.
4. Functions in `functions/` are deployed automatically. No secrets are needed: players bring their own key.

Optional variable `TYPESAFE_BASE_URL` overrides the upstream API root.

## Personas / 人格

Five presets (Rock, TAG, LAG, Maniac, Calling Station). Duplicate one to edit
the description Jev receives and the variance. Custom personas live in your
browser's localStorage.

## Benchmark / ベンチマーク

`pnpm bench` seats the game's own Jev CPU against three baseline bots (`random`, `caller`, a
rule-based `rules`) and reports bb/100 with a 95% confidence interval. Every deal is replayed with
the Jev seat rotated (mirrored hands), heads-up and six-handed. `pnpm bench:slumbot` plays
[Slumbot](https://www.slumbot.com/), a real heads-up poker AI, through its public API.

    TYPESAFE_API_KEY=... pnpm bench --opponent rules --format all --seeds 1000
    pnpm bench --backend mock --seeds 100     # dry run, no key, no cost
    pnpm bench:report                         # re-render saved results

What the measurements say (`tag` persona, 1,000 seeds on seeds never used for tuning):

| opponent | heads-up bb/100 | 6-max bb/100 |
| --- | --- | --- |
| `rules` bot | **+48.8** [+38.4, +59.1] | **+11.3** [-0.2, +22.8] |
| Slumbot (200 bb, 12,000 hands) | -49.4 [-65.8, -33.0] | — |

The `rules` row is the game's CPU as shipped. The Slumbot row was measured before the agent was
ported onto the game's engine, where the same agent scored +62.7 [+48.7, +76.8] and +12.9
[+1.3, +24.5] against `rules`.

- The CPU this game first shipped with did not beat the rule-based bot (-4.5 heads-up, -24.5
  six-handed); on the same deals the current one is **+53.2 [+31.5, +75.0]** and
  **+35.8 [+9.9, +61.7]** bb/100 better. It wins now because of what it is told
  (exact hand strength, equity against pot odds, whether its bet was raised, pot commitment,
  blind-stealing spots) and conventional preflop raise sizes. The strength comes from the code
  around the model.
- A fixed heuristic over the same features is 30 to 50 bb/100 behind Jev heads-up and level with it
  six-handed; against Slumbot Jev, the heuristic and the rules bot all lose about 50 bb/100.
- What Jev adds is authoring: a persona is a paragraph of text, every decision comes with
  probabilities to show, and a new character costs no new code.

`pnpm bench` はゲーム本体の Jev CPU を 3 種のベースライン (`random`、`caller`、ルールベースの `rules`) と
対戦させ、bb/100 と 95% 信頼区間を出します。同じ配牌を Jev の席だけ入れ替えて再生する (ミラーハンド) ので
カード運の分散が小さく、ヘッズアップと 6-max の両方を測ります。`pnpm bench:slumbot` は本格的な
ヘッズアップ AI の [Slumbot](https://www.slumbot.com/) と公開 API 経由で対戦します。

- このゲームが最初に積んでいた CPU はルールベースに勝てていませんでした (HU -4.5、6-max -24.5)。
  同じ配牌での直接比較で、現在の CPU は **+53.2 [+31.5, +75.0]** / **+35.8 [+9.9, +61.7]** bb/100 上回ります。
  勝てるようになったのは「Jev に何を伝えるか」
  (正確なハンド強度、エクイティと必要エクイティ、自分のベットがレイズされたか、ポットコミット、
  スティールの機会) と標準的なプリフロップのレイズ額のおかげで、強さはモデルの周りのコードから来ています。
- 同じ特徴量だけを読む固定ルールは、ヘッズアップで Jev より 30〜50 bb/100 弱く、6-max では互角です。
  Slumbot には Jev もヒューリスティックもルールベースも約 50 bb/100 負けます。
- Jev の価値はキャラクターの作りやすさにあります。人格は一段落の文章で、すべての判断に見せられる確率が付き、
  新しいキャラクターを増やすのにコードは要りません。

Details: [`bench/README.md`](bench/README.md) (CLI, result format),
[`bench/RESULTS.md`](bench/RESULTS.md) (all tables),
[`bench/EXPERIMENTS.md`](bench/EXPERIMENTS.md) (every change that was tried, with its measurement).

## Project layout / 構成

    src/engine/    pure TypeScript poker engine (tested with seeded random play)
    src/jev/       features, questions, personas, decision policy, TypeSafe backend
    src/agents/    the `Agent` interface: baseline bots, a heuristic, and the Jev CPU as an agent
    src/ui/        React UI, game loop, history with Jev probabilities
    src/i18n/      en / ja dictionaries
    src/proxy/     the proxy handler (unit-tested)
    functions/     Cloudflare Pages Function entry
    bench/         benchmark runner, statistics, Slumbot client, saved results
    docs/superpowers/specs/  design spec

## Roadmap / 今後

- Tournament format: `BlindSchedule` already abstracts blinds; busted seats are not rebought when `format` is `tournament`.
- Versioned question sets recorded on each decision.

## License

MIT — see `LICENSE`.
