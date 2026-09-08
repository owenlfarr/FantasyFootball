CREATE TABLE IF NOT EXISTS `live_forecast_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `league_id` text NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `player_id` text NOT NULL,
  `generated_at` text NOT NULL,
  `source` text NOT NULL,
  `expected_points` real NOT NULL,
  `lower_points` real,
  `upper_points` real,
  `availability_probability` real,
  `injury_status` text,
  `model_version` text NOT NULL,
  `league_snapshot_version` text NOT NULL,
  `kickoff_time` text,
  `lock_state` text NOT NULL,
  `position` text,
  `artifact_version` text,
  `trained_through` text,
  `forecast_horizon` text,
  `feature_through_week` integer,
  `feature_data_as_of` text,
  `game_id` text,
  `capture_phase` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_live_forecasts_v8_lookup` ON `live_forecast_snapshots` (`league_id`,`season`,`week`,`player_id`,`source`,`generated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `player_outcomes` (
  `id` text PRIMARY KEY NOT NULL,
  `league_id` text NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `player_id` text NOT NULL,
  `fantasy_points` real NOT NULL,
  `active` integer NOT NULL,
  `game_completed_at` text NOT NULL,
  `position` text,
  `provenance_json` text NOT NULL
);
