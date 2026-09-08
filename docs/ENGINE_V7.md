# V7: Live Forecast Validation

V7 records immutable model-specific forecasts in `live_forecast_snapshots` and realized scoring outcomes in `player_outcomes`. `INSERT OR IGNORE` plus an ID that includes model, player, week, and generated timestamp preserves every prediction revision rather than overwriting it.

The live refresh invokes `captureForecastSnapshots` before recommendations are returned. It records ESPN and V4 separately. V6 is intentionally absent until a real serialized V6 model artifact is available; it is never faked by relabeling V4. Completed weekly ESPN actuals are appended on subsequent syncs, using the normalized league-scored point total. Inactive players are excluded from conditional-production accuracy and retained for future availability calibration.

`buildComparisonSets` enforces a common prediction deadline and requires all three models before a comparison becomes eligible. It excludes post-lock snapshots. Current ESPN league data does not provide per-player NFL kickoff timestamps, so the production route records `PRE_LOCK` snapshots but cannot yet create canonical kickoff comparison sets; kickoff enrichment is a required next integration.

Promotion is advisory only. V6 needs position-specific sample floors (QB 40, RB 100, WR 140, TE 60), at least +.015 Spearman over V4, no MAE regression beyond 3%, and wins in at least three of the latest four rolling windows. Even then, a configuration change is required: V7 never silently changes production forecasts.
