# V6: Historical Forecast Calibration

V6 is an offline, strict-as-of calibration layer. It does not train within a live ESPN request and it does not alter V1 roster utility, market value, opponent fit, or manager plausibility.

`NflverseHistoricalProvider` supplies completed regular-season weekly player statistics under nflverse's CC-BY-4.0 data release. The current source supplies PPR points, targets/shares, carries, air-yard share, passing attempts, and touchdowns. It does **not** supply historical ESPN weekly projection snapshots, reliable historical injuries, routes/snaps, red-zone usage, or a timestamped historical market feed. Therefore its results are labelled **internal role-model validation**, not a claim that V6 beats ESPN.

`buildStrictAsOfDataset` makes one row immediately before each target week. All feature weeks must be less than the prediction week; `assertAsOfRow` throws on any violation. Targets are conditional on a meaningful active appearance, so absent/inactive games are never silently encoded as zero production.

The offline script is `npm run backtest:v6 -- --seasons=2022,2023,2024,2025`. It uses chronological splits (2022–23 train, 2024 validation reserved, 2025 test), position-specific ridge models, and next-week/next-three/next-five-active-game targets. Feature families are ablated: production baseline, usage, trend/stability, and regression. The historical provider has no equivalent environment fields, so environment is intentionally excluded rather than fabricated.

V6 emits interpretable coefficients, residual uncertainty and empirical 80% interval coverage. `modelRegistry.ts` implements champion/challenger selection: V6 cannot replace ESPN/V4 unless it has a direct historical ESPN comparison, improves Spearman correlation by at least .01, and does not worsen MAE by more than .15 points. Until then V4 remains the live champion and V6 predictions are persisted/inspectable challenger output only.

Future extension points: append timestamped ESPN forecasts and actuals every live week; then train a validated ESPN-plus-role blend, estimate availability separately, calibrate market mispricing, and feed model distributions into the future simulation engine.
