import assert from "node:assert/strict";
import test from "node:test";
import {
  characterizeRosterAssets,
  createSearchCache,
  findOffersForTarget,
  paretoFilter,
  rankWaivers,
  searchTrades,
} from "../../src/engine/index";
import type {
  CanonicalPosition,
  LeaguePlayer,
  LeagueSnapshot,
  LineupSlotDefinition,
  PlayerForecast,
  RosterEntry,
  TradeSearchResult,
} from "../../src/engine/index";

const asOf = "2026-09-03T12:00:00.000Z";
const slot = (
  id: number,
  name: string,
  count: number,
  eligible: CanonicalPosition[],
  kind: "active" | "bench" | "ir" = "active",
): LineupSlotDefinition => ({
  id: `s${id}`,
  espnSlotId: id,
  name,
  count,
  eligiblePositions: eligible,
  kind,
});
function player(
  id: string,
  position: CanonicalPosition,
  mean: number,
  weeks = 3,
): LeaguePlayer {
  const forecasts: PlayerForecast[] = Array.from({ length: weeks }, (_, i) => ({
    playerId: id,
    week: i + 1,
    mean,
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
    primaryPosition: position,
    eligiblePositions: [position],
    forecasts,
    provenance: { source: "test", asOf, retrievedAt: asOf },
  };
}
const entry = (playerId: string): RosterEntry => ({
  playerId,
  assignedSlotId: 20,
  location: "bench",
});

function league(
  teamPlayers: LeaguePlayer[][],
  freeAgents: LeaguePlayer[] = [],
  benchCount = 2,
): LeagueSnapshot {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 1, ["RB"]),
    slot(4, "WR", 1, ["WR"]),
    slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    slot(20, "BE", benchCount, [], "bench"),
    slot(21, "IR", 1, [], "ir"),
  ];
  const all = [...teamPlayers.flat(), ...freeAgents];
  const players = Object.fromEntries(all.map((p) => [p.id, p]));
  const teams = teamPlayers.map((ps, i) => {
    const id = String.fromCharCode(65 + i);
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
    name: "Search League",
    currentWeek: 1,
    settings: {
      scoring: [{ statId: 53, points: 1, raw: {} }],
      lineupSlots: slots,
      rosterSize: 4 + benchCount,
      positionLimits: {},
      irSlots: 1,
      playoffWeeks: [3],
      regularSeasonWeeks: 2,
      raw: {},
    },
    teams,
    players,
    freeAgentIds: freeAgents.map((p) => p.id),
    waiverPlayerIds: [],
    schedule: [],
    primaryTeamId: "A",
    dataMode: "live",
    provenance: { source: "test", asOf, retrievedAt: asOf },
  };
}

function mutualLeague() {
  return league([
    [
      player("A-QB", "QB", 20),
      player("A-RB1", "RB", 18),
      player("A-RB2", "RB", 15),
      player("A-WR1", "WR", 8),
      player("A-RB3", "RB", 14),
      player("A-WR2", "WR", 5),
    ],
    [
      player("B-QB", "QB", 18),
      player("B-WR1", "WR", 20),
      player("B-WR2", "WR", 12),
      player("B-RB1", "RB", 6),
      player("B-QB2", "QB", 5),
      player("B-WR3", "WR", 6),
    ],
  ]);
}

test("asset characterization identifies core starters and blocked redundant value", () => {
  const snapshot = mutualLeague();
  const cache = createSearchCache(snapshot);
  const assets = characterizeRosterAssets(snapshot, "A", "B", cache);
  assert.equal(assets.find((a) => a.playerId === "A-QB")?.assetClass, "CORE");
  assert.ok(
    ["REDUNDANT_VALUE", "TRADE_CHIP", "DEPTH_PROTECTION"].includes(
      assets.find((a) => a.playerId === "A-RB3")!.assetClass,
    ),
  );
  assert.ok(assets.find((a) => a.playerId === "A-RB2")!.acquisitionValue > 0);
});

test("trade discovery finds a mutually useful consolidation and respects only-QB safety", () => {
  const snapshot = mutualLeague();
  const response = searchTrades("A", snapshot, {
    allowedShapes: ["2-for-1"],
    minimumOpponentFit: "very_low",
    minimumMyUtilityGain: 0,
    maxCandidatesPerOpponent: 100,
    maxFinalResults: 20,
  });
  assert.equal(response.status, "READY");
  assert.ok(
    response.instrumentation.rawCandidatesGenerated >
      response.instrumentation.fullEvaluationsRun,
    "generation should exceed full evaluations",
  );
  assert.ok(
    response.results.some(
      (result) =>
        result.trade.teamBGives.includes("B-WR1") &&
        result.tags.includes("CONSOLIDATION"),
    ),
    "consolidation result expected",
  );
  assert.ok(
    response.results.every(
      (result) =>
        !result.trade.teamAGives.includes("A-QB") ||
        result.trade.teamBGives.some(
          (id) => snapshot.players[id].primaryPosition === "QB",
        ),
    ),
  );
  assert.ok(
    response.results.every(
      (candidate, index) =>
        !response.results.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.evaluation.primaryTeam.netUtilityDelta >=
              candidate.evaluation.primaryTeam.netUtilityDelta &&
            other.opponentFit.score >= candidate.opponentFit.score &&
            other.downsideRisk <= candidate.downsideRisk &&
            (other.evaluation.primaryTeam.netUtilityDelta >
              candidate.evaluation.primaryTeam.netUtilityDelta ||
              other.opponentFit.score > candidate.opponentFit.score ||
              other.downsideRisk < candidate.downsideRisk),
        ),
    ),
  );
});

test("candidate search evaluates every supported V2 package shape", () => {
  const snapshot = mutualLeague();
  for (const shape of [
    "1-for-1",
    "2-for-1",
    "1-for-2",
    "2-for-2",
    "3-for-1",
  ] as const) {
    const response = searchTrades("A", snapshot, {
      allowedShapes: [shape],
      minimumOpponentFit: "very_low",
      minimumMyUtilityGain: -1,
      maxCandidatesPerOpponent: 100,
      maxFinalResults: 30,
    });
    assert.ok(
      response.instrumentation.rawCandidatesGenerated > 0,
      `${shape} should generate candidates`,
    );
    assert.ok(
      response.instrumentation.fullEvaluationsRun > 0,
      `${shape} should reach V1 evaluation`,
    );
  }
});

test("target mode returns distinct offer styles and avoids prestige overpay", () => {
  const snapshot = mutualLeague();
  const target = findOffersForTarget("A", "B-WR1", snapshot, {
    minimumOpponentFit: "very_low",
    maxCandidatesPerOpponent: 100,
  });
  assert.equal(target.recommendation, "PURSUE");
  assert.ok(target.offers.length >= 2);
  assert.ok(
    new Set(
      target.offers.map((offer) => offer.result.trade.teamAGives.join("+")),
    ).size >= 2,
  );
  assert.ok(
    target.offers.some((offer) => offer.result.trade.teamAGives.length === 2),
  );
  const qbTarget = findOffersForTarget("A", "B-QB", snapshot, {
    minimumOpponentFit: "very_low",
    maxCandidatesPerOpponent: 100,
  });
  assert.equal(qbTarget.recommendation, "DO_NOT_OVERPAY");
});

test("waiver ranking pairs the best add with the optimal drop and rejects negative moves", () => {
  const free = [
    player("FA-WR-STAR", "WR", 17),
    player("FA-WR-BENCH", "WR", 7),
    player("FA-BAD", "RB", 1),
  ];
  const snapshot = league(
    [
      [
        player("A-QB", "QB", 20),
        player("A-RB", "RB", 12),
        player("A-WR", "WR", 7),
        player("A-FLEX", "RB", 10),
        player("A-BENCH", "WR", 2),
        player("A-DEPTH", "RB", 8),
      ],
      [
        player("B-QB", "QB", 18),
        player("B-RB", "RB", 15),
        player("B-WR", "WR", 14),
        player("B-FLEX", "WR", 12),
        player("B-B1", "RB", 7),
        player("B-B2", "WR", 6),
      ],
    ],
    free,
  );
  const response = rankWaivers("A", snapshot, {
    maxPriorityCandidates: 10,
    maxFinalResults: 10,
  });
  assert.equal(response.status, "READY");
  assert.equal(response.results[0].addPlayerId, "FA-WR-STAR");
  assert.equal(response.results[0].dropPlayerId, "A-BENCH");
  assert.equal(response.results[0].category, "IMMEDIATE_STARTER");
  assert.ok(
    !response.results.some((result) => result.addPlayerId === "FA-BAD"),
  );
  assert.ok(
    response.results[0].explanations.some(
      (factor) => factor.code === "OPTIMAL_DROP",
    ),
  );
});

test("waiver search uses an open slot and preserves valuable depth for tiny gains", () => {
  const free = [player("FA-TINY", "WR", 6)];
  const snapshot = league(
    [
      [
        player("A-QB", "QB", 20),
        player("A-RB", "RB", 12),
        player("A-WR", "WR", 10),
        player("A-FLEX", "RB", 11),
        player("A-DEPTH", "RB", 10),
      ],
      [
        player("B-QB", "QB", 18),
        player("B-RB", "RB", 14),
        player("B-WR", "WR", 13),
        player("B-FLEX", "WR", 11),
        player("B-B1", "RB", 7),
      ],
    ],
    free,
    2,
  );
  const response = rankWaivers("A", snapshot, {
    minimumUtilityGain: -10,
    maxPriorityCandidates: 5,
  });
  const move = response.results.find(
    (result) => result.addPlayerId === "FA-TINY",
  );
  assert.equal(move?.dropPlayerId, undefined);
  snapshot.teams[0].roster.push(entry("FA-TINY"));
  snapshot.players["FA-TINY"].rosteredTeamId = "A";
  snapshot.freeAgentIds = [];
  const tinyUpgrade = player("FA-MINOR", "WR", 6.1);
  snapshot.players[tinyUpgrade.id] = tinyUpgrade;
  snapshot.freeAgentIds = [tinyUpgrade.id];
  const full = rankWaivers("A", snapshot, {
    minimumUtilityGain: 0.1,
    maxPriorityCandidates: 5,
  });
  assert.ok(!full.results.some((result) => result.dropPlayerId === "A-DEPTH"));
});

test("search refuses incomplete snapshots and never emits mock-looking recommendations", () => {
  const snapshot = mutualLeague();
  snapshot.settings.scoring = [];
  snapshot.dataMode = "mock";
  const trades = searchTrades("A", snapshot);
  const waivers = rankWaivers("A", snapshot);
  assert.equal(trades.status, "ENGINE_NOT_READY");
  assert.equal(waivers.status, "ENGINE_NOT_READY");
  assert.deepEqual(trades.results, []);
  assert.deepEqual(waivers.results, []);
});

test("12-team stress fixture prunes materially before full V1 evaluation", () => {
  const positions: CanonicalPosition[] = ["QB", "RB", "WR", "TE"];
  const teams = Array.from({ length: 12 }, (_, team) =>
    Array.from({ length: 17 }, (_, index) =>
      player(
        `T${team}-P${index}`,
        positions[index % 4],
        6 + ((team * 7 + index * 3) % 17),
        1,
      ),
    ),
  );
  const free = Array.from({ length: 250 }, (_, index) =>
    player(
      `FA-${index}`,
      positions[index % 4],
      index < 20 ? 15 - index * 0.2 : 2 + (index % 8),
      1,
    ),
  );
  const snapshot = league(teams, free, 13);
  snapshot.settings.playoffWeeks = [];
  snapshot.settings.regularSeasonWeeks = 1;
  const trades = searchTrades("A", snapshot, {
    maxCandidatesPerOpponent: 12,
    maxFinalResults: 8,
    minimumOpponentFit: "very_low",
    minimumMyUtilityGain: -1,
  });
  const waivers = rankWaivers("A", snapshot, {
    maxPriorityCandidates: 20,
    maxFinalResults: 8,
    minimumUtilityGain: 0,
  });
  console.info(
    "V2_STRESS_METRICS",
    JSON.stringify({
      trades: trades.instrumentation,
      waivers: waivers.instrumentation,
    }),
  );
  assert.ok(
    trades.instrumentation.naiveCandidateCount >
      trades.instrumentation.fullEvaluationsRun * 100,
  );
  assert.ok(
    trades.instrumentation.candidatesPruned >
      trades.instrumentation.fullEvaluationsRun,
  );
  assert.ok(trades.instrumentation.fullEvaluationsRun <= 11 * 12);
  assert.equal(waivers.instrumentation.fullEvaluationsRun, 20);
  assert.ok(waivers.instrumentation.availablePlayers >= 250);
});

test("Pareto filtering removes a result dominated on utility, fit, and risk", () => {
  const snapshot = mutualLeague();
  const response = searchTrades("A", snapshot, {
    minimumOpponentFit: "very_low",
    minimumMyUtilityGain: -1,
    maxFinalResults: 20,
  });
  if (response.results.length) {
    const strong = response.results[0];
    const weak = structuredClone(strong) as TradeSearchResult;
    weak.evaluation.primaryTeam.netUtilityDelta =
      strong.evaluation.primaryTeam.netUtilityDelta - 1;
    weak.opponentFit.score = strong.opponentFit.score - 1;
    weak.downsideRisk = strong.downsideRisk + 1;
    assert.deepEqual(paretoFilter([strong, weak]), [strong]);
  } else assert.fail("fixture should yield a trade");
});

test("cold and cached searches preserve golden trade and waiver results exactly", () => {
  const snapshot = mutualLeague();
  const tradeConfig = {
    minimumOpponentFit: "very_low" as const,
    minimumMyUtilityGain: -1,
    maxCandidatesPerOpponent: 100,
    maxFinalResults: 20,
  };
  const coldTrades = searchTrades("A", snapshot, tradeConfig).results;
  const cachedTrades = searchTrades("A", snapshot, tradeConfig).results;
  assert.deepEqual(cachedTrades, coldTrades);

  const free = player("FA-GOLDEN", "WR", 17);
  snapshot.players[free.id] = free;
  snapshot.freeAgentIds = [free.id];
  const waiverConfig = {
    maxPriorityCandidates: 10,
    maxFinalResults: 10,
    minimumUtilityGain: -1,
  };
  const coldWaivers = rankWaivers("A", snapshot, waiverConfig).results;
  const cachedWaivers = rankWaivers("A", snapshot, waiverConfig).results;
  assert.deepEqual(cachedWaivers, coldWaivers);
});
