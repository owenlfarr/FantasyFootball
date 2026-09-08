# V5 trade plausibility and manager behavior

V5 adds a deal-plausibility layer above V1–V4. It never changes V1 roster utility, player forecasts, market value, opponent fit, or exact trade evaluation.

## Five independent layers

1. Fundamental value: forecasted player production.
2. Roster value: V1's exact marginal roster utility.
3. Market value: public/manager-facing perceived value.
4. Opponent roster fit: V2's exact impact on the other roster.
5. Deal plausibility: whether the package appears reasonable to this manager.

## Generic plausibility

The deterministic score begins at 50 and adds bounded terms:

`opponent benefit + market fairness + need filled - star-loss friction - package friction - required-drop burden - OP-QB scarcity`

Opponent benefit uses the existing opponent-fit score and starter gain. A package that gives the opponent more market value or fills a need helps. A top-tier player leaving for several lesser assets, a cumbersome multi-player package, a required drop, or an OP quarterback leaving reduces plausibility. The result is a five-band label, not an acceptance percentage.

## Manager behavior

Only actual outcomes train a manager profile:

- `generated` and `sent` alone: no training evidence.
- `accepted`: positive evidence.
- `rejected`: weak negative evidence.
- `ignored`: very weak negative evidence.
- `countered`: strong revealed-preference evidence.

Profiles are shrunk heavily to the league prior. No depth/star preference is emitted from a single outcome; manager adjustments are clamped to ±12 points. Each observation decays with a 90-day half-life-like exponential window, so current redraft behavior dominates old data. Structured manual notes remain separate, visible, and small in effect.

## Persistence

`trade_offers` is immutable offer metadata. `trade_offer_events` is append-only outcome history, so changing a status adds an event rather than overwriting the old result. `manager_notes` stores optional manual tags and reluctant/available player flags. ESPN's transaction view is parsed only when it has a recognizable executed two-direction player trade; otherwise it is ignored rather than guessed.

## Ranking and offer ladders

Pursuit score now includes a 15% plausibility component after team impact remains dominant. A high-plausibility but low-impact deal cannot outrank a weak V1 transaction threshold. Strong but difficult offers remain visible as `HIGH_UPSIDE`.

Target-player search exposes an opening, balanced, strong, and maximum offer frontier. Each candidate still obeys the V1 negative-utility boundary; plausibility can never justify paying beyond that boundary.

## Calibration

Offer events provide future calibration inputs by plausibility band: accepted/rejected/countered/ignored counts, ranking discrimination, and eventually Brier score when a calibrated probability model is appropriate. Generated offers and self-selected sent offers create selection bias, so observed conversion rates must not be presented as league-wide acceptance probabilities.

## Current limitation

This league currently has little or no recorded recipient behavior. V5 therefore mostly uses the generic model and marks manager confidence low. It does not display acceptance percentages or claim to know an individual manager's psychology.
