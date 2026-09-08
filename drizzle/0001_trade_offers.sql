CREATE TABLE `trade_offers` (
  `id` text PRIMARY KEY NOT NULL,
  `league_id` text NOT NULL,
  `season` integer NOT NULL,
  `sender_team_id` text NOT NULL,
  `recipient_team_id` text NOT NULL,
  `players_sent_json` text NOT NULL,
  `players_received_json` text NOT NULL,
  `created_at` text NOT NULL,
  `source` text NOT NULL,
  `snapshot_version` text NOT NULL
  ,`plausibility_json` text
);
--> statement-breakpoint
CREATE INDEX `idx_trade_offers_league` ON `trade_offers` (`league_id`,`season`,`recipient_team_id`);
--> statement-breakpoint
CREATE TABLE `trade_offer_events` (`id` text PRIMARY KEY NOT NULL, `offer_id` text NOT NULL, `status` text NOT NULL, `occurred_at` text NOT NULL, `counter_offer_id` text, `note` text);
--> statement-breakpoint
CREATE TABLE `manager_notes` (`id` text PRIMARY KEY NOT NULL, `league_id` text NOT NULL, `season` integer NOT NULL, `team_id` text NOT NULL, `created_at` text NOT NULL, `text` text NOT NULL, `tags_json` text NOT NULL, `reluctant_player_ids_json` text, `available_player_ids_json` text);
