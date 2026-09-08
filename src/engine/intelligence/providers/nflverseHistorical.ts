import { optionalNumber, parseCsv, responseText } from "./csv";
import type { CalibrationPosition, HistoricalWeeklyStat } from "../calibration";
import { nflverseCarryShare, nflverseTeamCarryTotals } from "./nflverseStats";

const positions = new Set<CalibrationPosition>(["QB", "RB", "WR", "TE"]);
const url = (season: number) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;

/** Historical regular-season stat provider used only by offline calibration. */
export class NflverseHistoricalProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: { compressed?: boolean; statsUrl?: (season: number) => string } = {},
  ) {}
  async getSeason(season: number): Promise<HistoricalWeeklyStat[]> {
    const response = await this.fetcher((this.options.statsUrl ?? url)(season), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`nflverse ${season}: HTTP ${response.status}`);
    const rows = parseCsv(await responseText(response, this.options.compressed ?? true));
    const regular = rows.filter(r => r.season_type === "REG" && Number(r.week) > 0);
    const teamCarries = nflverseTeamCarryTotals(regular);
    return regular
      .filter(r => positions.has(r.position as CalibrationPosition))
      .map(r => ({
        playerId: r.player_id, season, week: Number(r.week), position: r.position as CalibrationPosition,
        fantasyPoints: optionalNumber(r.fantasy_points_ppr), active: optionalNumber(r.fantasy_points_ppr) !== undefined,
        targets: optionalNumber(r.targets), targetShare: optionalNumber(r.target_share), carries: optionalNumber(r.carries), carryShare: nflverseCarryShare(r, teamCarries),
        airYardShare: optionalNumber(r.air_yards_share), passAttempts: optionalNumber(r.attempts),
        touchdowns: r.position === "QB" ? optionalNumber(r.passing_tds) : (optionalNumber(r.rushing_tds) ?? 0) + (optionalNumber(r.receiving_tds) ?? 0),
      }));
  }
  async getSeasons(seasons: number[]) { return (await Promise.all(seasons.map(s => this.getSeason(s)))).flat(); }
}
