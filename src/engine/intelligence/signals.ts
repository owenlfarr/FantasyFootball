import {
  acquisitionValue,
  createSearchCache,
} from "../search/characterizeAssets";
import type { LeaguePlayer, LeagueSnapshot } from "../types";
import type { LeagueIntelligence, PlayerSignal } from "./types";
import { isFallingTrend, isRisingTrend } from "./roleModel";

const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const fantasyPosition = (position: string) =>
  ["QB", "RB", "WR", "TE"].includes(position);

export function findBuyLowTargets(
  primaryTeamId: string,
  snapshot: LeagueSnapshot,
  intelligence: LeagueIntelligence,
): PlayerSignal[] {
  const cache = createSearchCache(snapshot, [primaryTeamId]),
    weeks = Math.max(
      1,
      cache.baseline.get(primaryTeamId)?.weeklyLineups.length ?? 1,
    );
  const opponentPlayers = snapshot.teams
    .filter((team) => team.id !== primaryTeamId)
    .flatMap((team) => team.roster)
    .map((entry) => snapshot.players[entry.playerId])
    .filter((player): player is LeaguePlayer => Boolean(player));
  return opponentPlayers
    .filter(
      (player) =>
        player.rosteredTeamId &&
        player.rosteredTeamId !== primaryTeamId &&
        fantasyPosition(player.primaryPosition),
    )
    .map((player) => {
      const intel = intelligence.players[player.id],
        rosterFit = Math.max(
          0,
          acquisitionValue(snapshot, primaryTeamId, player.id, cache) / weeks,
        ),
        fit = clamp(rosterFit / 5),
        gap = intel?.mispricingZ ?? 0;
      const roleFactor =
          isFallingTrend(intel?.role.trend ?? "unknown")
            ? 0
            : isRisingTrend(intel?.role.trend ?? "unknown")
              ? 1
              : 0.8,
        score =
          100 *
          clamp(
            (gap / 2) *
              intel.fundamental.confidence *
              intel.market.confidence *
              (0.55 + 0.45 * fit) *
              roleFactor,
          );
      return {
        playerId: player.id,
        signal: "BUY_LOW" as const,
        score: round(score),
        confidence: intel.confidence,
        rosterFit: round(rosterFit),
        marketGapZ: gap,
        reasons: [
          ...intel.evidence,
          `Adds approximately ${rosterFit.toFixed(1)} roster-utility units per evaluated week before trade cost.`,
        ],
        risks: intel.risks,
      };
    })
    .filter((signal) => signal.marketGapZ >= 0.65 && signal.score > 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

export function findSellHighCandidates(
  primaryTeamId: string,
  snapshot: LeagueSnapshot,
  intelligence: LeagueIntelligence,
): PlayerSignal[] {
  const cache = createSearchCache(snapshot, [primaryTeamId]),
    baseline = cache.baseline.get(primaryTeamId)!,
    weeks = Math.max(1, baseline.weeklyLineups.length),
    team = snapshot.teams.find((candidate) => candidate.id === primaryTeamId);
  return (team?.roster ?? [])
    .filter((entry) => {
      const player = snapshot.players[entry.playerId];
      return (
        fantasyPosition(player?.primaryPosition) &&
        !["OUT", "INJURY_RESERVE"].includes(player?.injuryStatus ?? "")
      );
    })
    .map((entry) => {
      const intel = intelligence.players[entry.playerId],
        marginal =
          (cache.removalMarginal.get(`${primaryTeamId}:${entry.playerId}`) ??
            0) / weeks,
        leverage = clamp(
          (intel.market.value - intel.fundamentalPercentile) / 30,
        ),
        rosterCostFactor = clamp(1 - marginal / 8, 0.15, 1),
        trendFactor = isRisingTrend(intel.role.trend) ? 0 : 1,
        score =
          100 *
          leverage *
          intel.market.confidence *
          rosterCostFactor *
          trendFactor;
      const partners = snapshot.teams
        .filter((candidate) => candidate.id !== primaryTeamId)
        .map((candidate) => ({
          id: candidate.id,
          value: acquisitionValue(
            snapshot,
            candidate.id,
            entry.playerId,
            cache,
          ),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((candidate) => candidate.id);
      return {
        playerId: entry.playerId,
        signal: "SELL_HIGH" as const,
        score: round(score),
        confidence: intel.confidence,
        rosterFit: round(marginal),
        marketGapZ: intel.mispricingZ ?? 0,
        reasons: [
          ...intel.evidence,
          `Costs your roster ${marginal.toFixed(1)} utility units per evaluated week if removed.`,
        ],
        risks: intel.risks,
        bestPartnerTeamIds: partners,
      };
    })
    .filter((signal) => signal.marketGapZ <= -0.65 && signal.score > 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
