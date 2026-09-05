import { canonicalPosition, canonicalSlot, slotKind } from "./espnMappings";
import type {
  DataMode,
  FantasyMatchup,
  LeaguePlayer,
  LeagueSnapshot,
  LeagueTeam,
  PlayerActual,
  PlayerForecast,
  ScoringRule,
} from "../types";

// Boundary-only representation for ESPN's unversioned JSON response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;
const nflTeams: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};
const residualSd: Record<string, number> = {
  QB: 6.5,
  RB: 6.8,
  WR: 7.2,
  TE: 5.4,
  K: 4.2,
  "D/ST": 5.0,
  HC: 3.0,
  UNKNOWN: 7.0,
};

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}
function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function availability(status?: string): number {
  if (!status || status === "ACTIVE" || status === "NORMAL") return 1;
  if (["OUT", "INJURY_RESERVE", "SUSPENSION"].includes(status)) return 0;
  if (status === "DOUBTFUL") return 0.25;
  if (status === "QUESTIONABLE") return 0.75;
  return 0.9;
}

function weeklyForecasts(
  player: AnyRecord,
  season: number,
  asOf: string,
): PlayerForecast[] {
  const position = canonicalPosition(number(player.defaultPositionId, -1));
  const sd = residualSd[position] ?? residualSd.UNKNOWN;
  return (Array.isArray(player.stats) ? player.stats : [])
    .filter(
      (stat: AnyRecord) =>
        number(stat.seasonId) === season &&
        number(stat.statSourceId) === 1 &&
        number(stat.statSplitTypeId) === 1 &&
        number(stat.scoringPeriodId) > 0,
    )
    .map((stat: AnyRecord) => {
      const mean = Math.max(0, number(stat.appliedTotal));
      return {
        playerId: String(player.id),
        week: number(stat.scoringPeriodId),
        mean,
        lower: Math.max(0, mean - 1.282 * sd),
        upper: mean + 1.282 * sd,
        availabilityProbability: availability(
          string(player.injuryStatus) || undefined,
        ),
        source: "ESPN projection",
        asOf,
        version: `espn-${season}`,
      };
    });
}

function weeklyActuals(
  player: AnyRecord,
  season: number,
  asOf: string,
): PlayerActual[] {
  return (Array.isArray(player.stats) ? player.stats : [])
    .filter(
      (stat: AnyRecord) =>
        number(stat.seasonId) === season &&
        number(stat.statSourceId) === 0 &&
        number(stat.statSplitTypeId) === 1 &&
        number(stat.scoringPeriodId) > 0,
    )
    .map((stat: AnyRecord) => ({
      playerId: String(player.id),
      week: number(stat.scoringPeriodId),
      points: number(stat.appliedTotal),
      stats: Object.fromEntries(
        Object.entries(record(stat.stats)).map(([key, value]) => [
          key,
          number(value),
        ]),
      ),
      source: "ESPN actual",
      asOf,
    }));
}

function normalizePlayer(
  rawPlayer: AnyRecord,
  season: number,
  asOf: string,
  rosteredTeamId?: string,
  waiverStatus?: LeaguePlayer["waiverStatus"],
): LeaguePlayer {
  const primaryPosition = canonicalPosition(
    number(rawPlayer.defaultPositionId, -1),
  );
  const eligible = new Set([primaryPosition]);
  for (const id of Array.isArray(rawPlayer.eligibleSlots)
    ? rawPlayer.eligibleSlots
    : []) {
    const slot = canonicalSlot(number(id), 1);
    // ESPN reports lineup slots a player may occupy, not extra positions.
    // Expanding OP/FLEX into every accepted position would make a QB
    // TE-eligible (and an RB WR-eligible). A single-position slot is the only
    // valid evidence here of true multi-position eligibility.
    if (slot?.eligiblePositions.length === 1)
      eligible.add(slot.eligiblePositions[0]);
  }
  return {
    id: String(rawPlayer.id),
    name: string(rawPlayer.fullName, `Player ${rawPlayer.id}`),
    nflTeam: nflTeams[number(rawPlayer.proTeamId)] ?? "UNK",
    primaryPosition,
    eligiblePositions: [...eligible].filter(
      (position) => position !== "UNKNOWN",
    ),
    injuryStatus: string(rawPlayer.injuryStatus) || undefined,
    rosteredTeamId,
    waiverStatus: waiverStatus ?? (rosteredTeamId ? "ROSTERED" : "UNKNOWN"),
    forecasts: weeklyForecasts(rawPlayer, season, asOf),
    actuals: weeklyActuals(rawPlayer, season, asOf),
    market: {
      percentOwned: rawPlayer.ownership?.percentOwned,
      percentStarted: rawPlayer.ownership?.percentStarted,
      ownershipChange: rawPlayer.ownership?.deltaPercentage,
      averageDraftPosition: rawPlayer.ownership?.averageDraftPosition,
    },
    externalIds: { espn: String(rawPlayer.id) },
    provenance: {
      source: "ESPN",
      asOf,
      retrievedAt: asOf,
      version: `espn-${season}`,
    },
  };
}

export interface NormalizeEspnInput {
  raw: unknown;
  freeAgents?: unknown[];
  leagueId: string;
  season: number;
  primaryTeamId: string;
  dataMode?: DataMode;
  retrievedAt?: string;
}

export function normalizeEspnLeague(input: NormalizeEspnInput): LeagueSnapshot {
  const raw = record(input.raw);
  if (!raw.settings || !Array.isArray(raw.teams))
    throw new Error("Malformed ESPN response: settings or teams are missing.");
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const settings = record(raw.settings);
  const rosterSettings = record(settings.rosterSettings);
  const scheduleSettings = record(settings.scheduleSettings);
  const lineupCounts = record(rosterSettings.lineupSlotCounts);
  const unknownSlots: number[] = [];
  const lineupSlots = Object.entries(lineupCounts).flatMap(([id, value]) => {
    const count = number(value);
    if (!count) return [];
    const slot = canonicalSlot(Number(id), count);
    if (!slot) {
      unknownSlots.push(Number(id));
      return [];
    }
    return [slot];
  });
  if (unknownSlots.length)
    throw new Error(`Unknown ESPN lineup slot IDs: ${unknownSlots.join(", ")}`);
  const players: Record<string, LeaguePlayer> = {};
  const teams: LeagueTeam[] = raw.teams.map((rawTeam: AnyRecord) => {
    const teamId = String(rawTeam.id);
    const entries = Array.isArray(rawTeam.roster?.entries)
      ? rawTeam.roster.entries
      : [];
    const roster = entries.map((entry: AnyRecord) => {
      const p = record(entry.playerPoolEntry?.player);
      if (p.id !== undefined)
        players[String(p.id)] = normalizePlayer(
          p,
          input.season,
          retrievedAt,
          teamId,
          "ROSTERED",
        );
      const assignedSlotId = number(entry.lineupSlotId, -1);
      const location = slotKind(assignedSlotId);
      if (!location)
        throw new Error(
          `Unknown ESPN assigned lineup slot ID: ${assignedSlotId}`,
        );
      return { playerId: String(p.id), assignedSlotId, location };
    });
    const overall = record(rawTeam.record?.overall);
    return {
      id: teamId,
      name:
        string(rawTeam.name) ||
        `${string(rawTeam.location)} ${string(rawTeam.nickname)}`.trim() ||
        `Team ${teamId}`,
      abbreviation: string(rawTeam.abbrev) || undefined,
      ownerIds: Array.isArray(rawTeam.owners) ? rawTeam.owners.map(String) : [],
      record: {
        wins: number(overall.wins),
        losses: number(overall.losses),
        ties: number(overall.ties),
        pointsFor: number(overall.pointsFor),
      },
      roster,
      waiverRank: number(rawTeam.waiverRank) || undefined,
      faabRemaining:
        rawTeam.transactionCounter?.acquisitionBudgetSpent !== undefined
          ? Math.max(
              0,
              number(settings.acquisitionSettings?.acquisitionBudget) -
                number(rawTeam.transactionCounter.acquisitionBudgetSpent),
            )
          : undefined,
    };
  });
  const freeAgentIds: string[] = [];
  const waiverPlayerIds: string[] = [];
  for (const entryRaw of input.freeAgents ?? []) {
    const entry = record(entryRaw);
    const p = record(entry.player ?? entry.playerPoolEntry?.player);
    if (p.id === undefined) continue;
    const status = string(entry.status).toUpperCase();
    const waiverStatus = status === "WAIVERS" ? "WAIVERS" : "FREE_AGENT";
    const id = String(p.id);
    players[id] = normalizePlayer(
      p,
      input.season,
      retrievedAt,
      undefined,
      waiverStatus,
    );
    (waiverStatus === "WAIVERS" ? waiverPlayerIds : freeAgentIds).push(id);
  }
  const scoringItems = Array.isArray(settings.scoringSettings?.scoringItems)
    ? settings.scoringSettings.scoringItems
    : [];
  const scoring: ScoringRule[] = scoringItems.map((item: AnyRecord) => ({
    statId: number(item.statId, -1),
    points: number(item.points),
    overrides: record(item.pointsOverrides),
    raw: item,
  }));
  const regularSeasonWeeks =
    number(scheduleSettings.matchupPeriodCount) || undefined;
  const playoffLength = number(scheduleSettings.playoffMatchupPeriodLength, 1);
  const playoffTeamCount =
    number(scheduleSettings.playoffTeamCount) || undefined;
  const playoffStart = regularSeasonWeeks ? regularSeasonWeeks + 1 : undefined;
  const playoffWeeks =
    playoffStart && playoffTeamCount
      ? Array.from(
          {
            length:
              Math.max(1, Math.ceil(Math.log2(playoffTeamCount))) *
              playoffLength,
          },
          (_, i) => playoffStart + i,
        )
      : [];
  const positionLimits: Record<string, number> = {};
  for (const [id, limit] of Object.entries(
    record(rosterSettings.positionLimits),
  )) {
    const position = canonicalPosition(Number(id));
    if (position !== "UNKNOWN") positionLimits[position] = number(limit);
  }
  const schedule: FantasyMatchup[] = (
    Array.isArray(raw.schedule) ? raw.schedule : []
  ).map((matchup: AnyRecord) => ({
    week: number(matchup.matchupPeriodId),
    homeTeamId:
      matchup.home?.teamId === undefined
        ? undefined
        : String(matchup.home.teamId),
    awayTeamId:
      matchup.away?.teamId === undefined
        ? undefined
        : String(matchup.away.teamId),
    homeScore: matchup.home?.totalPoints,
    awayScore: matchup.away?.totalPoints,
  }));
  const acquisition = record(settings.acquisitionSettings);
  const trade = record(settings.tradeSettings);
  return {
    id: input.leagueId,
    season: input.season,
    name:
      string(settings.name) ||
      string(raw.name) ||
      `ESPN League ${input.leagueId}`,
    currentWeek:
      number(raw.scoringPeriodId) ||
      number(raw.status?.currentMatchupPeriod) ||
      1,
    settings: {
      scoring,
      receptionPoints: scoring.find((rule) => rule.statId === 53)?.points,
      lineupSlots,
      rosterSize: lineupSlots
        .filter((slot) => slot.kind !== "ir")
        .reduce((sum, slot) => sum + slot.count, 0),
      positionLimits,
      irSlots: lineupSlots
        .filter((slot) => slot.kind === "ir")
        .reduce((sum, slot) => sum + slot.count, 0),
      playoffTeamCount,
      playoffWeeks,
      regularSeasonWeeks,
      waiverSystem: string(acquisition.acquisitionType) || undefined,
      acquisitionLimit: number(acquisition.acquisitionLimit) || undefined,
      faabBudget: number(acquisition.acquisitionBudget) || undefined,
      tradeDeadline: number(trade.deadlineDate) || undefined,
      rosterLockMode: string(rosterSettings.rosterLocktimeType) || undefined,
      raw: settings,
    },
    teams,
    players,
    freeAgentIds,
    waiverPlayerIds,
    schedule,
    primaryTeamId: input.primaryTeamId,
    dataMode: input.dataMode ?? "live",
    provenance: {
      source: "ESPN Fantasy API",
      asOf: retrievedAt,
      retrievedAt,
      version: `espn-${input.season}`,
    },
  };
}
