# jev-poker

[![CI](https://github.com/nft-syou/jev-poker/actions/workflows/ci.yml/badge.svg)](https://github.com/nft-syou/jev-poker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933?logo=nodedotjs&logoColor=white)](.node-version)
[![pnpm](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Deploys to Cloudflare Pages](https://img.shields.io/badge/deploys%20to-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](#deploy-to-cloudflare-pages)

**日本語版は [README.ja.md](README.ja.md) にあります。**

No-Limit Texas Hold'em in the browser where every CPU player thinks with
[TypeSafe Jev](https://typesafe.ai). Play against them, or let a full table of
CPUs play each other while you watch. Bring your own credentials: a TypeSafe API
key, or a Vercel, Lolipop or Cloudflare AI Gateway of your own.

## How it works

1. The game engine (`src/engine`, zero dependencies) deals, enforces betting rules, builds side pots and evaluates hands.
2. For every CPU decision, `src/jev` compresses the situation (position, made hand, draws, exact hand strength and equity, pot odds, stacks in BB, this hand's actions) and asks Jev three typed questions in one call: `action` (choice among the legal options), `sizing` (score 0–5) and `bluff_intent` (yes/no probability).
3. Jev returns probabilities. The persona's *variance* decides whether the CPU always takes the most likely action or samples. The result is clamped to a legal bet size.
4. If Jev is unreachable the CPU checks or folds and the history shows why.

Your credentials never leave your browser except inside requests to this site's
`/api/jev/*` proxy (a Cloudflare Pages Function), which forwards them with
`Authorization: Bearer <your key>` and stores nothing.

## Play

1. Open the deployed site (or run it locally, below).
2. Pick a route and enter its credentials when asked (see below). They are stored in your browser only.
3. Choose seats (2–6), who is human, a persona for each CPU, blinds and stack. With no human seat you get spectator mode.
4. Open "Jev" in the hand history to see the probabilities behind each CPU action.

## Routes

The connection modal offers four ways to reach Jev. Pick one; you can change it
at any time from the button in the header.

| Route | You provide | Requests go to | Model | Billed by |
| --- | --- | --- | --- | --- |
| TypeSafe direct | a TypeSafe API key | `https://api.typesafe.ai` | `jev-latest` | TypeSafe |
| Vercel AI Gateway | a Vercel AI Gateway API key | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | Vercel (or your own TypeSafe key if you added one there) |
| Lolipop AI Gateway | a Lolipop AI Gateway API key | `https://ai-gateway.lolipop.jp` | `typesafe/jev-latest` | Lolipop (prepaid credit, in yen) |
| Cloudflare AI Gateway | a TypeSafe API key + account id, gateway id, custom provider slug, optional gateway token | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-{slug}` | `jev-latest` | TypeSafe (Cloudflare adds logging, caching and rate limits) |

### Vercel AI Gateway

1. Vercel dashboard → AI Gateway → **API keys** → create a key (`vck_…`).
2. Paste it as the AI Gateway API key. Nothing else is needed: the gateway speaks the TypeSafe API at `https://ai-gateway.vercel.sh/typesafe`, and the app asks for the model id `typesafe-ai/jev`.
3. Optional BYOK: add your own TypeSafe key under the gateway's provider settings and Vercel routes the calls with it, so TypeSafe bills you instead.

### Lolipop AI Gateway

1. [ai-gateway.lolipop.jp](https://ai-gateway.lolipop.jp/) → your project → **API keys** → create a key, and make sure the project may call `typesafe/jev-latest`.
2. Paste it as the Lolipop AI Gateway API key. Nothing else is needed: the gateway serves the same `POST /v1/systemone` ([typed probabilistic decisions](https://ai-gateway.lolipop.jp/docs/guides/features/probabilistic-decision)) and the app asks for the model id `typesafe/jev-latest`.
3. Calls are charged to the organization's prepaid credit. When it runs out the gateway answers 402 and the table pauses with a top-up prompt.

### Cloudflare AI Gateway

1. Cloudflare dashboard → AI → **AI Gateway** → create a gateway. Note its **gateway id** and your **account id** (the 32-character hex id in the dashboard URL).
2. In that gateway, add a **custom provider** with base URL `https://api.typesafe.ai` and give it a slug, e.g. `typesafe`. The request URL becomes `…/custom-typesafe/v1/systemone`; the app adds the `custom-` prefix for you, so paste the slug alone.
3. In jev-poker pick "Cloudflare AI Gateway" and fill in your TypeSafe API key, the account id, the gateway id and the slug.
4. If the gateway is **authenticated**, create a gateway token and paste it into "Gateway token"; it is sent as `cf-aig-authorization`.

### Security

The proxy never accepts a URL from the browser. It chooses one of four fixed
hosts from a route id (`typesafe`, `vercel`, `lolipop`, `cloudflare`) and interpolates only
values that matched an anchored regex server-side — account id `[0-9a-f]{32}`,
gateway id `[A-Za-z0-9_-]{1,64}`, provider slug `[a-z0-9][a-z0-9-]{0,62}` with no
`custom-` prefix left on it, keys and tokens printable ASCII up to 512
characters — after `encodeURIComponent`.
Anything else is a 400 and the upstream is never contacted. Only
`POST /v1/systemone` and `GET /v1/models` are forwarded, upstream headers are
built from scratch (none of the app's own `X-*` headers travel on), and nothing
is logged or stored on the server. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Run locally

Requires Node.js 24 and pnpm.

    pnpm install
    pnpm dev          # Vite dev server; /api/jev runs the very same proxy handler as the Pages Function
    pnpm dev:pages    # build + `wrangler pages dev dist` with the real Pages Function
    pnpm check        # lint + typecheck + tests + build

`pnpm dev:pages` requires `wrangler` to be able to run (it is installed as a
dev dependency, no separate install needed); `.node-version` pins this project
to Node 24 for tools that read it.

## Deploy to Cloudflare Pages

1. Fork or push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command `pnpm build`, output directory `dist`. Set the environment variable `NODE_VERSION=24`.
4. Functions in `functions/` are deployed automatically. No secrets are needed: players bring their own credentials.

Optional variable `TYPESAFE_BASE_URL` overrides the upstream API root of the
`typesafe` route only; the gateway hosts are constants in the code. It is
used only when it looks like `https://…` (or `http://localhost…` for local
work); anything else falls back to the default.

## Personas

Five presets (Rock, TAG, LAG, Maniac, Calling Station). Duplicate one to edit
the description Jev receives and the variance. Custom personas live in your
browser's localStorage.

## Benchmark

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

Details: [`bench/README.md`](bench/README.md) (CLI, result format),
[`bench/RESULTS.md`](bench/RESULTS.md) (all tables),
[`bench/EXPERIMENTS.md`](bench/EXPERIMENTS.md) (every change that was tried, with its measurement).

## Project layout

    src/engine/    pure TypeScript poker engine (tested with seeded random play)
    src/jev/       features, questions, personas, decision policy, connection + TypeSafe backend
    src/agents/    the `Agent` interface: baseline bots, a heuristic, and the Jev CPU as an agent
    src/ui/        React UI, game loop, history with Jev probabilities
    src/i18n/      en / ja dictionaries
    src/proxy/     the proxy handler and its dev-server adapter (unit-tested)
    functions/     Cloudflare Pages Function entry
    bench/         benchmark runner, statistics, Slumbot client, saved results
    docs/superpowers/specs/  design spec

## Roadmap

- Tournament format: `BlindSchedule` already abstracts blinds; busted seats are not rebought when `format` is `tournament`.
- Versioned question sets recorded on each decision.

## Contributing

Bug reports, feature requests and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for how the project is built and tested, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we treat each other. Changes are
listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [`LICENSE`](LICENSE).
