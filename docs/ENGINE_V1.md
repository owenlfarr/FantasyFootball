# Fantasy Command Center Intelligence Engine V1

## Purpose and flow

V1 answers one reproducible question: how does a roster or transaction change the best legal lineup for this league, in these weeks, using the forecasts in this snapshot? It never adds generic trade-chart values and never uses an LLM for numerical decisions.

`normalizeEspnLeague` converts ESPN settings, all teams, rosters, schedule, scoring items, and available players into `LeagueSnapshot`. `validateLeagueSnapshot` returns `READY` or `ENGINE_NOT_READY`; unknown slots and malformed data fail explicitly. Forecasts carry provenance, mean, interval, and availability. `optimizeLineup` assigns the best legal lineup. `evaluateRoster` repeats that operation by week. Trade and add/drop evaluators apply real roster changes, required drops included, before evaluating both states.

## Exact lineup optimizer

Every active slot is expanded into instances. Eligible player-to-slot edges have weight `forecast mean × availability probability`. Dynamic programming iterates players and tracks filled-slot bitmasks, so each player is used at most once while the state space remains approximately `2^starting slots`. It considers every feasible assignment, including FLEX and multi-position conflicts, and matches brute-force enumeration. Bench and IR are not active slots; explicit byes and unavailable players are excluded.

## Roster utility

The default configuration is:

`U = 1.00 × all remaining starter points + 0.25 × playoff starter points + 0.50 × scenario depth value - 0.75 × vulnerability penalty`

The playoff term is an additional premium; playoff weeks also retain their baseline value in all remaining points. The premium is omitted when playoff weeks are unavailable. Weights live in `DEFAULT_UTILITY_CONFIG`. V1 has no public market value, name value, or explicit star bonus.

## Depth, resilience, and marginal value

For every optimized starter in every week, V1 removes that starter and re-optimizes. Production recovered by another player is depth value; unrecovered production is vulnerability. Both are weighted by configurable position-level missed-game approximations. Injury resilience is recovered value divided by recovered plus exposed value.

Removal value is `U(roster) - U(roster without player)`. Addition value is calculated through add/drop evaluation, which searches for the best legal drop when full. Consolidation emerges from scarce starting slots: bench-only production contributes through scenarios, while an elite starter upgrade contributes every week.

## Transactions and explanations

`evaluateTrade` supports asymmetric packages, exact required-drop selection, positional limits, illegal-lineup detection, weekly and playoff deltas, depth/resilience deltas, positional changes, and deterministic explanation factors for both teams. Opponent output is limited to fit descriptors with low confidence; V1 does not claim acceptance percentages.

`evaluateAddDrop` and `findBestDropForAdd` use the same evaluator. The latter checks every legal drop candidate and chooses the greatest post-move utility.

## Safety and provenance

Live ESPN failures return `ENGINE_NOT_READY`. The UI may retain mock rows for layout continuity, but labels them `MOCK DATA`, suppresses computed strength/projection, and marks recommendation panels `DEMO`. Snapshots and forecasts include source and timestamps for future backtesting.

## Intentional limitations

- ESPN private-session cookies can expire; ESPN is an unofficial integration.
- V1 uses ESPN weekly projections, not usage, role-change, or market models.
- Forecast intervals use conservative position defaults because historical residual data is not yet bundled.
- Byes are exact when supplied; a separate NFL schedule feed is not yet normalized.
- There is no automatic trade/waiver search, market or acceptance model, FAAB bids, Monte Carlo, manager learning, or multi-hop trading.
- Unknown ESPN specialty slots fail validation rather than being guessed.

Future systems should reuse `optimizeLineup`, `evaluateRoster`, `marginalValue`, `evaluateTrade`, `evaluateAddDrop`, and `findBestDropForAdd` without importing React.
