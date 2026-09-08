import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueIntelligence,
  buildWalkForwardSamples,
  createSearchCache,
  evaluateTrade,
  estimateRole,
  findBuyLowTargets,
  findSellHighCandidates,
  InMemoryIntelligenceHistoryStore,
  quickEvaluateTrade,
  rankWaivers,
  preRankWaiverCandidates,
  rosteredPlayerIds,
  searchTrades,
  validateForecasts,
} from "../../src/engine/index";
import type {
  CanonicalPosition,
  IntelligenceHistoryRecord,
  LeaguePlayer,
  LeagueSnapshot,
  PlayerForecast,
  RosterEntry,
  TradePackage,
} from "../../src/engine/index";

const asOf = "2026-09-03T12:00:00.000Z";
function player(
  id: string,
  pos: CanonicalPosition,
  mean: number,
  owned = 60,
): LeaguePlayer {
  const forecasts: PlayerForecast[] = Array.from({ length: 3 }, (_, i) => ({
    playerId: id,
    week: i + 1,
    mean: mean + (i % 2),
    lower: Math.max(0, mean - 5),
    upper: mean + 5,
    availabilityProbability: 1,
    source: "test",
    asOf,
  }));
  return {
    id,
    name: id,
    nflTeam: "TST",
    primaryPosition: pos,
    eligiblePositions: [pos],
    forecasts,
    market: { percentOwned: owned, percentStarted: owned * 0.6 },
    provenance: { source: "test", asOf, retrievedAt: asOf },
  };
}
const entry = (id: string): RosterEntry => ({
  playerId: id,
  assignedSlotId: 20,
  location: "bench",
});
function league(): LeagueSnapshot {
  const positions: CanonicalPosition[] = [
    "QB",
    "RB",
    "RB",
    "WR",
    "WR",
    "TE",
    "RB",
    "WR",
    "QB",
    "TE",
  ];
  const teams = Array.from({ length: 3 }, (_, t) =>
    positions.map((pos, i) =>
      player(
        `${String.fromCharCode(65 + t)}${i}`,
        pos,
        6 + ((i * 5 + t * 3) % 17),
        25 + ((i * 11 + t * 7) % 70),
      ),
    ),
  );
  const players = Object.fromEntries(teams.flat().map((p) => [p.id, p]));
  const leagueTeams = teams.map((ps, t) => {
    const id = String.fromCharCode(65 + t);
    ps.forEach((p) => (p.rosteredTeamId = id));
    return {
      id,
      name: `Team ${id}`,
      ownerIds: [],
      record: { wins: 0, losses: 0, ties: 0 },
      roster: ps.map((p) => entry(p.id)),
    };
  });
  return {
    id: "L",
    season: 2026,
    name: "V3",
    currentWeek: 1,
    settings: {
      scoring: [{ statId: 53, points: 1, raw: {} }],
      lineupSlots: [
        {
          id: "q",
          espnSlotId: 0,
          name: "QB",
          count: 1,
          kind: "active",
          eligiblePositions: ["QB"],
        },
        {
          id: "r",
          espnSlotId: 2,
          name: "RB",
          count: 2,
          kind: "active",
          eligiblePositions: ["RB"],
        },
        {
          id: "w",
          espnSlotId: 4,
          name: "WR",
          count: 2,
          kind: "active",
          eligiblePositions: ["WR"],
        },
        {
          id: "t",
          espnSlotId: 6,
          name: "TE",
          count: 1,
          kind: "active",
          eligiblePositions: ["TE"],
        },
        {
          id: "f",
          espnSlotId: 23,
          name: "FLEX",
          count: 1,
          kind: "active",
          eligiblePositions: ["RB", "WR", "TE"],
        },
        {
          id: "b",
          espnSlotId: 20,
          name: "BE",
          count: 3,
          kind: "bench",
          eligiblePositions: [],
        },
      ],
      rosterSize: 10,
      positionLimits: {},
      irSlots: 0,
      playoffWeeks: [3],
      regularSeasonWeeks: 2,
      raw: {},
    },
    teams: leagueTeams,
    players,
    freeAgentIds: [],
    waiverPlayerIds: [],
    schedule: [],
    primaryTeamId: "A",
    dataMode: "live",
    provenance: {
      source: "test",
      asOf,
      retrievedAt: asOf,
      version: "snapshot-1",
    },
  };
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function corr(a: number[], b: number[]) {
  const am = mean(a),
    bm = mean(b),
    n = a.reduce((s, x, i) => s + (x - am) * (b[i] - bm), 0),
    d = Math.sqrt(
      a.reduce((s, x) => s + (x - am) ** 2, 0) *
        b.reduce((s, x) => s + (x - bm) ** 2, 0),
    );
  return d ? n / d : 0;
}
function ranks(v: number[]) {
  return v.map(
    (x, i) => 1 + v.filter((y, j) => y < x || (y === x && j < i)).length,
  );
}

test("quick evaluator retains strong full-V1 trades with high rank correlation", () => {
  const s = league(),
    cache = createSearchCache(s, ["A"]),
    trades: TradePackage[] = [];
  for (const a of s.teams[0].roster)
    for (const b of s.teams[1].roster)
      trades.push({
        teamAId: "A",
        teamBId: "B",
        teamAGives: [a.playerId],
        teamBGives: [b.playerId],
        shape: "1-for-1",
      });
  const pairs = trades.map((trade) => {
    const quick = quickEvaluateTrade(s, trade, cache.baseline),
      full = evaluateTrade(s, trade, {
        baselineEvaluations: cache.baseline,
        includeMarginals: false,
      });
    return {
      quick: quick.primary.utilityDelta,
      full: full.primaryTeam.netUtilityDelta,
    };
  });
  const pearson = corr(
      pairs.map((p) => p.quick),
      pairs.map((p) => p.full),
    ),
    spearman = corr(
      ranks(pairs.map((p) => p.quick)),
      ranks(pairs.map((p) => p.full)),
    );
  const fullTop = [...pairs].sort((a, b) => b.full - a.full).slice(0, 10),
    quickTop = [...pairs].sort((a, b) => b.quick - a.quick).slice(0, 30),
    overlap = fullTop.filter((p) => quickTop.includes(p)).length / 10;
  console.info(
    "V3_QUICK_ACCURACY",
    JSON.stringify({
      samples: pairs.length,
      pearson,
      spearman,
      top10Overlap:
        fullTop.filter((p) =>
          [...pairs]
            .sort((a, b) => b.quick - a.quick)
            .slice(0, 10)
            .includes(p),
        ).length / 10,
      topDecileRecall: overlap,
    }),
  );
  assert.ok(pearson > 0.85);
  assert.ok(spearman > 0.8);
  assert.ok(overlap >= 0.95);
});

test("market hype never changes V1 transaction utility", () => {
  const s = league(),
    trade: TradePackage = {
      teamAId: "A",
      teamBId: "B",
      teamAGives: ["A3"],
      teamBGives: ["B3"],
      shape: "1-for-1",
    };
  const before = evaluateTrade(s, trade, { includeMarginals: false })
    .primaryTeam.netUtilityDelta;
  s.players.B3.market = { percentOwned: 100, percentStarted: 100 };
  const after = evaluateTrade(structuredClone(s), trade, {
    includeMarginals: false,
  }).primaryTeam.netUtilityDelta;
  assert.equal(before, after);
});

test("missing market and usage evidence does not fabricate mispricing or role trends", () => {
  const s = league();
  for (const p of Object.values(s.players)) delete p.market;
  const intel = buildLeagueIntelligence(s);
  assert.ok(
    Object.values(intel.players).every(
      (p) =>
        p.classification === "INSUFFICIENT_DATA" && p.role.trend === "unknown",
    ),
  );
  assert.deepEqual(findBuyLowTargets("A", s, intel), []);
});

test("waiver option and market cost prevent tiny upgrades from dropping liquid assets", () => {
  const s = league(),
    asset = s.players.A3;
  asset.market = { percentOwned: 99, percentStarted: 85 };
  const free = player("FA", "WR", asset.forecasts[0].mean + 0.1, 5);
  s.players.FA = free;
  s.freeAgentIds = ["FA"];
  const result = rankWaivers("A", s, {
    minimumUtilityGain: -1,
    maxPriorityCandidates: 5,
  });
  assert.ok(
    !result.results.some(
      (r) => r.dropPlayerId === "A3" && r.actionability !== "IGNORE",
    ),
  );
});

test("append-only history and walk-forward validation enforce as-of boundaries", async () => {
  const s = league(),
    intel = buildLeagueIntelligence(s),
    record: IntelligenceHistoryRecord = {
      leagueId: "L",
      season: 2026,
      week: 1,
      playerId: "A0",
      asOf: "2026-09-01T00:00:00Z",
      forecastMean: 20,
      actualFuturePoints: 18,
      fundamental: intel.players.A0.fundamental,
      market: intel.players.A0.market,
      modelVersion: "v3",
    };
  const store = new InMemoryIntelligenceHistoryStore();
  await store.append([record, record]);
  assert.equal(
    (await store.query("L", 2026, "2026-09-02T00:00:00Z")).length,
    1,
  );
  assert.equal(
    (await store.query("L", 2026, "2026-09-01T00:00:00Z")).length,
    0,
  );
  const validation = validateForecasts(buildWalkForwardSamples([record]));
  assert.equal(validation.samples, 1);
  assert.equal(
    validation.beatsBaseline,
    Math.abs(record.fundamental.expectedPoints - 18) < 2,
  );
});

test("role trends require opportunity evidence rather than fantasy scoring", () => {
  const usage = (
    targetShare: number,
    routeParticipation: number,
    week: number,
  ) => ({
    playerId: "WR",
    week,
    games: 1,
    metrics: { targetShare, routeParticipation },
    provenance: { source: "test", asOf, retrievedAt: asOf },
  });
  const falling = estimateRole("WR", [
    usage(0.3, 0.92, 1),
    usage(0.29, 0.9, 2),
    usage(0.28, 0.89, 3),
    usage(0.12, 0.58, 4),
    usage(0.1, 0.5, 5),
  ]);
  const rising = estimateRole("WR", [
    usage(0.1, 0.5, 1),
    usage(0.12, 0.55, 2),
    usage(0.11, 0.54, 3),
    usage(0.27, 0.88, 4),
    usage(0.3, 0.92, 5),
  ]);
  assert.equal(falling.trend, "falling");
  assert.equal(rising.trend, "rising");
});

test("stale market evidence lowers estimate confidence", () => {
  const fresh = league();
  const stale = structuredClone(fresh);
  for (const player of Object.values(stale.players)) {
    player.provenance.asOf = "2025-09-03T12:00:00.000Z";
    player.provenance.retrievedAt = "2025-09-03T12:00:00.000Z";
  }
  const freshConfidence =
    buildLeagueIntelligence(fresh).players.A0.market.confidence;
  const staleConfidence =
    buildLeagueIntelligence(stale).players.A0.market.confidence;
  assert.ok(staleConfidence < freshConfidence);
});

test("role collapse blocks buy-low and role growth blocks sell-high signals", () => {
  const snapshot = league();
  const intelligence = buildLeagueIntelligence(snapshot);
  const fallingTarget = intelligence.players.B0;
  fallingTarget.mispricingZ = 2;
  fallingTarget.fundamental.confidence = 1;
  fallingTarget.market.confidence = 1;
  fallingTarget.role.trend = "falling";
  assert.ok(
    !findBuyLowTargets("A", snapshot, intelligence).some(
      (signal) => signal.playerId === "B0",
    ),
  );

  const risingAsset = intelligence.players.A3;
  risingAsset.mispricingZ = -2;
  risingAsset.market.value = 100;
  risingAsset.market.confidence = 1;
  risingAsset.role.trend = "rising";
  assert.ok(
    !findSellHighCandidates("A", snapshot, intelligence).some(
      (signal) => signal.playerId === "A3",
    ),
  );
});

test("broad quick-screen search covers at least the narrow search result space", () => {
  const snapshot = league();
  const narrow = searchTrades("A", snapshot, {
    allowedShapes: ["1-for-1", "2-for-1"],
    maxQuickCandidatesPerOpponent: 1,
    maxCandidatesPerOpponent: 1,
    maxFinalResults: 5,
    minimumMyUtilityGain: -100,
    minimumOpponentFit: "very_low",
  });
  const broad = searchTrades("A", snapshot, {
    allowedShapes: ["1-for-1", "2-for-1"],
    maxQuickCandidatesPerOpponent: 30,
    maxCandidatesPerOpponent: 6,
    maxFinalResults: 10,
    minimumMyUtilityGain: -100,
    minimumOpponentFit: "very_low",
  });
  const narrowBest = Math.max(
    ...narrow.results.map(
      (result) => result.evaluation.primaryTeam.netUtilityDelta,
    ),
    -Infinity,
  );
  const broadBest = Math.max(
    ...broad.results.map(
      (result) => result.evaluation.primaryTeam.netUtilityDelta,
    ),
    -Infinity,
  );
  console.log(
    "V3_SEARCH_QUALITY",
    JSON.stringify({
      narrowFullEvaluations: narrow.instrumentation.fullEvaluationsRun,
      broadQuickEvaluations: broad.instrumentation.quickEvaluationsRun,
      broadFullEvaluations: broad.instrumentation.fullEvaluationsRun,
      narrowBest,
      broadBest,
    }),
  );
  assert.ok(
    broad.instrumentation.quickEvaluationsRun >=
      narrow.instrumentation.quickEvaluationsRun,
  );
  assert.ok(broadBest >= narrowBest);
});

test("trade intelligence scopes preprocessing to rostered fantasy assets", () => {
  const snapshot = league();
  for (let index = 0; index < 40; index++) {
    const freeAgent = player(
      `FREE-${index}`,
      index % 2 ? "RB" : "WR",
      8 + (index % 8),
    );
    snapshot.players[freeAgent.id] = freeAgent;
    snapshot.freeAgentIds.push(freeAgent.id);
  }
  const rostered = rosteredPlayerIds(snapshot);
  const intelligence = buildLeagueIntelligence(snapshot, {
    playerIds: rostered,
  });
  assert.equal(Object.keys(intelligence.players).length, rostered.length);
  assert.ok(
    Object.keys(intelligence.players).every((id) => !id.startsWith("FREE-")),
  );
});

test("waiver pre-ranking caps expensive scope at 100 with an upside exploration pool", () => {
  const snapshot = league();
  for (let index = 0; index < 180; index++) {
    const position: CanonicalPosition =
      index % 12 === 0 ? "D/ST" : index % 2 ? "RB" : "WR";
    const freeAgent = player(
      `WAIVER-${index}`,
      position,
      1 + (index % 20),
      index % 80,
    );
    snapshot.players[freeAgent.id] = freeAgent;
    snapshot.freeAgentIds.push(freeAgent.id);
  }
  const candidates = preRankWaiverCandidates("A", snapshot, 100, 0.2);
  assert.equal(candidates.length, 100);
  assert.ok(
    candidates.filter((id) => snapshot.players[id].primaryPosition === "D/ST")
      .length <= 12,
  );
  assert.ok(
    candidates.some(
      (id) => averageCandidateProjection(snapshot.players[id]) < 10,
    ),
  );
});

function averageCandidateProjection(candidate: LeaguePlayer) {
  return (
    candidate.forecasts.reduce((sum, forecast) => sum + forecast.mean, 0) /
    candidate.forecasts.length
  );
}
