# Fantasy Command Center Intelligence Engine V3

V3 keeps V1 as the final roster-utility authority and V2 as the transaction framework. It adds a two-stage search screen plus separate fundamental, market, role, option-value, and signal layers.

Trade intelligence is scoped to players rostered by the 12 fantasy teams. Free agents remain in the canonical snapshot only so V1 can calculate league-specific replacement and required-drop effects. Waivers use a cheap projection, need, availability, ownership, position, and exploration pass capped at 100 players before any candidate intelligence or exact add/drop work.

## Value boundaries

- Fundamental value estimates future scoring. ESPN is the baseline; usage can move it by at most 15%.
- Roster-relative value remains the output of V1 legal lineup and roster evaluation.
- Market value estimates manager perception from ESPN ownership, start percentage, recent scoring, decayed ADP, and a projection anchor. Missing independent inputs make mispricing unavailable.
- Opponent Fit remains the deterministic effect on the other roster.
- Market Fairness is reported independently and never changes V1 utility.

## Broad search

Structural filters reduce the full package space to at most 60 candidates per opponent. `quickEvaluateTrade` recalculates exact legal lineups but replaces V1 injury scenarios with a bench replacement proxy and a cheap drop estimate. The best quick candidates then receive full `evaluateTrade` evaluation. Displayed results always contain full V1 outputs.

Eighty percent of each opponent's exact budget is reserved for candidates above the normal quick opponent-fit guard (`>-8` proxy utility). The remaining exploration quota admits candidates down to `>-20`, because the depth proxy can overstate an opponent's loss. The final V1 evaluation and Opponent Fit rules still reject destructive offers.

The quick evaluator is designed for recall rather than perfect scoring. Validation compares Pearson and Spearman correlation, top-10 overlap, and top-decile recall against full V1.

## Fundamental model

The baseline is the mean of remaining ESPN projections adjusted for availability. When real usage snapshots exist, the model builds a position-specific latent opportunity score:

- WR/TE: target share, route participation, and air-yard share.
- RB: snap share, carry share, route participation, and target share.
- QB: team pass rate, scramble rate, and bounded designed rushing.

Recent opportunity is compared with prior opportunity. A rising or falling label requires at least moderate evidence and an eight-point normalized role movement; fantasy points alone never create a role trend. Usage, trend, and expected-versus-actual regression adjustments are collectively capped at +/-15%.

Efficiency adjustments are conservative: recent production gaps contribute only 15% of a bounded residual. Until walk-forward data demonstrates improvement, ESPN remains the dominant baseline.

## Market and mispricing

Available market inputs are renormalized rather than treated as fixed universal weights: projection anchor 35%, roster percentage 35%, start percentage 15%, recent scoring 10%, and decayed ADP up to 5%. ADP weight decays linearly from 1.0 in Week 1 toward a floor of 0.08 after Week 13.

Fundamental and market values are converted to league percentiles before calculating a standardized gap. A BUY LOW requires a gap of at least +0.65 standard deviations and no falling role. A SELL HIGH requires at most -0.65 and no rising role. Signal strength also uses confidence, roster fit, role stability, and market liquidity.

## Waivers and drop cost

Waiver evaluation retains exact V1 add/drop utility, then reports a separate adjusted value containing conservative ceiling option value and market-liquidity cost for the dropped player. Moves receive URGENT, STRONG MOVE, WORTH CONSIDERING, MARGINAL, or IGNORE labels. Unsupported breakout probabilities are not generated.

## History and backtesting

`intelligence_snapshots` is append-only by league, season, player, timestamp, and model version. It stores forecasts, fundamental and market estimates, optional usage, injuries, ownership, and later realized production. Queries require an exclusive as-of boundary. Walk-forward helpers calculate MAE, RMSE, rank correlation, and interval coverage without reading future records.

## Current limitations

ESPN does not expose route participation, target share, carries by situation, or other modern usage fields through the normalized endpoint. V3 supplies a usage-adapter contract and leaves these fields absent until a lawful source is connected. No manager learning, acceptance probability, Monte Carlo simulation, multi-hop trading, or automated ESPN transaction submission is included.

## Runtime architecture

Performance changes preserve V1 formulas and final V1 evaluation as the source of truth. Caches are scoped to a single immutable `LeagueSnapshot` object, and their canonical keys include roster membership/state, week and horizon, league settings, forecast contents/version, injury/bye state, engine configuration, and snapshot provenance.

Search precomputes every team baseline once. Exact lineup results and complete roster evaluations are memoized. Post-transaction weeks use an exact reduced assignment problem: the changed players' eligibility slots are expanded through the FLEX/OP connectivity graph, unaffected slot assignments are fixed, and the connected component is solved by the original exact DP. Invalid or fully connected cases fall back to the full solver. Depth removal scenarios use the same exact component method; the legacy full-depth path remains available as a test oracle.

Quick search evaluation reuses baseline lineups, indexed weekly forecasts, cached package-removal states, and cached baseline depth proxies. Required-drop searches are cached by the complete receiving roster state but still enumerate every legal drop combination on a cache miss. All caches naturally expire with the snapshot object, preventing cross-snapshot recommendation reuse.

Run `npm run benchmark:engine` while the local server is active to capture cold/repeat request timing, search counts, and per-function profile counters. An alternate endpoint can be supplied with `BENCHMARK_URL`.
