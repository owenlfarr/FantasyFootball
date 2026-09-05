# V4 player intelligence

V4 improves the inputs to the existing deterministic roster engine. It does not alter the V1 lineup optimizer, roster-utility formula, transaction evaluator, opponent fit, or final waiver/trade ranking rules.

## Independent layers

- **Fundamental value** is a conservative forecast of future scoring.
- **Roster-relative value** remains the V1 utility difference after adding or removing a player from a particular roster.
- **Market value** represents manager-facing value and is never included in roster utility.
- **Opponent fit** remains the V2/V3 transaction-side roster assessment.

This separation means a popular player cannot make a bad roster move look good, and a strong forecast cannot be presented as a likely accepted offer.

## Data adapters

`NflverseUsageProvider` maps nflverse player-week data through stable GSIS-to-ESPN identity mappings when completed current-season weeks exist. It supplies targets, target share, carries, carry share, air-yard share, attempts, touchdowns, and actual PPR scoring where available. nflverse does not supply every desired route, snap, or red-zone field in this adapter, so absent fields remain absent.

`StatsGuyMarketProvider` obtains a timestamped redraft or superflex-redraft ranking feed and maps it strictly by stable ID where available, then exact normalized name/team/position. Ambiguous or mismatched identities are rejected. The feed is a separate market input, not a forecast source.

Provider diagnostics are returned with every live snapshot. A failed, stale, or partial provider lowers confidence and never fabricates data. At Week 1, current-season usage is correctly reported as unavailable rather than inferred from prior fantasy points.

## Fundamental forecast

For each player, the forecast starts with ESPN's available rest-of-season weekly projection mean:

`fundamental = ESPN baseline × (1 + capped(role + trend + regression adjustment))`

The combined adjustment is capped at ±12% and is then bounded at ±15% when applied to ESPN week-level forecasts. The role component is capped at ±8%; a sustained rising/falling opportunity trend contributes ±2.5% (±4% for strong evidence); the opportunity-based regression component is capped at ±6%. ESPN remains dominant unless validated usage evidence is present.

Player uncertainty starts from the projection interval and expands for injury status, limited role evidence, and changing roles. It produces a median, 80%-style lower/upper interval, and a distinct confidence band. These intervals are estimates, not guarantees.

## Role and expected-production models

Role trends use opportunity only, never fantasy points. The model compares the recent two games with the prior two-to-four games and requires at least two coherent indicators before labeling a trend.

- WR/TE opportunity: route participation, target share, and air-yard share.
- RB opportunity: snap share, carry share, route participation, and target share.
- QB opportunity: pass attempts, rushing involvement, scrambles, and team pass tendency.

Expected PPR production uses conservative position-specific opportunity rates. Touchdown rates, catch rate, and efficiency are shrunk toward position priors using an empirical-Bayes opportunity weight, so a small touchdown burst cannot dominate the forecast. High-value red-zone fields are additive only when separately available, avoiding double counting.

## Market model and signals

Market observations are normalized to a 0–100 scale and combined with a robust weighted mean: values are centered on the weighted median and individual inputs are clipped to a 25-point deviation. ESPN roster/start/recent/ADP signals remain weak market anchors; the external Stats Guy observation is independent and given validated freshness/reliability weight. Mispricing requires at least one independent observation.

Buy-low and sell-high signals remain structured evidence, not generic labels:

- Buy low requires positive standardized fundamental-minus-market gap, roster fit, adequate confidence, and no falling role.
- Sell high requires the reverse gap and no rising-role evidence.

No signal is emitted if data is insufficient. Search uses intelligence only to prioritize candidate pools; every displayed trade or add/drop still receives exact V1 evaluation.

## History and calibration

The append-only intelligence store persists timestamped forecasts, market estimates, usage, role, option value, classification, injury state, ownership, position, and model version. Walk-forward APIs query only records strictly before the prediction time. Validation reports MAE, RMSE, rank correlation, interval coverage, and baseline comparison by position when scored future outcomes exist.

There is not yet enough current-season history to claim V4 beats ESPN. Until walk-forward results demonstrate an improvement, ESPN remains the forecast anchor and V4 adjustments remain conservative.

## Deferred work

V4 intentionally does not implement Monte Carlo season simulation, calibrated trade acceptance probability, manager behavior learning, multi-hop trades, exhaustive trade changes, automated transactions, paid forecast dependencies, or LLM numerical evaluation.
