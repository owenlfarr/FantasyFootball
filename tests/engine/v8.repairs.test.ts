import assert from "node:assert/strict";
import test from "node:test";
import artifactJson from "../../artifacts/v6-ridge-2022-2025.json";
import {
  captureLiveForecastExperiment,
  loadV6Artifact,
  type ForecastValidationStore,
  type LeaguePlayer,
  type LeagueSnapshot,
  type LiveForecastSnapshot,
  type PlayerIntelligence,
} from "../../src/engine";
import { NflverseHistoricalProvider } from "../../src/engine/intelligence/providers/nflverseHistorical";
import { NflverseUsageProvider } from "../../src/engine/intelligence/providers/nflverseUsage";

const at = "2026-09-05T10:00:00.000Z";
const kickoff = "2026-09-06T17:00:00.000Z";

const player = (id: string, name: string, position: "WR" | "RB" = "WR", team = "BUF"): LeaguePlayer => ({
  id, name, nflTeam: team, primaryPosition: position, eligiblePositions: [position],
  forecasts: [{ playerId: id, week: 3, mean: 10, lower: 5, upper: 15, availabilityProbability: 1, source: "ESPN", asOf: at, version: "espn" }],
  actuals: [], provenance: { source: "fixture", asOf: at, retrievedAt: at },
});

const snapshot = (players: Record<string, LeaguePlayer>): LeagueSnapshot => ({
  id: "v8-repair-fixture", season: 2026, currentWeek: 3, name: "Fixture", primaryTeamId: "t", dataMode: "live",
  players, freeAgentIds: Object.keys(players), waiverPlayerIds: [], schedule: [],
  teams: [{ id: "t", name: "T", ownerIds: [], record: { wins: 0, losses: 0, ties: 0 }, roster: [] }],
  settings: { scoring: [{ statId: 1, points: 1, raw: {} }], lineupSlots: [{ id: "wr", espnSlotId: 4, name: "WR", count: 1, kind: "active", eligiblePositions: ["WR"] }], rosterSize: 2, positionLimits: {}, irSlots: 0, playoffWeeks: [], raw: {} },
  provenance: { source: "fixture", asOf: at, retrievedAt: at, version: "fixture-v1" },
});

const intelligence = (players: Record<string, LeaguePlayer>) => Object.fromEntries(
  Object.values(players).map(p => [p.id, { fundamental: { expectedPoints: 11, floor: 6, ceiling: 16, modelVersion: "v4" } }]),
) as unknown as Record<string, PlayerIntelligence>;

const usage = (id: string, position: "WR" | "RB" = "WR") => ({
  [id]: [1, 2].map(week => ({ playerId: id, season: 2026, week, games: 1, metrics: {
    targets: position === "WR" ? 6 : 1, targetShare: position === "WR" ? .2 : .03,
    carries: position === "RB" ? 10 : 0, carryShare: position === "RB" ? .5 : 0,
    actualFantasyPoints: 10 + week,
  }, provenance: { source: "fixture", asOf: at, retrievedAt: at } })),
});

const store = (rows: LiveForecastSnapshot[] = []): ForecastValidationStore => ({
  appendForecasts: async xs => { for (const x of xs) if (!rows.some(y => y.id === x.id)) rows.push(x); },
  appendOutcomes: async () => {}, forecasts: async () => rows, outcomes: async () => [],
});

const game = (team: string, gameId = "g3") => ({ gameId, season: 2026, week: 3, homeTeam: team, awayTeam: "NYJ", kickoffAt: kickoff, status: "scheduled" as const });

test("historical and live RB carry share use the same all-team-carries denominator", async () => {
  const stats = "player_id,player_name,player_display_name,position,season,week,season_type,team,carries,targets,target_share,air_yards_share,fantasy_points_ppr\nrb-1,Runner One,Runner One,RB,2026,1,REG,DET,10,2,0.1,0,12\nfb-1,Full Back,Full Back,FB,2026,1,REG,DET,2,0,0,0,1\n";
  const identities = "gsis_id,espn_id\nrb-1,100\n";
  const fetcher = async (url: string | URL) => new Response(String(url) === "stats" ? stats : identities, { status: 200 });
  const historical = await new NflverseHistoricalProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats" }).getSeason(2026);
  const live = await new NflverseUsageProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats", playersUrl: "players" }).getLeagueUsage(snapshot({ "100": player("100", "Runner One", "RB", "DET") }));
  assert.equal(historical.find(row => row.playerId === "rb-1")?.carryShare, 10 / 12);
  assert.equal(live.usage["100"][0].metrics.carryShare, 10 / 12);
});

test("usage-provider identity failure is attributed to the affected player and not missing history", async () => {
  const p = player("100", "Runner One", "RB", "DET");
  const stats = "player_id,player_name,player_display_name,position,season,week,season_type,team,carries,targets,target_share,air_yards_share,fantasy_points_ppr\nrb-1,Runner One,Runner One,RB,2026,1,REG,BUF,10,2,0.1,0,12\n";
  const identities = "gsis_id,espn_id\nrb-1,100\n";
  const fetcher = async (url: string | URL) => new Response(String(url) === "stats" ? stats : identities, { status: 200 });
  const usageResult = await new NflverseUsageProvider(fetcher as typeof fetch, { compressed: false, statsUrl: () => "stats", playersUrl: "players" }).getLeagueUsage(snapshot({ "100": p }));
  assert.deepEqual(usageResult.diagnostic.identityFailurePlayerIds, ["100"]);
  const rows: LiveForecastSnapshot[] = [];
  const result = await captureLiveForecastExperiment({
    snapshot: snapshot({ "100": p }), usage: usageResult.usage, usageDiagnostic: usageResult.diagnostic,
    intelligence: intelligence({ "100": p }), artifact: loadV6Artifact(artifactJson),
    scheduleProvider: { getSeason: async () => [game("DET")] }, store: store(rows), now: () => at,
  });
  assert.equal(result.diagnostics.identityMappingFailurePlayers, 1);
  assert.equal(result.diagnostics.insufficientCurrentSeasonFeatures, 0);
  assert.equal(result.diagnostics.playerDiagnostics?.find(x => x.playerId === "100")?.reason, "IDENTITY_MAPPING_FAILURE");
  assert.equal(rows.some(x => x.source === "V6"), false);
});

test("V6 snapshot IDs change for interval or artifact revisions while identical reruns stay idempotent", async () => {
  const p = player("p", "P");
  const loaded = loadV6Artifact(artifactJson);
  assert.equal(loaded.status, "READY");
  if (loaded.status !== "READY") return;
  const rows: LiveForecastSnapshot[] = [];
  const options = { snapshot: snapshot({ p }), usage: usage("p"), intelligence: intelligence({ p }),
    scheduleProvider: { getSeason: async () => [game("BUF")] }, store: store(rows), now: () => at };
  const first = await captureLiveForecastExperiment({ ...options, artifact: loaded });
  await captureLiveForecastExperiment({ ...options, artifact: loaded });
  assert.equal(rows.filter(x => x.source === "V6").length, 1);
  const revised = structuredClone(loaded);
  revised.artifact.models.find(x => x.position === "WR" && x.horizon === "next1")!.residualStd += 1;
  await captureLiveForecastExperiment({ ...options, artifact: revised });
  const v6 = rows.filter(x => x.source === "V6");
  assert.equal(v6.length, 2);
  assert.notEqual(v6[0].id, v6[1].id);
  assert.notEqual(v6[0].lower, v6[1].lower);
  assert.equal(first.snapshots.find(x => x.source === "V6")?.artifactVersion, v6[0].artifactVersion);
});

test("kickoff coverage counts eligible players individually", async () => {
  const players = { mapped: player("mapped", "Mapped", "WR", "BUF"), unmapped: player("unmapped", "Unmapped", "WR", "DAL") };
  const result = await captureLiveForecastExperiment({ snapshot: snapshot(players), usage: { ...usage("mapped"), ...usage("unmapped") }, intelligence: intelligence(players), artifact: loadV6Artifact(artifactJson), scheduleProvider: { getSeason: async () => [game("BUF")] }, store: store(), now: () => at });
  assert.deepEqual(result.diagnostics.kickoffCoverage, { eligible: 2, mapped: 1, unmapped: 1 });
  assert.equal(result.diagnostics.kickoffMapped, 1);
  assert.equal(result.snapshots.filter(x => x.source === "V6" && x.lockState === "UNKNOWN_LOCK").length, 1);
});
