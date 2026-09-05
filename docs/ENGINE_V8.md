# Engine V8 live forecast experiment

V6 is a shadow-only ridge challenger. The serialized bundle is
`artifacts/v6-ridge-2022-2025.json`, version `v6-bundle-1`, with twelve
`v6-ridge-1` models for QB/RB/WR/TE and next1/next3/next5 horizons. It uses
the seven shared features `seasonPpg`, `last3Ppg`, `ewmaPpg`, `volume`,
`targets`, `carries`, and `airYardShare`; missing scalar metrics are zero,
but fewer than two completed active games excludes a player.

Run `npm run capture:forecasts`. The command POSTs to
`FORECAST_CAPTURE_URL` (default `http://localhost:3000/api/capture-forecasts`)
and may send `FORECAST_CAPTURE_TOKEN`. The route captures ESPN, V4, and only
genuine V6 predictions. Rows include model/artifact/training and feature
cutoffs, NFL game/kickoff, lock state, and capture phase. Exact repeated rows
are ignored by their immutable ID; later timestamps remain append-only.

Week 1 with no completed current-season usage reports
`INSUFFICIENT_CURRENT_SEASON_FEATURES`; it does not fabricate usage. Lock
phases are `EARLY_WEEK`, `MID_WEEK`, `FINAL_PRELOCK`, and `POST_LOCK`.
Comparison sets require ESPN/V4/V6 rows that all precede the same kickoff
deadline. V6 never enters roster, trade, waiver, or buy/sell production logic.

Verification: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
`npm run train:v6`, and `npm run capture:forecasts` were executed. The live
capture returned the current Week 1 state with a READY artifact, 351 eligible
players, 334 mapped eligible kickoffs (17 unmapped), 340 ESPN rows, 351 V4 rows,
327 PRE_LOCK ESPN rows, 334 PRE_LOCK V4 rows, and zero V6 rows
with explicit insufficient-current-season-feature diagnostics. A live ESPN
request and nflverse schedule retrieval completed successfully; persistence
returned READY. The deterministic post-Week-1 fixture produced a genuine V6
PRE_LOCK row, persisted it idempotently, ingested an actual outcome, and
included it in a strict same-cutoff comparison. V6 remains shadow-only.

If the usage provider is unavailable, capture reports
`USAGE_PROVIDER_UNAVAILABLE` rather than treating the outage as missing player
history. Resolvable ESPN identity mismatches are reported per player as
`IDENTITY_MAPPING_FAILURE`; unattributable external rows remain in the aggregate
identity-failure count. Historical and live RB volume use the same shared
all-player team-carry denominator.
