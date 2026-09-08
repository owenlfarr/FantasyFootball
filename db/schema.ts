import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const intelligenceSnapshots = sqliteTable(
  "intelligence_snapshots",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerId: text("player_id").notNull(),
    asOf: text("as_of").notNull(),
    modelVersion: text("model_version").notNull(),
    forecastMean: real("forecast_mean").notNull(),
    actualFuturePoints: real("actual_future_points"),
    injuryStatus: text("injury_status"),
    rosteredTeamId: text("rostered_team_id"),
    fundamentalJson: text("fundamental_json").notNull(),
    marketJson: text("market_json").notNull(),
    usageJson: text("usage_json"),
    intelligenceJson: text("intelligence_json"),
  },
  (table) => [
    uniqueIndex("uq_intelligence_snapshot_version").on(
      table.leagueId,
      table.season,
      table.playerId,
      table.asOf,
      table.modelVersion,
    ),
    index("idx_intelligence_player_history").on(
      table.leagueId,
      table.season,
      table.playerId,
      table.asOf,
    ),
  ],
);

export const tradeOffers = sqliteTable(
  "trade_offers",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id").notNull(),
    season: integer("season").notNull(),
    senderTeamId: text("sender_team_id").notNull(),
    recipientTeamId: text("recipient_team_id").notNull(),
    playersSentJson: text("players_sent_json").notNull(),
    playersReceivedJson: text("players_received_json").notNull(),
    createdAt: text("created_at").notNull(),
    source: text("source").notNull(),
    snapshotVersion: text("snapshot_version").notNull(),
    plausibilityJson: text("plausibility_json"),
  },
  (table) => [index("idx_trade_offers_league").on(table.leagueId, table.season, table.recipientTeamId)],
);

export const liveForecastSnapshots = sqliteTable("live_forecast_snapshots", {
  id: text("id").primaryKey(), leagueId:text("league_id").notNull(), season:integer("season").notNull(), week:integer("week").notNull(), playerId:text("player_id").notNull(), generatedAt:text("generated_at").notNull(), source:text("source").notNull(), expectedPoints:real("expected_points").notNull(), lowerPoints:real("lower_points"), upperPoints:real("upper_points"), availabilityProbability:real("availability_probability"), injuryStatus:text("injury_status"), modelVersion:text("model_version").notNull(), leagueSnapshotVersion:text("league_snapshot_version").notNull(), kickoffTime:text("kickoff_time"), lockState:text("lock_state").notNull(), position:text("position"), artifactVersion:text("artifact_version"), trainedThrough:text("trained_through"), forecastHorizon:text("forecast_horizon"), featureThroughWeek:integer("feature_through_week"), featureDataAsOf:text("feature_data_as_of"), gameId:text("game_id"), capturePhase:text("capture_phase"),
}, (table)=>[index("idx_live_forecasts_lookup").on(table.leagueId,table.season,table.week,table.playerId,table.source,table.generatedAt)]);
export const playerOutcomes = sqliteTable("player_outcomes", { id:text("id").primaryKey(), leagueId:text("league_id").notNull(), season:integer("season").notNull(), week:integer("week").notNull(), playerId:text("player_id").notNull(), fantasyPoints:real("fantasy_points").notNull(), active:integer("active").notNull(), gameCompletedAt:text("game_completed_at").notNull(), position:text("position"), provenanceJson:text("provenance_json").notNull() });
