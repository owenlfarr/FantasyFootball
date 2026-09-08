import { optimizeLineupIncremental } from "../lineup/optimizeLineup";
import { profileSync } from "../performance/profile";
import type {
  LeagueSnapshot,
  PlayerForecast,
  RosterEntry,
  RosterEvaluation,
} from "../types";
import type { LeagueIntelligence } from "../intelligence/types";
import type {
  QuickTeamImpact,
  QuickTradeEvaluation,
  TradePackage,
} from "./types";

const round = (v: number) => Math.round(v * 1000) / 1000;
function entry(snapshot: LeagueSnapshot, id: string): RosterEntry {
  const bench = snapshot.settings.lineupSlots.find((s) => s.kind === "bench");
  return {
    playerId: id,
    assignedSlotId: bench?.espnSlotId ?? -1,
    location: "bench",
  };
}
function weeks(snapshot: LeagueSnapshot) {
  const end = Math.max(
    snapshot.currentWeek,
    snapshot.settings.regularSeasonWeeks ?? snapshot.currentWeek,
    ...snapshot.settings.playoffWeeks,
    ...Object.values(snapshot.players).flatMap((p) =>
      p.forecasts.map((f) => f.week),
    ),
  );
  return Array.from(
    { length: end - snapshot.currentWeek + 1 },
    (_, i) => snapshot.currentWeek + i,
  );
}
interface QuickIndex {
  weeks: number[];
  forecasts: Map<number, Map<string, PlayerForecast>>;
}
const quickIndexes = new WeakMap<LeagueSnapshot, QuickIndex>();
const removalPackages = new WeakMap<
  LeagueSnapshot,
  Map<string, RosterEntry[]>
>();
const baselineDepth = new WeakMap<RosterEvaluation, number>();
function quickIndex(snapshot: LeagueSnapshot): QuickIndex {
  const cached = quickIndexes.get(snapshot);
  if (cached) return cached;
  const searchWeeks = weeks(snapshot);
  const index = {
    weeks: searchWeeks,
    forecasts: new Map(
      searchWeeks.map((week) => [
        week,
        new Map(
          Object.values(snapshot.players).flatMap((player) => {
            const forecast = player.forecasts.find(
              (item) => item.week === week,
            );
            return forecast ? [[player.id, forecast] as const] : [];
          }),
        ),
      ]),
    ),
  };
  quickIndexes.set(snapshot, index);
  return index;
}
function removePackage(
  snapshot: LeagueSnapshot,
  teamId: string,
  roster: RosterEntry[],
  outgoing: string[],
) {
  const cache =
    removalPackages.get(snapshot) ?? new Map<string, RosterEntry[]>();
  if (!removalPackages.has(snapshot)) removalPackages.set(snapshot, cache);
  const key = `${teamId}|${[...outgoing].sort().join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const ids = new Set(outgoing);
  const removed = roster.filter((entry) => !ids.has(entry.playerId));
  cache.set(key, removed);
  return removed;
}
function average(snapshot: LeagueSnapshot, id: string) {
  const f =
    snapshot.players[id]?.forecasts.filter(
      (x) => x.week >= snapshot.currentWeek,
    ) ?? [];
  return f.length
    ? f.reduce((s, x) => s + x.mean * x.availabilityProbability, 0) / f.length
    : 0;
}
function dropCost(
  snapshot: LeagueSnapshot,
  id: string,
  intelligence?: LeagueIntelligence,
) {
  const p = snapshot.players[id];
  const option = intelligence?.players[id]?.optionValue ?? 0;
  const market = intelligence?.players[id]?.market;
  return (
    average(snapshot, id) +
    0.45 * option +
    (market?.sufficientForMispricing
      ? 0.015 * (market.value * market.confidence)
      : 0) +
    (p?.injuryStatus === "INJURY_RESERVE" ? -2 : 0)
  );
}
function normalize(
  snapshot: LeagueSnapshot,
  roster: RosterEntry[],
  intelligence?: LeagueIntelligence,
) {
  const excess =
    roster.filter((r) => r.location !== "ir").length -
    snapshot.settings.rosterSize;
  if (excess <= 0) return { roster, drops: [] as string[] };
  const candidates = roster
    .filter((r) => r.location !== "ir")
    .sort(
      (a, b) =>
        dropCost(snapshot, a.playerId, intelligence) -
          dropCost(snapshot, b.playerId, intelligence) ||
        a.playerId.localeCompare(b.playerId),
    );
  const drops = candidates.slice(0, excess).map((r) => r.playerId);
  return { roster: roster.filter((r) => !drops.includes(r.playerId)), drops };
}
function summarize(
  snapshot: LeagueSnapshot,
  baselineRoster: RosterEntry[],
  roster: RosterEntry[],
  baseline: RosterEvaluation,
  intelligence?: LeagueIntelligence,
): QuickTeamImpact {
  const normalized = normalize(snapshot, roster, intelligence);
  let starter = 0,
    depth = 0,
    legal = true;
  const index = quickIndex(snapshot);
  for (const week of index.weeks) {
    const forecasts = index.forecasts.get(week)!;
    const baselineLineup = baseline.weeklyLineups.find(
      (lineup) => lineup.week === week,
    );
    const lineup = baselineLineup
      ? optimizeLineupIncremental(
          baselineRoster,
          baselineLineup,
          normalized.roster,
          week,
          forecasts,
          snapshot.settings,
          snapshot.players,
        )
      : optimizeLineupIncremental(
          baselineRoster,
          {
            week,
            legal: false,
            projectedPoints: 0,
            assignments: [],
            benchPlayerIds: [],
            missingSlots: [],
            warnings: [],
          },
          normalized.roster,
          week,
          forecasts,
          snapshot.settings,
          snapshot.players,
        );
    starter += lineup.projectedPoints;
    legal &&= lineup.legal;
    const bench = lineup.benchPlayerIds
      .map((id) => ({ id, points: forecasts.get(id)?.mean ?? 0 }))
      .sort((a, b) => b.points - a.points);
    depth += bench
      .slice(0, 4)
      .reduce((sum, item) => sum + item.points * 0.04, 0);
  }
  const baselineStarter = baseline.expectedRemainingStarterPoints;
  let baselineDepthValue = baselineDepth.get(baseline);
  if (baselineDepthValue === undefined) {
    baselineDepthValue = baseline.weeklyLineups.reduce(
      (sum, lineup) =>
        sum +
        lineup.benchPlayerIds
          .map(
            (id) =>
              quickIndex(snapshot).forecasts.get(lineup.week)?.get(id)?.mean ??
              0,
          )
          .sort((a, b) => b - a)
          .slice(0, 4)
          .reduce((s, v) => s + v * 0.04, 0),
      0,
    );
    baselineDepth.set(baseline, baselineDepthValue);
  }
  const starterDelta = starter - baselineStarter,
    depthProxyDelta = depth - baselineDepthValue;
  return {
    legal,
    starterDelta: round(starterDelta),
    depthProxyDelta: round(depthProxyDelta),
    utilityDelta: round(starterDelta + 0.35 * depthProxyDelta),
    requiredDropIds: normalized.drops,
  };
}
export function quickEvaluateTrade(
  snapshot: LeagueSnapshot,
  trade: TradePackage,
  baselines: ReadonlyMap<string, RosterEvaluation>,
  intelligence?: LeagueIntelligence,
): QuickTradeEvaluation {
  return profileSync("quickEvaluateTrade", () => {
    const a = snapshot.teams.find((t) => t.id === trade.teamAId),
      b = snapshot.teams.find((t) => t.id === trade.teamBId);
    if (!a || !b) throw new Error("Trade teams are unavailable.");
    const aRemoved = removePackage(snapshot, a.id, a.roster, trade.teamAGives),
      bRemoved = removePackage(snapshot, b.id, b.roster, trade.teamBGives);
    const ar = [
      ...aRemoved,
      ...trade.teamBGives.map((id) => entry(snapshot, id)),
    ];
    const br = [
      ...bRemoved,
      ...trade.teamAGives.map((id) => entry(snapshot, id)),
    ];
    const primary = summarize(
        snapshot,
        a.roster,
        ar,
        baselines.get(a.id)!,
        intelligence,
      ),
      opponent = summarize(
        snapshot,
        b.roster,
        br,
        baselines.get(b.id)!,
        intelligence,
      );
    return {
      legal: primary.legal && opponent.legal,
      primary,
      opponent,
      score: round(primary.utilityDelta + 0.55 * opponent.utilityDelta),
    };
  });
}
