# Benchmark results / ベンチマーク結果

Everything below the first section was measured on the `benchmark` branch, which had its own
poker engine and Jev agent; the commit hashes are from that history (still reachable from `main`).
The agent was then ported onto the game's own engine and Jev module (`src/jev`), so the game's CPU
is what `pnpm bench` measures now. The port keeps the state, the questions and the sizing that were
measured; it changes the persona texts (the game's presets) and the deals a seed produces (the game's
shuffle), so old and new runs are comparable in distribution, not hand by hand.

最初の節より下は、独自のエンジンと Jev エージェントを持っていた `benchmark` ブランチ上での計測です
(コミットハッシュはその履歴のもので、`main` から辿れます)。その後エージェントをゲーム本体のエンジンと
Jev モジュール (`src/jev`) に移植したので、現在の `pnpm bench` が測るのはゲームの CPU そのものです。
計測済みの状態・質問・サイジングはそのまま、人格の文面 (ゲームのプリセット) とシードから生成される配牌
(ゲームのシャッフル) が変わっています。移植前後の run は分布としては比較できますが、ハンド単位では一致しません。

## After the port / 移植後の確認

<!-- PORT_RESULTS -->

## Before the port / 移植前

**Run: 2026-09-19** — model `jev-1.13.0`, SDK 0.6.0, all 5 presets, `--seeds 100 --concurrency 8`
(≈ 3,500 API calls and ≈ 90 s per persona, 0 fail-open). Raw data: [`bench/results/`](results/).
Two code versions are shown: the first Jev agent (`2af5f01`) and the version after eight rounds of
improvement (`7afd6d1`, see [`bench/EXPERIMENTS.md`](EXPERIMENTS.md)).

## After improvements (`7afd6d1`) — persona × matchup, bb/100 / 改善後

| 人格 | random HU | random 6-max | caller HU | caller 6-max | rules HU | rules 6-max | VPIP | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock | +47.7 | +315.3 ✅ | +189.1 ✅ | +210.0 | +28.5 ✅ | -8.4 | 18% | 0 |
| tag | +161.9 | +445.9 ✅ | +340.0 ✅ | +1196.4 ✅ | +59.8 ✅ | +14.3 ✅ | 33% | 0 |
| lag | +152.8 | +352.9 ✅ | +245.7 ✅ | +1745.6 ✅ | +59.3 ✅ | +26.7 | 45% | 0 |
| maniac | +130.4 | -146.5 | +110.0 | +1206.3 ✅ | +57.3 ✅ | -25.1 | 68% | 0 |
| station | +434.5 | +588.6 ✅ | +170.8 ✅ | +801.8 ✅ | +57.4 ✅ | -9.9 | 49% | 0 |

## Before improvements (`2af5f01`) / 改善前

| 人格 | random HU | random 6-max | caller HU | caller 6-max | rules HU | rules 6-max | VPIP | 失敗 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock | +115.3 | +360.8 ✅ | +144.1 ✅ | +47.6 | -17.6 | -18.9 | 7% | 0 |
| tag | -41.6 | +404.2 ✅ | +405.1 ✅ | +984.8 ✅ | -9.0 | -40.0 | 13% | 0 |
| lag | +226.8 | +497.5 | +210.2 | +895.3 ✅ | -66.8 | -133.4 | 57% | 0 |
| maniac | +288.4 | -55.0 | +57.0 | -32.7 | -341.5 | -1230.5 ❌ | 85% | 0 |
| station | +59.9 | +284.1 | +0.0 | +0.0 | -122.1 ❌ | -731.8 ❌ | 73% | 0 |

✅ = 95% CI above zero / 95% CI が 0 より上, ❌ = 95% CI below zero / 95% CI が 0 より下. VPIP is averaged over the six matchups.

## Full table for the current code (`pnpm bench:report`) / 現行コードの全結果

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
[+52.9, +68.3], 6-max +16.3 [+3.1, +29.4]** over 1,000 seeds — the result holds on fresh data. After a round of correctness fixes (bet sizing,
identity flags, guidance, the rules bot's re-raise size; see `bench/EXPERIMENTS.md`) the final code was
confirmed on a second unused seed set (`--base-seed 300001`, 1,000 seeds each): **heads-up +62.7
[+48.7, +76.8], 6-max +12.9 [+1.3, +24.5]**. Heads-up needs 1,000 seeds too: one preflop all-in can
swing a 100-seed result by 60 bb/100. Five further ideas (always taking the most likely action,
range-aware equity, a preflop chart, opponent session statistics, another model) were each measured on
1,000 seeds and none beat this default, so they are options only. A fixed rule set over the same
features shows what the classifier adds: about +30 to +50 bb/100 heads-up, nothing six-handed.
Against a real poker AI — [Slumbot](https://www.slumbot.com/), heads-up at 200 bb, 12,000 hands each via
`pnpm bench:slumbot` — the Jev agent loses **-49.4 bb/100 [-65.8, -33.0]**, exactly like the heuristic
(-49.4) and the rule-based bot (-50.4): the edge over simple bots does not carry over to a strong opponent. The
improvements were all in what Jev is told — exact hand strength, equity vs. pot odds, whether its bet
was raised, pot commitment, blind-stealing spots — plus conventional preflop raise sizes; the engine
and the baselines are unchanged. Heads-up vs `random` remains inconclusive (random all-ins). `station`
vs `caller` was exactly 0.0 before the changes because neither side ever raised; now the station
persona raises occasionally.

**JA:** 改善後は、全人格がルールベースの `rules` にヘッズアップで有意に勝ち、`tag` は 6-max でも勝っています
(1,000 シード = 6,000 ハンドの専用 run で **+19.0 bb/100、95% CI [+3.1, +35.0]**。小さい run は -100bb のクーラー 1 回で ±20 揺れる)。
これらの run はチューニングと同じシードを含むため、方策を変えずに未使用シード (`--base-seed 100001`) で
再評価しました: **HU +60.6 [+52.9, +68.3]、6-max +16.3 [+3.1, +29.4]** (1,000 シード)。未使用データでも結論は変わりません。
その後、正しさの修正 (ベット額、自席フラグ、指針文、`rules` のリレイズ額。詳細は `bench/EXPERIMENTS.md`) を入れ、
最終コードを 2 つ目の未使用シード (`--base-seed 300001`、各 1,000 シード) で確認しました:
**HU +62.7 [+48.7, +76.8]、6-max +12.9 [+1.3, +24.5]**。HU も 1,000 シードが必要です
(プリフロップのオールイン 1 回で、100 シードの結果は 60 bb/100 動きます)。
さらに 5 つの案 (常に最尤の行動、レンジ対応エクイティ、プリフロップのチャート化、相手プロファイル、別モデル) を
各 1,000 シードで計測しましたが、どれも既定を上回らなかったためオプション扱いです。Jev と同じ特徴量だけを読む
固定ルールとの比較では、分類器の上乗せは HU で +30〜+50 bb/100、6-max ではゼロでした。
本格的なポーカー AI である [Slumbot](https://www.slumbot.com/) とのヘッズアップ (200bb、各 12,000 ハンド、`pnpm bench:slumbot`) では、
Jev エージェントは **-49.4 bb/100 [-65.8, -33.0]** で負けました。ヒューリスティック (-49.4) とルールベース (-50.4) と同じ負け幅で、
単純なボットに対する優位は強い相手には持ち越されません。
改善はすべて「Jev に何を伝えるか」(正確なハンド強度、エクイティと必要エクイティ、自分のベットがレイズされたか、
ポットコミット、スティールの機会) とプリフロップの標準的なレイズ額で、エンジンと対照群は変えていません。
`random` とのヘッズアップは依然として結論が出ません (ランダムなオールイン)。
