# Fantasy Command Center Intelligence Engine V2

V2 adds deterministic candidate search above the V1 evaluator. Candidate heuristics decide what deserves expensive evaluation; they never replace `evaluateTrade` or `findBestDropForAdd` as the source of transaction value.

## Trade search pipeline

1. Validate the canonical snapshot. Missing live requirements return `ENGINE_NOT_READY` with no results.
2. Evaluate each league roster once and cache its baseline. The primary roster receives exact V1 removal marginals. Opponent assets use deterministic lineup-displacement estimates only for candidate pruning; every surviving transaction still receives a full V1 evaluation.
3. Characterize assets as `CORE`, `STARTER`, `REDUNDANT_VALUE`, `TRADE_CHIP`, or `DEPTH_PROTECTION` using starter frequency, marginal utility, depth contribution, and positional redundancy.
4. For each opponent, rank my assets by value to that opponent divided by cost to my roster. Rank their assets by acquisition value to me minus a conservative portion of their removal cost.
5. Build deterministic pools of 10 outgoing and 8 target assets. Eighty percent are priority selections and 20% are deterministic exploration selections.
6. Generate configurable 1-for-1, 2-for-1, 1-for-2, 2-for-2, and aggressively limited 3-for-1 packages. A 3-for-1 uses at most six non-core outgoing assets and three targets.
7. Reject duplicate packages, only-QB removal, near-zero acquisition value, and severe directional marginal imbalance. Sort by cheap mutual fit and retain at most 8 packages per opponent by default. This limit is configurable for offline analysis.
8. Run every survivor through V1 `evaluateTrade`. Reject illegal rosters, insufficient primary-team utility, severe opponent destruction, low opponent fit, and packages where a newly received player is immediately dropped.
9. Remove Pareto-dominated results across primary utility, opponent-fit score, and downside risk.
10. Normalize the frontier contextually and rank the final results.

## Opponent fit

Opponent fit is not acceptance probability. Values are converted to per-evaluated-week units, then:

`fit = clamp(50 + 8*starterImpact + 4*utilityImpact + 3*depthImpact + 8*fillsNeed - 18*criticalLoss - 4*dropBurden - 3*packageAsymmetry, 0, 100)`

Starter impact is clamped to +/-4, utility impact to +/-4, depth impact to +/-3, and drop burden to 0-5 before weighting. Bands are: very low `<20`, low `<40`, medium `<60`, high `<80`, and very high otherwise. The UI emphasizes the band.

## Team-fit ranking

After Pareto filtering, each metric is min-max normalized within the current result set:

`quality = .45*myUtility + .20*starterGain + .15*playoffGain + .15*opponentFit + .05*inverseDownside`

`Team Fit = round(35 + 65*quality)`

This is contextual, not universal trade value. Consolidation receives no ranking bonus. It is tagged only when the package sends more players than it receives; V1 must still show positive roster value.

## Target-player mode

`findOffersForTarget` calculates the target's exact marginal acquisition value to the primary roster. It then searches 1-for-1, 2-for-1, and 3-for-1 packages using assets ranked by opponent value divided by primary-roster cost. It returns distinct cheapest-fit, best-mutual-fit, consolidation, and aggressive styles when available. Targets adding less than 0.75 utility per evaluated week receive `DO_NOT_OVERPAY`.

## Waiver search

Available players are filtered to supported positions, usable injury status, roster eligibility, and non-zero future forecasts. Priority combines forecast, positional need, and availability; it is not projection-only. The default pool is 40 candidates with 20% deterministic exploration. Every candidate runs through V1 `findBestDropForAdd`, which finds the exact optimal required drop. Negative moves are removed and retained moves are contextually ranked by utility, starter impact, playoffs, depth, and need.

Supported evidence-based categories are immediate starter, bench upgrade, depth upgrade, bye coverage, injury insurance, and streamer. V2 does not claim speculative breakout probabilities.

## Performance and data state

Instrumentation reports opponents, naive combinations, generated packages, pruned candidates, full evaluations, Pareto results, and duration. The stress test approximates 12 teams, 17-player rosters, all five trade shapes, and 250 free agents, and asserts that pruning reduces full evaluations by more than 99% versus naive enumeration.

The ESPN endpoint caches a validated snapshot for 60 seconds. Its interactive search budget is one exact trade evaluation per opponent and five waiver candidates; callers can request broader searches directly through the engine API. This keeps the full multiweek depth model usable on the current edge runtime without weakening exact transaction evaluation. A later refresh failure may use the snapshot as `STALE`; without a validated snapshot the UI remains `NOT READY`. Mock rows remain visibly `MOCK` and never produce apparently live recommendations.

## Not implemented

V2 does not include acceptance probabilities, manager behavior, market values, buy-low/sell-high signals, Monte Carlo odds, FAAB strategy, multi-hop trades, ML, LLM numerical judgment, or ESPN transaction submission.
