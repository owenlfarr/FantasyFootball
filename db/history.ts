import { env } from "cloudflare:workers";
import type { IntelligenceHistoryRecord } from "../src/engine/intelligence/types";

let initialized = false;
async function ensure() {
  if (initialized || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS intelligence_snapshots (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL, player_id TEXT NOT NULL, as_of TEXT NOT NULL, model_version TEXT NOT NULL, forecast_mean REAL NOT NULL, actual_future_points REAL, injury_status TEXT, rostered_team_id TEXT, fundamental_json TEXT NOT NULL, market_json TEXT NOT NULL, usage_json TEXT, intelligence_json TEXT)",
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_snapshot_version ON intelligence_snapshots (league_id, season, player_id, as_of, model_version)",
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_intelligence_player_history ON intelligence_snapshots (league_id, season, player_id, as_of)",
    ),
  ]);
  try {
    await env.DB.prepare(
      "ALTER TABLE intelligence_snapshots ADD COLUMN intelligence_json TEXT",
    ).run();
  } catch {
    // Existing databases already containing the append-only V4 column are valid.
  }
  initialized = true;
}
const id = (r: IntelligenceHistoryRecord) =>
  `${r.leagueId}:${r.season}:${r.playerId}:${r.asOf}:${r.modelVersion}`;
export async function appendIntelligenceHistory(
  records: IntelligenceHistoryRecord[],
): Promise<void> {
  if (!env.DB || !records.length) return;
  await ensure();
  const statements = records.map((r) =>
    env
      .DB!.prepare(
        "INSERT OR IGNORE INTO intelligence_snapshots (id, league_id, season, week, player_id, as_of, model_version, forecast_mean, actual_future_points, injury_status, rostered_team_id, fundamental_json, market_json, usage_json, intelligence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id(r),
        r.leagueId,
        r.season,
        r.week,
        r.playerId,
        r.asOf,
        r.modelVersion,
        r.forecastMean,
        r.actualFuturePoints ?? null,
        r.injuryStatus ?? null,
        r.rosteredTeamId ?? null,
        JSON.stringify(r.fundamental),
        JSON.stringify(r.market),
        r.usage ? JSON.stringify(r.usage) : null,
        JSON.stringify({
          role: r.role,
          optionValue: r.optionValue,
          classification: r.classification,
          position: r.position,
        }),
      ),
  );
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
}
export async function loadIntelligenceHistory(
  leagueId: string,
  season: number,
  asOfExclusive: string,
): Promise<IntelligenceHistoryRecord[]> {
  if (!env.DB) return [];
  await ensure();
  const rows = await env.DB.prepare(
    "SELECT league_id, season, week, player_id, as_of, model_version, forecast_mean, actual_future_points, injury_status, rostered_team_id, fundamental_json, market_json, usage_json, intelligence_json FROM intelligence_snapshots WHERE league_id = ? AND season = ? AND as_of < ? ORDER BY as_of ASC",
  )
    .bind(leagueId, season, asOfExclusive)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => {
    const extra = row.intelligence_json
      ? JSON.parse(String(row.intelligence_json))
      : {};
    return ({
    leagueId: String(row.league_id),
    season: Number(row.season),
    week: Number(row.week),
    playerId: String(row.player_id),
    asOf: String(row.as_of),
    modelVersion: String(row.model_version),
    forecastMean: Number(row.forecast_mean),
    actualFuturePoints:
      row.actual_future_points === null ||
      row.actual_future_points === undefined
        ? undefined
        : Number(row.actual_future_points),
    injuryStatus: row.injury_status ? String(row.injury_status) : undefined,
    rosteredTeamId: row.rostered_team_id
      ? String(row.rostered_team_id)
      : undefined,
    fundamental: JSON.parse(String(row.fundamental_json)),
    market: JSON.parse(String(row.market_json)),
    usage: row.usage_json ? JSON.parse(String(row.usage_json)) : undefined,
    role: extra.role,
    optionValue: extra.optionValue,
    classification: extra.classification,
    position: extra.position,
  });
  });
}
