import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueIntelligence,
  estimateExpectedProduction,
  estimateRole,
  NflverseUsageProvider,
  NflverseHistoricalProvider,
  resolveExternalIdentity,
  shrinkRate,
  StatsGuyMarketProvider,
} from "../../src/engine/index";
import type {
  CanonicalPosition,
  LeaguePlayer,
  LeagueSnapshot,
  UsageSnapshot,
} from "../../src/engine/index";

const asOf = "2026-09-03T12:00:00.000Z";
function player(id: string, name: string, position: CanonicalPosition, team: string, mean = 12): LeaguePlayer {
  return {
    id, name, nflTeam: team, primaryPosition: position, eligiblePositions: [position],
    forecasts: [1, 2, 3].map((week) => ({ playerId: id, week, mean, lower: mean - 5, upper: mean + 5, availabilityProbability: 1, source: "test", asOf })),
    provenance: { source: "test", asOf, retrievedAt: asOf },
    externalIds: { espn: id },
  };
}
function snapshot(players: LeaguePlayer[], week = 6): LeagueSnapshot {
  const directory = Object.fromEntries(players.map((item) => [item.id, item]));
  return {
    id: "L", season: 2026, name: "V4", currentWeek: week,
    settings: {
      scoring: [{ statId: 53, points: 1, raw: {} }],
      lineupSlots: [
        { id: "qb", espnSlotId: 0, name: "QB", count: 1, kind: "active", eligiblePositions: ["QB"] },
        { id: "rb", espnSlotId: 2, name: "RB", count: 1, kind: "active", eligiblePositions: ["RB"] },
        { id: "wr", espnSlotId: 4, name: "WR", count: 1, kind: "active", eligiblePositions: ["WR"] },
        { id: "be", espnSlotId: 20, name: "BE", count: 4, kind: "bench", eligiblePositions: [] },
      ], rosterSize: 7, positionLimits: {}, irSlots: 0, playoffWeeks: [], raw: {},
    },
    teams: [{ id: "A", name: "A", ownerIds: [], record: { wins: 0, losses: 0, ties: 0 }, roster: players.slice(0, 3).map((item) => ({ playerId: item.id, assignedSlotId: 20, location: "bench" })) }],
    players: directory, freeAgentIds: players.slice(3).map((item) => item.id), waiverPlayerIds: [], schedule: [], primaryTeamId: "A", dataMode: "live",
    provenance: { source: "test", asOf, retrievedAt: asOf, version: "test" },
  };
}
function usage(playerId: string, week: number, targetShare: number, routeParticipation: number, actual = 10): UsageSnapshot {
  return { playerId, season: 2026, week, games: 1, metrics: { targetShare, routeParticipation, airYardShare: targetShare, targets: targetShare * 30, airYards: targetShare * 300, touchdowns: 0, actualFantasyPoints: actual }, provenance: { source: "test", asOf, retrievedAt: asOf } };
}

test("V4 role model requires sustained multi-indicator opportunity changes", () => {
  const rising = [1, 2, 3, 4].map((week) => usage("W", week, 0.25, 0.4));
  rising.push(usage("W", 5, 0.55, 0.82), usage("W", 6, 0.58, 0.86));
  assert.ok(["rising", "strongly_rising"].includes(estimateRole("WR", rising).trend));
  const falling = rising.map((item, index) => ({ ...item, metrics: { ...item.metrics, targetShare: index < 4 ? 0.6 : 0.2, routeParticipation: index < 4 ? 0.85 : 0.35 } }));
  assert.ok(["falling", "strongly_falling"].includes(estimateRole("WR", falling).trend));
  const spike = [1, 2, 3, 4].map((week) => usage("W", week, 0.25, 0.4));
  spike.push(usage("W", 5, 0.25, 0.4), usage("W", 6, 0.7, 0.9));
  assert.equal(estimateRole("WR", spike).trend, "stable");
  const scoreOnly = rising.map((item) => ({ ...item, metrics: { ...item.metrics, targetShare: 0.3, routeParticipation: 0.5, actualFantasyPoints: item.week > 4 ? 30 : 2 } }));
  assert.equal(estimateRole("WR", scoreOnly).trend, "stable");
});

test("xFP uses opportunity and shrinks touchdown conversion rather than treating points as destiny", () => {
  const lowTd = [1, 2, 3, 4, 5].map((week) => ({ playerId: "R", season: 2026, week, games: 1, metrics: { carries: 18, targets: 5, touchdowns: 0, actualFantasyPoints: 7 }, provenance: { source: "test", asOf, retrievedAt: asOf } }));
  const highTd = lowTd.map((item) => ({ ...item, metrics: { ...item.metrics, touchdowns: 2, actualFantasyPoints: 40 } }));
  const positive = estimateExpectedProduction("RB", lowTd);
  const negative = estimateExpectedProduction("RB", highTd);
  assert.equal(positive.regressionDirection, "positive");
  assert.equal(negative.regressionDirection, "negative");
  assert.ok(shrinkRate(3, 5, 0.05, 30) < 0.2, "small samples must regress sharply");
});

test("identity resolution refuses ambiguous or mismatched player mappings", () => {
  const ps = [player("1", "Chris Smith", "WR", "ATL"), player("2", "Chris Smith", "WR", "NYJ")];
  const directory = Object.fromEntries(ps.map((item) => [item.id, item]));
  assert.equal(resolveExternalIdentity({ id: "x", name: "Chris Smith", team: "ATL", position: "WR" }, directory).internalPlayerId, "1");
  assert.equal(resolveExternalIdentity({ id: "x", name: "Chris Smith", team: "DAL", position: "WR" }, directory).internalPlayerId, undefined);
  assert.equal(resolveExternalIdentity({ id: "x", espnId: "1", name: "Wrong", team: "NYJ", position: "WR" }, directory).internalPlayerId, undefined);
});

test("providers handle live-shaped payloads, partial fields, and failure without inventing mappings", async () => {
  const p = player("100", "Amon-Ra St. Brown", "WR", "DET");
  const league = snapshot([p], 2);
  const stats = "player_id,player_name,player_display_name,position,season,week,season_type,team,carries,targets,target_share,air_yards_share,receiving_air_yards,receiving_yards,receptions,receiving_tds,rushing_tds,fantasy_points_ppr\n00-1,A.St. Brown,Amon-Ra St. Brown,WR,2026,1,REG,DET,0,10,0.3,0.4,120,90,8,1,0,23\n";
  const identities = "gsis_id,espn_id\n00-1,100\n";
  const fetcher = async (url: string | URL) =>
    new Response(String(url) === "stats" ? stats : identities, { status: 200 });
  const usageProvider = new NflverseUsageProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats", playersUrl: "players" });
  const usageResult = await usageProvider.getLeagueUsage(league);
  assert.equal(usageResult.diagnostic.mapped, 1);
  assert.equal(usageResult.diagnostic.identityAttempts, 1);
  assert.equal(usageResult.diagnostic.identityFailures, 0);
  assert.equal(usageResult.usage["100"][0].metrics.targets, 10);
  const marketProvider = new StatsGuyMarketProvider(async () => new Response(JSON.stringify({ asOf, rankings: [{ id: "sl", name: "Amon-Ra St. Brown", team: "DET", position: "WR", rank: 3, value: 9000 }] }), { status: 200 }) as Response);
  const market = await marketProvider.getLeagueMarket(league);
  assert.equal(market.diagnostic.mapped, 1);
  const broken = new StatsGuyMarketProvider(async () => new Response("no", { status: 503 }) as Response);
  assert.equal((await broken.getLeagueMarket(league)).diagnostic.status, "unavailable");
});

test("historical and live nflverse providers use the same all-player team-carry denominator", async () => {
  const p = player("100", "Runner One", "RB", "DET");
  const league = snapshot([p], 2);
  const stats = "player_id,player_name,player_display_name,position,season,week,season_type,team,carries,targets,target_share,air_yards_share,fantasy_points_ppr\nrb-1,Runner One,Runner One,RB,2026,1,REG,DET,10,2,0.1,0,12\nfb-1,Full Back,Full Back,FB,2026,1,REG,DET,2,0,0,0,1\n";
  const identities = "gsis_id,espn_id\nrb-1,100\n";
  const fetcher = async (url: string | URL) => new Response(String(url) === "stats" ? stats : identities, { status: 200 });
  const historical = await new NflverseHistoricalProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats" }).getSeason(2026);
  const live = await new NflverseUsageProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats", playersUrl: "players" }).getLeagueUsage(league);
  assert.equal(historical.find(row => row.playerId === "rb-1")?.carryShare, 10 / 12);
  assert.equal(live.usage["100"][0].metrics.carryShare, 10 / 12);
});

test("independent market consensus is outlier-resistant and never changes fundamental forecasts", (context) => {
  context.mock.method(Date, "now", () => Date.parse(asOf));
  const ps = [player("1", "Alpha", "WR", "ATL", 15), player("2", "Beta", "WR", "NYJ", 10), player("3", "Gamma", "RB", "DET", 12)];
  const league = snapshot(ps);
  const baseline = buildLeagueIntelligence(league);
  const v4 = buildLeagueIntelligence(league, { marketSources: {
    "1": [{ playerId: "1", source: "independent", value: 82, reliability: 0.8, asOf, retrievedAt: asOf, independent: true }],
    "2": [
      { playerId: "2", source: "market-a", value: 70, reliability: 0.8, asOf, retrievedAt: asOf, independent: true },
      { playerId: "2", source: "outlier", value: 0, reliability: 0.8, asOf, retrievedAt: asOf, independent: true },
    ],
  } });
  assert.equal(v4.players["1"].fundamental.expectedPoints, baseline.players["1"].fundamental.expectedPoints);
  assert.ok(v4.players["1"].market.sufficientForMispricing);
  assert.ok(v4.players["2"].market.value > 5, "robust consensus limits a single extreme input");
});
