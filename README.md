# jev-poker

No-Limit Texas Hold'em in the browser where every CPU player thinks with
[TypeSafe Jev](https://typesafe.ai). Play against them, or let a full table of
CPUs play each other while you watch. Bring your own TypeSafe API key.

ブラウザで遊べるノーリミット・テキサスホールデム。CPU プレイヤーは全員
[TypeSafe Jev](https://typesafe.ai) で考えます。人間 1 人 + CPU、または全席 CPU の
観戦モード。プレイにはあなた自身の TypeSafe API キーが必要です。

## How it works / 仕組み

1. The game engine (`src/engine`, zero dependencies) deals, enforces betting rules, builds side pots and evaluates hands.
2. For every CPU decision, `src/jev` compresses the situation (position, made hand, draws, pot odds, stacks in BB, this hand's actions) and asks Jev three typed questions in one call: `action` (choice among the legal options), `sizing` (score 0–5) and `bluff_intent` (yes/no probability).
3. Jev returns probabilities. The persona's *variance* decides whether the CPU always takes the most likely action or samples. The result is clamped to a legal bet size.
4. If Jev is unreachable the CPU checks or folds and the history shows why.

Your API key never leaves your browser except inside requests to this site's
`/api/jev/*` proxy (a Cloudflare Pages Function), which forwards them to
`api.typesafe.ai` with `Authorization: Bearer <your key>` and stores nothing.

1. ゲームエンジン (`src/engine`、依存ゼロ) が配札・ベッティング・サイドポット・役判定を行う。
2. CPU の手番ごとに `src/jev` が状況を圧縮し (ポジション、完成役、ドロー、ポットオッズ、BB 換算スタック、今ハンドのアクション)、Jev に 3 つの型付き質問を 1 回で投げる: `action` (合法な選択肢からの choice)、`sizing` (0〜5 の score)、`bluff_intent` (yes/no の確率)。
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

## Project layout / 構成

    src/engine/    pure TypeScript poker engine (tested with seeded random play)
    src/jev/       features, questions, personas, decision policy, TypeSafe backend
    src/ui/        React UI, game loop, history with Jev probabilities
    src/i18n/      en / ja dictionaries
    src/proxy/     the proxy handler (unit-tested)
    functions/     Cloudflare Pages Function entry
    docs/superpowers/specs/  design spec

## Roadmap / 今後

- Tournament format: `BlindSchedule` already abstracts blinds; busted seats are not rebought when `format` is `tournament`.
- Versioned question sets recorded on each decision.

## License

MIT — see `LICENSE`.
