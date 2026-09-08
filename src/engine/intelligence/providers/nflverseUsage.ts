import type { CanonicalPosition, LeagueSnapshot } from "../../types";
import type { UsageSnapshot } from "../types";
import { optionalNumber, parseCsv, responseText } from "./csv";
import { resolveExternalIdentity } from "./identity";
import type { UsageDataProvider, UsageProviderResult } from "./types";
import { nflverseCarryShare, nflverseTeamCarryTotals } from "./nflverseStats";

interface NflverseOptions {
  compressed?: boolean;
  statsUrl?: (season: number) => string;
  playersUrl?: string;
}
const positions = new Set<CanonicalPosition>(["QB", "RB", "WR", "TE"]);
const defaultStatsUrl = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;
const defaultPlayersUrl =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv.gz";

export class NflverseUsageProvider implements UsageDataProvider {
  readonly name = "nflverse weekly player stats";
  private readonly options: Required<NflverseOptions>;
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    options: NflverseOptions = {},
  ) {
    this.options = {
      compressed: options.compressed ?? true,
      statsUrl: options.statsUrl ?? defaultStatsUrl,
      playersUrl: options.playersUrl ?? defaultPlayersUrl,
    };
  }

  async getLeagueUsage(snapshot: LeagueSnapshot): Promise<UsageProviderResult> {
    const retrievedAt = new Date().toISOString();
    const throughWeek = snapshot.currentWeek - 1;
    if (throughWeek < 1)
      return {
        usage: {},
        diagnostic: {
          provider: this.name,
          status: "available",
          asOf: retrievedAt,
          retrievedAt,
          records: 0,
          mapped: 0,
          message: "No completed current-season week exists yet.",
        },
      };
    try {
      const [statsResponse, playersResponse] = await Promise.all([
        this.fetcher(this.options.statsUrl(snapshot.season), {
          signal: AbortSignal.timeout(8_000),
        }),
        this.fetcher(this.options.playersUrl, {
          signal: AbortSignal.timeout(8_000),
        }),
      ]);
      if (!statsResponse.ok) throw new Error(`stats HTTP ${statsResponse.status}`);
      if (!playersResponse.ok)
        throw new Error(`identity HTTP ${playersResponse.status}`);
      const [statsText, playersText] = await Promise.all([
        responseText(statsResponse, this.options.compressed),
        responseText(playersResponse, this.options.compressed),
      ]);
      const identityRows = parseCsv(playersText);
      const espnByGsis = new Map(
        identityRows
          .filter((row) => row.gsis_id && row.espn_id)
          .map((row) => [row.gsis_id, row.espn_id]),
      );
      const rows = parseCsv(statsText).filter(
        (row) =>
          row.season_type === "REG" &&
          Number(row.week) <= throughWeek &&
          Number(row.week) > 0,
      );
      const teamCarries = nflverseTeamCarryTotals(rows);
      const usage: Record<string, UsageSnapshot[]> = {};
      let mapped = 0;
      let identityAttempts = 0;
      let identityFailures = 0;
      const identityFailurePlayerIds = new Set<string>();
      for (const row of rows) {
        if (!positions.has(row.position as CanonicalPosition)) continue;
        identityAttempts++;
        const resolution = resolveExternalIdentity(
          {
            id: row.player_id,
            espnId: espnByGsis.get(row.player_id),
            name: row.player_display_name || row.player_name,
            team: row.team,
            position: row.position as CanonicalPosition,
          },
          snapshot.players,
        );
        if (!resolution.internalPlayerId) {
          identityFailures++;
          const espnId = espnByGsis.get(row.player_id);
          if (espnId && snapshot.players[espnId]) identityFailurePlayerIds.add(espnId);
          continue;
        }
        mapped++;
        const carries = optionalNumber(row.carries);
        const touchdowns =
          row.position === "QB"
            ? optionalNumber(row.passing_tds)
            : (optionalNumber(row.rushing_tds) ?? 0) +
              (optionalNumber(row.receiving_tds) ?? 0);
        const asOf = statsResponse.headers.get("last-modified") ?? retrievedAt;
        const item: UsageSnapshot = {
          playerId: resolution.internalPlayerId,
          season: snapshot.season,
          week: Number(row.week),
          games: 1,
          metrics: {
            targets: optionalNumber(row.targets),
            targetShare: optionalNumber(row.target_share),
            carries,
            carryShare: nflverseCarryShare(row, teamCarries),
            airYards: optionalNumber(row.receiving_air_yards),
            airYardShare: optionalNumber(row.air_yards_share),
            passAttempts: optionalNumber(row.attempts),
            receptions: optionalNumber(row.receptions),
            receivingYards: optionalNumber(row.receiving_yards),
            rushingYards: optionalNumber(row.rushing_yards),
            touchdowns,
            actualFantasyPoints: optionalNumber(row.fantasy_points_ppr),
          },
          provenance: {
            source: this.name,
            asOf,
            retrievedAt,
            version: `stats_player_week_${snapshot.season}`,
          },
        };
        usage[item.playerId] = [...(usage[item.playerId] ?? []), item];
      }
      const asOf = statsResponse.headers.get("last-modified") ?? retrievedAt;
      const ageHours = Math.max(0, (Date.now() - Date.parse(asOf)) / 36e5);
      return {
        usage,
        diagnostic: {
          provider: this.name,
          status: ageHours > 24 * 10 ? "stale" : mapped ? "available" : "partial",
          asOf,
          retrievedAt,
          records: rows.length,
          mapped,
          identityAttempts,
          identityFailures,
          identityFailurePlayerIds: [...identityFailurePlayerIds],
          message: "CC-BY-4.0; current-season weekly opportunity and production fields.",
        },
      };
    } catch (error) {
      return {
        usage: {},
        diagnostic: {
          provider: this.name,
          status: "unavailable",
          retrievedAt,
          records: 0,
          mapped: 0,
          message: error instanceof Error ? error.message : "provider failure",
        },
      };
    }
  }
}
