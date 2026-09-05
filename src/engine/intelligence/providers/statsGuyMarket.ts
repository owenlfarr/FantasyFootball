import type { CanonicalPosition, LeagueSnapshot } from "../../types";
import type { MarketSourceObservation } from "../types";
import { resolveExternalIdentity } from "./identity";
import type { MarketDataProvider, MarketProviderResult } from "./types";

interface Ranking {
  rank?: number;
  id?: string;
  name?: string;
  team?: string;
  position?: string;
  positionRank?: number;
  value?: number;
}
interface RankingsResponse {
  asOf: string;
  rankings: Ranking[];
}
const fantasyPosition = (value: unknown): value is CanonicalPosition =>
  typeof value === "string" &&
  ["QB", "RB", "WR", "TE", "K", "D/ST", "HC"].includes(value);

export class StatsGuyMarketProvider implements MarketDataProvider {
  readonly name = "Stats Guy Fantasy";
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getLeagueMarket(snapshot: LeagueSnapshot): Promise<MarketProviderResult> {
    const retrievedAt = new Date().toISOString();
    try {
      const superflex = snapshot.settings.lineupSlots.some(
        (slot) =>
          slot.kind === "active" &&
          slot.eligiblePositions.includes("QB") &&
          slot.eligiblePositions.length > 1,
      );
      const format = superflex ? "sf_redraft" : "non_sf_redraft";
      const response = await this.fetcher(
        `https://api.statsguyfantasy.com/api/v1/rankings?format=${format}&limit=500`,
        { signal: AbortSignal.timeout(6_000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as RankingsResponse;
      const rankings = Array.isArray(body.rankings) ? body.rankings : [];
      const usable = rankings.filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.team === "string" &&
          fantasyPosition(item.position) &&
          typeof item.value === "number" &&
          Number.isFinite(item.value),
      ) as Array<Ranking & {
        id: string;
        name: string;
        team: string;
        position: CanonicalPosition;
        value: number;
      }>;
      const maximum = Math.max(1, ...usable.map((item) => item.value));
      const observations: Record<string, MarketSourceObservation[]> = {};
      let mapped = 0;
      for (const item of usable) {
        const resolved = resolveExternalIdentity(
          {
            id: item.id,
            name: item.name,
            team: item.team,
            position: item.position,
          },
          snapshot.players,
        );
        if (!resolved.internalPlayerId) continue;
        mapped++;
        observations[resolved.internalPlayerId] = [
          {
            playerId: resolved.internalPlayerId,
            sourcePlayerId: item.id,
            source: `${this.name} ${format}`,
            value: (100 * item.value) / maximum,
            rank: item.rank,
            positionRank: item.positionRank,
            reliability: 0.82,
            asOf: body.asOf || retrievedAt,
            retrievedAt,
            independent: true,
          },
        ];
      }
      const asOf = body.asOf || retrievedAt;
      const timestamp = Date.parse(asOf);
      const ageHours = Number.isFinite(timestamp)
        ? Math.max(0, (Date.now() - timestamp) / 36e5)
        : Infinity;
      return {
        observations,
        diagnostic: {
          provider: this.name,
          status: ageHours > 72 ? "stale" : mapped < usable.length * 0.5 ? "partial" : "available",
          asOf,
          retrievedAt,
          records: rankings.length,
          mapped,
          message: `${format}; ${usable.length}/${rankings.length} usable records; strict team/name/position identity resolution`,
        },
      };
    } catch (error) {
      return {
        observations: {},
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
