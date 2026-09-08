CREATE TABLE `intelligence_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`player_id` text NOT NULL,
	`as_of` text NOT NULL,
	`model_version` text NOT NULL,
	`forecast_mean` real NOT NULL,
	`actual_future_points` real,
	`injury_status` text,
	`rostered_team_id` text,
	`fundamental_json` text NOT NULL,
	`market_json` text NOT NULL,
	`usage_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_intelligence_snapshot_version` ON `intelligence_snapshots` (`league_id`,`season`,`player_id`,`as_of`,`model_version`);--> statement-breakpoint
CREATE INDEX `idx_intelligence_player_history` ON `intelligence_snapshots` (`league_id`,`season`,`player_id`,`as_of`);