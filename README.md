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
2. For every CPU decision, `src/jev` compresses the situation (position, made hand, draws, pot odds, stacks in BB, this hand's actions) and asks Jev three typed questions in one call: `action` (choice among the legal options), `sizing` (score 0–5) and `bluff_intent` (yes/no probability).
3. Jev returns probabilities. The persona's *variance* decides whether the CPU always takes the most likely action or samples. The result is clamped to a legal bet size.
4. If Jev is unreachable the CPU checks or folds and the history shows why.

Your credentials never leave your browser except inside requests to this site's
`/api/jev/*` proxy (a Cloudflare Pages Function), which forwards them with
`Authorization: Bearer <your key>` and stores nothing.

1. ゲームエンジン (`src/engine`、依存ゼロ) が配札・ベッティング・サイドポット・役判定を行う。
2. CPU の手番ごとに `src/jev` が状況を圧縮し (ポジション、完成役、ドロー、ポットオッズ、BB 換算スタック、今ハンドのアクション)、Jev に 3 つの型付き質問を 1 回で投げる: `action` (合法な選択肢からの choice)、`sizing` (0〜5 の score)、`bluff_intent` (yes/no の確率)。
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

## Project layout / 構成

    src/engine/    pure TypeScript poker engine (tested with seeded random play)
    src/jev/       features, questions, personas, decision policy, connection + TypeSafe backend
    src/ui/        React UI, game loop, history with Jev probabilities
    src/i18n/      en / ja dictionaries
    src/proxy/     the proxy handler and its dev-server adapter (unit-tested)
    functions/     Cloudflare Pages Function entry
    docs/superpowers/specs/  design spec

## Roadmap / 今後

- Tournament format: `BlindSchedule` already abstracts blinds; busted seats are not rebought when `format` is `tournament`.
- Versioned question sets recorded on each decision.

## License

MIT — see `LICENSE`.
