# jev-poker

No-Limit Texas Hold'em in the browser where every CPU player thinks with
[TypeSafe Jev](https://typesafe.ai). Play against them, or let a full table of
CPUs play each other while you watch. Bring your own credentials: a TypeSafe API
key, or a Vercel, Lolipop or Cloudflare AI Gateway of your own.

ブラウザで遊べるノーリミット・テキサスホールデム。CPU プレイヤーは全員
[TypeSafe Jev](https://typesafe.ai) で考えます。人間 1 人 + CPU、または全席 CPU の
観戦モード。プレイにはあなた自身の TypeSafe API キー、または Vercel AI Gateway /
ロリポップ！AIゲートウェイ / Cloudflare AI Gateway の設定が必要です。

## How it works / 仕組み

1. The game engine (`src/engine`, zero dependencies) deals, enforces betting rules, builds side pots and evaluates hands.
2. For every CPU decision, `src/jev` compresses the situation (position, made hand, draws, exact hand strength and equity, pot odds, stacks in BB, this hand's actions) and asks Jev three typed questions in one call: `action` (choice among the legal options), `sizing` (score 0–5) and `bluff_intent` (yes/no probability).
3. Jev returns probabilities. The persona's *variance* decides whether the CPU always takes the most likely action or samples. The result is clamped to a legal bet size.
4. If Jev is unreachable the CPU checks or folds and the history shows why.

Your credentials never leave your browser except inside requests to this site's
`/api/jev/*` proxy (a Cloudflare Pages Function), which forwards them with
`Authorization: Bearer <your key>` and stores nothing.

1. ゲームエンジン (`src/engine`、依存ゼロ) が配札・ベッティング・サイドポット・役判定を行う。
2. CPU の手番ごとに `src/jev` が状況を圧縮し (ポジション、完成役、ドロー、正確なハンド強度とエクイティ、ポットオッズ、BB 換算スタック、今ハンドのアクション)、Jev に 3 つの型付き質問を 1 回で投げる: `action` (合法な選択肢からの choice)、`sizing` (0〜5 の score)、`bluff_intent` (yes/no の確率)。
3. Jev は確率を返す。人格の「ぶれ」で argmax かサンプリングかが決まり、最後に合法なベット額にクランプされる。
4. Jev に届かない場合は check か fold にし、履歴にその理由が出る。

認証情報はブラウザの localStorage にだけ保存され、このサイトの `/api/jev/*`
プロキシ (Cloudflare Pages Function) 経由の送信にのみ使われます。プロキシは
`Authorization: Bearer <key>` に載せ替えて転送し、何も保存しません。

## Play / 遊ぶ

1. Open the deployed site (or run it locally, below).
2. Pick a route and enter its credentials when asked (see below). They are stored in your browser only.
3. Choose seats (2–6), who is human, a persona for each CPU, blinds and stack. With no human seat you get spectator mode.
4. Open "Jev" in the hand history to see the probabilities behind each CPU action.

## Routes / 経路

The connection modal offers four ways to reach Jev. Pick one; you can change it
at any time from the button in the header.

| Route | You provide | Requests go to | Model | Billed by |
| --- | --- | --- | --- | --- |
| TypeSafe direct | a TypeSafe API key | `https://api.typesafe.ai` | `jev-latest` | TypeSafe |
| Vercel AI Gateway | a Vercel AI Gateway API key | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | Vercel (or your own TypeSafe key if you added one there) |
| Lolipop AI Gateway | a Lolipop AI Gateway API key | `https://ai-gateway.lolipop.jp` | `typesafe/jev-latest` | Lolipop (prepaid credit, in yen) |
| Cloudflare AI Gateway | a TypeSafe API key + account id, gateway id, custom provider slug, optional gateway token | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-{slug}` | `jev-latest` | TypeSafe (Cloudflare adds logging, caching and rate limits) |

接続モーダルで 4 つの経路から 1 つを選びます。ヘッダのボタンからいつでも変更できます。
TypeSafe 直結は TypeSafe のキーのみ、Vercel AI Gateway は Vercel のキーのみ
(モデル id は `typesafe-ai/jev`、課金は Vercel)、ロリポップ！AIゲートウェイは
ロリポップの API キーのみ (モデル id は `typesafe/jev-latest`、課金はロリポップの
前払いクレジット)、Cloudflare AI Gateway は
TypeSafe のキーに加えてアカウント ID・ゲートウェイ ID・カスタムプロバイダの slug
(認証付きゲートウェイならトークンも) が必要です。

### Vercel AI Gateway

1. Vercel dashboard → AI Gateway → **API keys** → create a key (`vck_…`).
2. Paste it as the AI Gateway API key. Nothing else is needed: the gateway speaks the TypeSafe API at `https://ai-gateway.vercel.sh/typesafe`, and the app asks for the model id `typesafe-ai/jev`.
3. Optional BYOK: add your own TypeSafe key under the gateway's provider settings and Vercel routes the calls with it, so TypeSafe bills you instead.

### Lolipop AI Gateway / ロリポップ！AIゲートウェイ

1. [ai-gateway.lolipop.jp](https://ai-gateway.lolipop.jp/) → your project → **API keys** → create a key, and make sure the project may call `typesafe/jev-latest`.
2. Paste it as the Lolipop AI Gateway API key. Nothing else is needed: the gateway serves the same `POST /v1/systemone` ([typed probabilistic decisions](https://ai-gateway.lolipop.jp/docs/guides/features/probabilistic-decision)) and the app asks for the model id `typesafe/jev-latest`.
3. Calls are charged to the organization's prepaid credit. When it runs out the gateway answers 402 and the table pauses with a top-up prompt.

ロリポップ！AIゲートウェイのコンソールでプロジェクトの API キーを発行し、そのまま貼り付けるだけです。
ゲートウェイは TypeSafe と同じ `POST /v1/systemone` (型付き確率的判断) を提供しており、
アプリはモデル id `typesafe/jev-latest` を指定します。課金は組織の前払いクレジットで、
残高が尽きると 402 が返り、テーブルは一時停止してチャージを促します。

### Cloudflare AI Gateway

1. Cloudflare dashboard → AI → **AI Gateway** → create a gateway. Note its **gateway id** and your **account id** (the 32-character hex id in the dashboard URL).
2. In that gateway, add a **custom provider** with base URL `https://api.typesafe.ai` and give it a slug, e.g. `typesafe`. The request URL becomes `…/custom-typesafe/v1/systemone`; the app adds the `custom-` prefix for you, so paste the slug alone.
3. In jev-poker pick "Cloudflare AI Gateway" and fill in your TypeSafe API key, the account id, the gateway id and the slug.
4. If the gateway is **authenticated**, create a gateway token and paste it into "Gateway token"; it is sent as `cf-aig-authorization`.

### Security / セキュリティ

The proxy never accepts a URL from the browser. It chooses one of four fixed
hosts from a route id (`typesafe`, `vercel`, `lolipop`, `cloudflare`) and interpolates only
values that matched an anchored regex server-side — account id `[0-9a-f]{32}`,
gateway id `[A-Za-z0-9_-]{1,64}`, provider slug `[a-z0-9][a-z0-9-]{0,62}` with no
`custom-` prefix left on it, keys and tokens printable ASCII up to 512
characters — after `encodeURIComponent`.
Anything else is a 400 and the upstream is never contacted. Only
`POST /v1/systemone` and `GET /v1/models` are forwarded, upstream headers are
built from scratch (none of the app's own `X-*` headers travel on), and nothing
is logged or stored on the server.

プロキシは自由な URL を一切受け取りません。経路 id で固定の 3 ホストから選び、
サーバー側の正規表現を通った値だけを `encodeURIComponent` して埋め込みます。
条件を満たさなければ 400 を返し、上流には接続しません。サーバーに保存・ログは一切ありません。

## Run locally / ローカルで動かす

Requires Node.js 24 and pnpm.

    pnpm install
    pnpm dev          # Vite dev server; /api/jev runs the very same proxy handler as the Pages Function
    pnpm dev:pages    # build + `wrangler pages dev dist` with the real Pages Function
    pnpm check        # lint + typecheck + tests + build

`pnpm dev:pages` requires `wrangler` to be able to run (it is installed as a
dev dependency, no separate install needed); `.node-version` pins this project
to Node 24 for tools that read it.

## Deploy to Cloudflare Pages / デプロイ

1. Fork or push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command `pnpm build`, output directory `dist`. Set the environment variable `NODE_VERSION=24`.
4. Functions in `functions/` are deployed automatically. No secrets are needed: players bring their own credentials.

Optional variable `TYPESAFE_BASE_URL` overrides the upstream API root of the
`typesafe` route only; the two gateway hosts are constants in the code. It is
used only when it looks like `https://…` (or `http://localhost…` for local
work); anything else falls back to the default.

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
    src/jev/       features, questions, personas, decision policy, connection + TypeSafe backend
    src/agents/    the `Agent` interface: baseline bots, a heuristic, and the Jev CPU as an agent
    src/ui/        React UI, game loop, history with Jev probabilities
    src/i18n/      en / ja dictionaries
    src/proxy/     the proxy handler and its dev-server adapter (unit-tested)
    functions/     Cloudflare Pages Function entry
    bench/         benchmark runner, statistics, Slumbot client, saved results
    docs/superpowers/specs/  design spec

## Roadmap / 今後

- Tournament format: `BlindSchedule` already abstracts blinds; busted seats are not rebought when `format` is `tournament`.
- Versioned question sets recorded on each decision.

## License

MIT — see `LICENSE`.
