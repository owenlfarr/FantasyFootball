import type {
  IntelligenceHistoryRecord,
  IntelligenceHistoryStore,
  UsageSnapshot,
} from "../intelligence/types";
export class InMemoryIntelligenceHistoryStore
  implements IntelligenceHistoryStore
{
  private records: IntelligenceHistoryRecord[] = [];
  async append(records: IntelligenceHistoryRecord[]) {
    const keys = new Set(
      this.records.map(
        (r) =>
          `${r.leagueId}:${r.season}:${r.playerId}:${r.asOf}:${r.modelVersion}`,
      ),
    );
    for (const record of records) {
      const key = `${record.leagueId}:${record.season}:${record.playerId}:${record.asOf}:${record.modelVersion}`;
      if (!keys.has(key)) {
        this.records.push(structuredClone(record));
        keys.add(key);
      }
    }
  }
  async query(leagueId: string, season: number, asOfExclusive?: string) {
    return this.records
      .filter(
        (r) =>
          r.leagueId === leagueId &&
          r.season === season &&
          (!asOfExclusive || r.asOf < asOfExclusive),
      )
      .map((r) => structuredClone(r));
  }
}
export function historyRecordsForSnapshot(
  leagueId: string,
  season: number,
  week: number,
  asOf: string,
  players: Record<
    string,
    {
      fundamental: IntelligenceHistoryRecord["fundamental"];
      market: IntelligenceHistoryRecord["market"];
    }
  >,
  snapshotPlayers: Record<
    string,
    {
      forecasts: Array<{ week: number; mean: number }>;
      injuryStatus?: string;
      rosteredTeamId?: string;
      primaryPosition?: IntelligenceHistoryRecord["position"];
    }
  >,
  usage: Record<string, UsageSnapshot[]> = {},
): IntelligenceHistoryRecord[] {
  return Object.entries(players).map(([playerId, intel]) => ({
    leagueId,
    season,
    week,
    playerId,
    position: snapshotPlayers[playerId]?.primaryPosition,
    asOf,
    forecastMean:
      snapshotPlayers[playerId]?.forecasts.find((f) => f.week === week)?.mean ??
      0,
    fundamental: intel.fundamental,
    market: intel.market,
    role: (intel as { role?: IntelligenceHistoryRecord["role"] }).role,
    optionValue: (intel as { optionValue?: number }).optionValue,
    classification: (intel as { classification?: IntelligenceHistoryRecord["classification"] }).classification,
    usage: usage[playerId]?.at(-1),
    injuryStatus: snapshotPlayers[playerId]?.injuryStatus,
    rosteredTeamId: snapshotPlayers[playerId]?.rosteredTeamId,
    modelVersion: intel.fundamental.modelVersion,
  }));
}
