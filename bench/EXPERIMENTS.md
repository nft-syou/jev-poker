# Improvement log / 改善ログ

Jev CPU (`tag` persona) vs the rule-based bot (`rules`), bb/100 with 95% CI. Every experiment
changes only what Jev is told (`src/jev/compress.ts`) or how its answers are mapped
(`src/jev/agent.ts`); the engine and the baselines never change, so runs are comparable.
Raw data: `bench/results/*-exp<N>-*.json`. All runs use model `jev-1.13.0`.

| exp | commit | change | rules HU (100 seeds) | rules 6-max |
| --- | --- | --- | --- | --- |
| 0 | `2af5f01` | baseline: hand category, draws, pot odds, persona text | -9.0 [-37.8, +19.8] | -40.0 [-80.4, +0.5] (100 seeds) |
| 1 | `d5cf2d2` | Monte Carlo `equityVsRandomPct`, `requiredEquityPct`, general guidance (discount equity vs aggression, don't bluff-raise then fold, open the button heads-up) | +55.8 [+47.5, +64.2] | -9.8 [-29.6, +10.0] (100) |
| 2 | `5db3672` | `pairKind` (top/middle/bottom/over/under/board pair); re-raise and river-call guidance | +52.7 [+44.4, +61.1] | +21.5 [-51.6, +94.6] (100) |
| 3 | `b50d4bf` | `raisesThisStreet`, `myBetWasRaisedThisStreet`; decision log gains hand diagnostics | +40.7 [+31.9, +49.6] | -44.8 [-94.2, +4.5] (100) |
| 4 | `241c9f7` | exact `beatsPctOfHands` (share of opponent holdings beaten now), `board_texture`; strength-based guidance replaces "two pair or better" | +32.5 [+23.7, +41.3] | -7.9 [-21.0, +5.2] (200) |
| 5 | `6420f87` | `unopenedPot` flag and blind-stealing guidance | +53.6 [+44.8, +62.3] | -6.9 [-32.2, +18.4] (200) |
| 6 | `2c68824` | preflop 3-bet/4-bet discipline and sizing guidance | +58.0 [+50.1, +65.9] | +7.7 [-6.9, +22.2] (200) |
| 7 | `c328305` | conventional preflop raise sizes (bb opens, multiples of the raise faced) instead of pot fractions | +57.5 [+49.7, +65.3] | +8.4 [-19.2, +36.0] (200); +8.2 [-8.7, +25.1] (400); +18.8 [+10.8, +26.8] (100, seeds 0-99) |
| 8 | `7afd6d1` | `stackToPotRatio` and pot-commitment guidance; `tag` variance 0.3 → 0.15 | +57.3 [+49.0, +65.5] | +11.9 [-29.8, +53.6] (200) |
| final | `7afd6d1` | same code, 1,000 seeds = 6,000 hands in 6-max to settle the question | — | **+19.0 [+3.1, +35.0] (1000)** |

## What the decision logs showed / 判断ログから分かったこと

- **exp0**: heads-up the two bots mostly folded to each other. In 6-max Jev's showdown win rate was
  5%: it called down against a bot that only bets two pair or better, and it bluff-raised big and
  then folded (-30 to -50 bb a hand).
- **exp1**: equity and the "discount against aggression" rule fixed most of the heads-up leak (VPIP
  10% → 48%); the bluff re-raise/fold lines remained.
- **exp3**: the two -100 bb hands were *weak* two pair / board-pair trips stacked off because the
  guidance said "two pair or better is strong". Category alone is misleading, hence exp4's exact
  hand strength.
- **exp4**: postflop discipline held; the remaining loss was blinds (non-VPIP hands -0.09 bb each,
  VPIP hands ±0), hence exp5's blind stealing.
- **exp5-7**: the last leaks are preflop: light 3-bet/4-bet then fold. The model chooses these as
  its most likely action (0.5-0.6), so guidance only reduces them; sizing (exp7) at least makes
  them cheaper. One -94 bb hand was a *sampling* accident: the model preferred calling (0.67) but
  the persona variance of 0.3 still folded ~9% of the time, hence exp8's 0.15.
- The 6-max number is dominated by a handful of big pots; seed 182 alone is a -100 bb cooler
  (QQ/AK-class hand into AA). 100-seed runs that exclude it look much better than 200/400-seed
  runs that include it. The 1,000-seed run settles it: **+19.0 bb/100 with the 95% CI above zero**, so the
  Jev CPU (`tag`) beats the rule-based bot in both formats. Five of the six -100 bb hands in that run
  are preflop all-in confrontations with 85%-equity hands (QQ/AK class) — coolers, not mistakes.

## Reproduce / 再現

```sh
TYPESAFE_API_KEY=... pnpm bench --opponent rules --format all --seeds 200 --concurrency 8 --label mytest
pnpm bench:report            # table over the latest file per (opponent, format, persona)
```

The result JSON records, for every Jev decision, the model's probabilities, the sizing score, the
bluff intent, and what the model was told about its hand (`equityVsRandomPct`, `beatsPctOfHands`,
`madeHand`, `pairKind`, `myBetWasRaised`), so a losing line can be traced back to what Jev saw.

The seed set is fixed (`--base-seed 1`), so any two runs of the same code see the same deals; the
only randomness is Jev's answers and the persona sampling.
