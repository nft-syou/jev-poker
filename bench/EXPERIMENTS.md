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
| 9 | `18a43cf` | A/B: split preflop/postflop format (`--prompt split`: street-specific task, guidance and sizing rubric) vs unified, same seeds | unified +58.0 / split +58.3; paired diff +0.3 [-1.9, +2.4] | unified +13.0 / split +12.6 (400); paired diff -0.4 [-22.7, +21.9] |
| frozen | `a21cb6a` | **no policy change**; re-evaluation on seeds never used for tuning (`--base-seed 100001`) | **+60.6 [+52.9, +68.3]** | **+16.3 [+3.1, +29.4] (1000)** |

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
  Jev CPU (`tag`) beats the rule-based bot in both formats. Of its five -100 bb hands, three are
  preflop all-in confrontations with 85%-equity hands (QQ/AK class) — coolers — and two are real
  mistakes: calling a 5-bet shove with a 48%-equity hand, and stacking off with board trips and a
  weak kicker. Those two are the next things to fix.

- **exp9 (split format)**: no measurable effect. Heads-up the two formats are identical (paired
  difference +0.3 bb/100, CI [-1.9, +2.4]); in 6-max the split version plays tighter (VPIP 26% → 21%,
  PFR 22% → 15%) and its result has a narrower CI, but the mean is the same (paired -0.4 bb/100,
  CI [-22.7, +21.9]). The default stays `unified`; `--prompt split` remains available.

## Review corrections (2026-09-20) / レビューによる訂正

An external review (Codex) of this log and the code found the following; each was verified against
the saved results before being acted on.

- **The showdown win rate quoted above was wrong.** The statistic counted every hand in which the
  *table* reached a showdown, including hands Jev had already folded. In the 1,000-seed run 649 of
  825 such hands were after a Jev fold; Jev's own showdowns number 176, of which it finished ahead
  in 61 (34.7%, not 7%). The "5% showdown win rate" diagnosis in exp0/exp1 is therefore unreliable;
  the conclusions drawn from the individual losing hands stand. `bench/stats.ts` now counts only
  Jev's own showdowns (new field `showdowns`), and `pnpm bench:report` recomputes every summary
  from the raw hands, so old files are corrected too.
- **Selection on reused seeds.** Experiments 1-9 were tuned and judged on overlapping seed sets
  (base seed 1), so "+19.0, CI above zero" carried selection bias. The **frozen** row above re-runs
  the unchanged agent on seeds never used before: heads-up **+60.6 [+52.9, +68.3]**, 6-max
  **+16.3 [+3.1, +29.4]** over 1,000 seeds. The claim "beats the rule-based bot in both formats"
  holds on fresh data. From now on: tune on base seed 1, confirm on a fresh base seed.
- **Report identity.** `bench:report` used to key "latest" on (opponent, format, persona) only, so
  a later 400-seed A/B run shadowed the 1,000-seed result. The key now includes backend, model,
  prompt format, seed count, base seed and code version, and the table shows `コード` and `条件`.
- **Balanced estimator.** bb/100 and its CI now use only complete rotation groups; a single group
  yields no interval (`n/a`) instead of a zero-width one. No committed run was partial, so no
  published number changes.
- Still open (next): postflop sizes are inflated because the minimum raise is *added* to the pot
  fraction (a "pot-sized" bet into 2 bb is 3 bb); the state never says which seat is the actor;
  some guidance sentences are too absolute; 47 preflop raise-then-fold hands of 4 bb or more cost
  12.3 bb/100 in the 1,000-seed run, which is the largest identified leak.

## Fix round (2026-09-21) / 修正ラウンド

The open items from the review were fixed one at a time and measured by **paired comparison on the
same seeds** (difference per seed group, 95% CI). Tuning used base seed 1; decisions were confirmed
on base seed 200001; the final numbers come from base seed 300001, which no decision ever looked at.
The pre-fix code (`d0ae482`) was run on the same fresh seeds from an extracted copy, so "before"
and "after" share the deals.

| change | commit | heads-up | 6-max |
| --- | --- | --- | --- |
| F1 postflop sizes are pot fractions (the minimum raise is a floor, not a base); `PlayerView` gains `currentBet` / `committedThisStreet` | `7275bfd` | +1.0 [-1.0, +3.0] (100 seeds) | +7.2 [-7.1, +21.5] (400) |
| F7 guidance no longer states bluff/fold and SPR rules as absolutes | `8616892` | +1.0 [-1.9, +3.9] (100) | — |
| F4 actor identity, first form: `actor {seat, position}` + `isMe` flags + a sentence | `8616892` | **-7.2 [-12.3, -2.2]** (100) | -6.5 [-26.4, +13.4] (400, with F7) |
| — bisect: `actor` object alone | — | **-5.8 [-10.5, -1.0]** | — |
| — bisect: `isMe` flags alone | — | -1.3 [-4.5, +2.0] | — |
| — bisect: rename `playersToAct` → `opponentsNotAllIn` alone | — | 0.0 (identical play) | — |
| F4 final form, measured on 1,000 fresh seeds: `isMe` flags vs none | `6fcf8ac` | flags cost 11.4 [-0.6, +23.4] | flags gain **14.5 [+6.8, +22.2]** |
| → identity flags only at tables with three or more seats | `1014659` | | |
| F5 rules bot: re-raise size counts chips already in (baseline change) | `e467080` | -1.8 [-4.2, +0.7] (100) | — |

Final confirmation, base seed 300001, 1,000 seeds per format, `tag` vs `rules`:

| code | heads-up | 6-max |
| --- | --- | --- |
| pre-fix `d0ae482` | +74.8 [+54.8, +94.8] | +8.7 [-1.9, +19.4] |
| final `1014659` | **+62.7 [+48.7, +76.8]** | **+12.9 [+1.3, +24.5]** |
| paired difference | -12.1 [-27.9, +3.7] | +4.2 [-4.7, +13.1] |

Same comparison on base seed 200001 (used to choose the identity-flag rule): heads-up pre-fix +49.7,
final without flags +53.3 (paired +3.6 [-5.9, +13.1]); 6-max pre-fix +5.2, final with flags +10.1
(paired +4.8 [-7.2, +16.8]). Against `random` and `caller` the final code is unchanged in kind
(100 seeds: caller HU +239.9 [+101.5, +378.3], caller 6-max +1067.0 [+438.3, +1695.7], random 6-max
+227.9 [+5.0, +450.7], random HU inconclusive as before).

What this round established:

- The final agent beats the rule-based bot in both formats on data that played no part in any
  decision. The fixes are correctness fixes; their effect on strength is small — about +4 bb/100
  six-handed on two independent seed sets (neither significant alone) and nothing detectable
  heads-up.
- **Telling the model who it is matters, and the form matters.** An explicit `actor` object made
  heads-up play measurably worse (VPIP 49% → 44%); per-row `isMe` flags are worth about 14 bb/100
  six-handed and cost about 11 heads-up, where the position already identifies the player.
- **Heads-up at 100 seeds was under-sampled.** Its CI of ±8 held only because the first two seed
  sets contained no preflop all-in. One seed group in base 200001 (KK-class into a better hand, and
  a 4-bet/fold in the mirrored seat) moved a 100-seed result from about +55 to -25.9
  [-154.9, +103.1]. Heads-up conclusions now use 1,000 seeds (CI about ±15 to ±20).
- Three independent 1,000-seed 6-max estimates of the pre-fix agent are +19.0, +16.3 and +5.2/+8.7:
  the true edge over `rules` six-handed is on the order of +10 bb/100, not +19.

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
