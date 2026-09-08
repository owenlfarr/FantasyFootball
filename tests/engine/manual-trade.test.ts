import assert from "node:assert/strict";
import test from "node:test";
import { evaluateManualTrade } from "../../src/engine/transactions/evaluateManualTrade";
import { evaluateTrade } from "../../src/engine/transactions/evaluateTransactions";
import type { CanonicalPosition, LeaguePlayer, LeagueSnapshot } from "../../src/engine/types";

const asOf = "2026-09-05T00:00:00.000Z";
function player(id: string, position: CanonicalPosition, mean: number, teamId: string): LeaguePlayer {
  return { id, name: id, nflTeam: "TST", primaryPosition: position, eligiblePositions: [position], rosteredTeamId: teamId, forecasts: [{ playerId: id, week: 1, mean, lower: mean - 2, upper: mean + 2, availabilityProbability: 1, source: "test", asOf }], provenance: { source: "test", asOf, retrievedAt: asOf } };
}
function snapshot(mode: "live" | "mock" = "live"): LeagueSnapshot {
  const mine = [player("aqb", "QB", 20, "A"), ...Array.from({ length: 5 }, (_, index) => player(`a${index + 1}`, "WR", 15 - index, "A"))];
  const theirs = [player("bqb", "QB", 18, "B"), ...Array.from({ length: 5 }, (_, index) => player(`b${index + 1}`, "WR", 14 - index, "B"))];
  return {
    id: "L", season: 2026, name: "Fixture", currentWeek: 1, primaryTeamId: "A", dataMode: mode,
    players: Object.fromEntries([...mine, ...theirs].map((item) => [item.id, item])), freeAgentIds: [], waiverPlayerIds: [], schedule: [],
    teams: [
      { id: "A", name: "Mine", ownerIds: [], record: { wins: 0, losses: 0, ties: 0 }, roster: mine.map((item) => ({ playerId: item.id, assignedSlotId: item.primaryPosition === "QB" ? 0 : 20, location: item.primaryPosition === "QB" ? "active" as const : "bench" as const })) },
      { id: "B", name: "Other", ownerIds: [], record: { wins: 0, losses: 0, ties: 0 }, roster: theirs.map((item) => ({ playerId: item.id, assignedSlotId: item.primaryPosition === "QB" ? 0 : 20, location: item.primaryPosition === "QB" ? "active" as const : "bench" as const })) },
    ],
    settings: { scoring: [{ statId: 53, points: 1, raw: {} }], lineupSlots: [{ id: "qb", espnSlotId: 0, name: "QB", count: 1, kind: "active", eligiblePositions: ["QB"] }, { id: "bench", espnSlotId: 20, name: "Bench", count: 5, kind: "bench", eligiblePositions: [] }], rosterSize: 6, positionLimits: {}, irSlots: 0, playoffWeeks: [], raw: {} },
    provenance: { source: "ESPN", asOf, retrievedAt: asOf, version: "fixture" },
  };
}
const intelligence = { asOf, modelVersion: "fixture", players: {}, buyLow: [], sellHigh: [], dataWarnings: [] } as never;
const context = (live: LeagueSnapshot) => ({ snapshot: live, intelligence, profiles: {} }) as never;

test("manual evaluation rejects non-live, empty, duplicate, and wrong-roster input", () => {
  assert.throws(() => evaluateManualTrade(snapshot("mock"), { teamBId: "B", teamAGives: ["a1"], teamBGives: ["b1"] }, intelligence, context(snapshot())), /current live ESPN/);
  const live = snapshot();
  assert.throws(() => evaluateManualTrade(live, { teamBId: "B", teamAGives: [], teamBGives: ["b1"] }, intelligence, context(live)), /at least one/);
  assert.throws(() => evaluateManualTrade(live, { teamBId: "B", teamAGives: ["a1"], teamBGives: ["a1"] }, intelligence, context(live)), /twice/);
  assert.throws(() => evaluateManualTrade(live, { teamBId: "B", teamAGives: ["b1"], teamBGives: ["a1"] }, intelligence, context(live)), /selected roster/);
});

test("all requested manual package shapes equal the complete direct V1 transaction", () => {
  const packages = [
    { teamAGives: ["a1"], teamBGives: ["b1"] },
    { teamAGives: ["a1", "a2"], teamBGives: ["b1"] },
    { teamAGives: ["a1"], teamBGives: ["b1", "b2"] },
    { teamAGives: ["a1", "a2", "a3"], teamBGives: ["b1", "b2"] },
    { teamAGives: ["a1", "a2"], teamBGives: ["b1", "b2", "b3"] },
    { teamAGives: ["a1", "a2", "a3"], teamBGives: ["b1", "b2", "b3"] },
  ];
  const impactFields = (impact: NonNullable<ReturnType<typeof evaluateTrade>["opponentTeam"]> | ReturnType<typeof evaluateTrade>["primaryTeam"] | undefined) => impact && ({
    teamId: impact.teamId,
    beforeUtility: impact.before.utility,
    afterUtility: impact.after.utility,
    weeklyStarterDeltas: impact.weeklyStarterDeltas,
    remainingStarterPointsDelta: impact.remainingStarterPointsDelta,
    playoffPointsDelta: impact.playoffPointsDelta,
    depthDelta: impact.depthDelta,
    injuryResilienceDelta: impact.injuryResilienceDelta,
    netUtilityDelta: impact.netUtilityDelta,
    requiredDrops: impact.requiredDrops,
    positionalChanges: impact.positionalChanges,
    warnings: impact.warnings,
  });
  for (const trade of packages) {
    const live = snapshot();
    const manual = evaluateManualTrade(live, { teamBId: "B", ...trade }, intelligence, context(live));
    const direct = evaluateTrade(live, { teamAId: "A", teamBId: "B", ...trade });
    assert.equal(manual.evaluation.legal, direct.legal);
    assert.deepEqual(impactFields(manual.evaluation.primaryTeam), impactFields(direct.primaryTeam));
    assert.deepEqual(impactFields(manual.evaluation.opponentTeam), impactFields(direct.opponentTeam));
    assert.deepEqual(manual.evaluation.warnings, direct.warnings);
    assert.ok(Number.isFinite(manual.evaluationTimeMs));
  }
});

test("uneven packages select exact required drops for the receiving side", () => {
  const live = snapshot();
  const primaryDrop = evaluateManualTrade(live, { teamBId: "B", teamAGives: ["a1"], teamBGives: ["b1", "b2"] }, intelligence, context(live));
  assert.equal(primaryDrop.evaluation.primaryTeam.requiredDrops.length, 1);
  assert.equal(primaryDrop.evaluation.primaryTeam.requiredDrops[0].teamId, "A");
  assert.equal(primaryDrop.evaluation.opponentTeam?.requiredDrops.length, 0);
  const opponentDrop = evaluateManualTrade(live, { teamBId: "B", teamAGives: ["a1", "a2"], teamBGives: ["b1"] }, intelligence, context(live));
  assert.equal(opponentDrop.evaluation.primaryTeam.requiredDrops.length, 0);
  assert.equal(opponentDrop.evaluation.opponentTeam?.requiredDrops.length, 1);
  assert.equal(opponentDrop.evaluation.opponentTeam?.requiredDrops[0].teamId, "B");
});

test("an illegal package returns INVALID TRADE and preserves V1 warnings", () => {
  const live = snapshot();
  const result = evaluateManualTrade(live, { teamBId: "B", teamAGives: ["aqb"], teamBGives: ["b1"] }, intelligence, context(live));
  assert.equal(result.evaluation.legal, false);
  assert.equal(result.verdict, "INVALID TRADE");
  assert.ok(result.evaluation.warnings.some((warning) => warning.code === "MISSING_MANDATORY_STARTER"));
});

test("manual evaluation is pure and does not create offer-history evidence", () => {
  const result = evaluateManualTrade(snapshot(), { teamBId: "B", teamAGives: ["a1"], teamBGives: ["b1"] }, intelligence, context(snapshot()));
  assert.equal("history" in result, false);
  assert.equal("sent" in result, false);
  assert.equal("markSent" in result, false);
});
