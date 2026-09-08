import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagerProfiles,
  evaluateDealPlausibility,
  summarizePlausibilityCalibration,
} from "../../src/engine/index";
import type {
  LeagueSnapshot,
  TradeOfferRecord,
  TradeSearchResult,
} from "../../src/engine/index";

const now = "2026-09-04T12:00:00.000Z";
const snapshot: LeagueSnapshot = {
  id: "L", season: 2026, name: "V5", currentWeek: 2,
  settings: { scoring: [], lineupSlots: [{ id: "op", espnSlotId: 7, name: "OP", count: 1, kind: "active", eligiblePositions: ["QB", "RB", "WR", "TE"] }], rosterSize: 8, positionLimits: {}, irSlots: 0, playoffWeeks: [], raw: {} },
  teams: ["A", "B"].map((id) => ({ id, name: id, ownerIds: [id], record: { wins: 0, losses: 0, ties: 0 }, roster: [] })),
  players: {}, freeAgentIds: [], waiverPlayerIds: [], schedule: [], primaryTeamId: "A", dataMode: "live",
  provenance: { source: "test", asOf: now, retrievedAt: now, version: "v5-test" },
};
const baseResult = (overrides: Partial<TradeSearchResult> = {}) => ({
  trade: { teamAId: "A", teamBId: "B", teamAGives: ["A-WR", "A-RB"], teamBGives: ["B-QB"], shape: "2-for-1" },
  opponentTeamId: "B",
  evaluation: { opponentTeam: { after: { weeklyLineups: [{ week: 2 }] }, remainingStarterPointsDelta: 9, netUtilityDelta: 8, depthDelta: 1, requiredDrops: [], positionalChanges: [] }, primaryTeam: { netUtilityDelta: 8 } },
  opponentFit: { score: 75, band: "high", starterImpact: 3, utilityDelta: 8, depthDelta: 1, requiredDropBurden: 0, fillsNeed: true, losesCriticalStarter: false, reasons: [] },
  marketFairness: { score: 62, band: "advantage_opponent", confidence: "medium", youSend: 80, youReceive: 60, explanation: "Opponent receives more perceived market value." },
  teamFitScore: 85, marketOpportunityScore: 50, pursuitScore: 0, rank: 0, tags: [], reasons: [], warnings: [], downsideRisk: 0, outgoingMarginalCost: 1, incomingAcquisitionValue: 5,
  ...overrides,
} as unknown as TradeSearchResult);
const intelligence = (tier = 1) => ({ asOf: now, modelVersion: "test", buyLow: [], sellHigh: [], dataWarnings: [], players: {
  "A-WR": { fundamentalTier: 4, position: "WR" }, "A-RB": { fundamentalTier: 4, position: "RB" }, "B-QB": { fundamentalTier: tier, position: "QB" },
} }) as never;
const offer = (id: string, status: TradeOfferRecord["status"], source: TradeOfferRecord["source"], createdAt = now): TradeOfferRecord => ({
  id, leagueId: "L", season: 2026, senderTeamId: "A", recipientTeamId: "B", playersSent: ["A-WR", "A-RB"], playersReceived: ["B-QB"], createdAt, source, status, snapshotVersion: "test",
});

test("generic plausibility rewards mutual fit yet applies OP-QB star/package friction", () => {
  const profiles = buildManagerProfiles(snapshot);
  const fair = evaluateDealPlausibility(baseResult(), { snapshot, intelligence: intelligence(), profiles });
  const noStar = evaluateDealPlausibility(baseResult({ trade: { teamAId: "A", teamBId: "B", teamAGives: ["A-WR"], teamBGives: ["A-RB"], shape: "1-for-1" } }), { snapshot, intelligence: intelligence(5), profiles });
  assert.ok(fair.score > 45, "mutual benefit should be plausible");
  assert.ok(fair.components.starLoss < 0 && fair.components.qbScarcity < 0);
  assert.ok(fair.score < noStar.score, "star-for-depth and OP QB friction must matter");
});

test("generated and sent-only offers do not train manager behavior; repeated actual outcomes are shrunk and decayed", () => {
  const noEvidence = buildManagerProfiles(snapshot, [offer("g", "generated", "generated"), offer("s", "sent", "sent")]).B;
  assert.equal(noEvidence.sampleSize, 0);
  const oneRejection = buildManagerProfiles(snapshot, [offer("r", "rejected", "sent")]).B;
  assert.equal(oneRejection.sampleSize, 1);
  assert.equal(oneRejection.depthPreference, undefined, "one outcome must not invent a preference");
  const learned = buildManagerProfiles(snapshot, [offer("1", "accepted", "sent"), offer("2", "accepted", "manual"), offer("3", "countered", "sent")]).B;
  assert.ok((learned.depthPreference ?? 0) > 0, "accepted depth packages produce only a bounded learned signal");
  const stale = buildManagerProfiles(snapshot, [offer("old", "accepted", "sent", "2024-01-01T00:00:00.000Z"), offer("new", "accepted", "sent")]).B;
  assert.ok((stale.depthPreference ?? 0) < (learned.depthPreference ?? 1), "old outcomes decay");
});

test("manager adjustment is bounded and cannot mutate V1 transaction quality", () => {
  const profiles = buildManagerProfiles(snapshot, [offer("1", "accepted", "sent"), offer("2", "accepted", "sent"), offer("3", "accepted", "sent")]);
  const result = baseResult();
  const before = result.evaluation.primaryTeam.netUtilityDelta;
  const plausibility = evaluateDealPlausibility(result, { snapshot, intelligence: intelligence(), profiles });
  assert.equal(result.evaluation.primaryTeam.netUtilityDelta, before);
  assert.ok(Math.abs(plausibility.managerAdjustment) <= 12);
});

test("calibration buckets exclude generated and sent-only offers", () => {
  const records = [
    { ...offer("g", "generated", "generated"), plausibility: { score: 80, band: "high" as const, confidence: "low" as const } },
    { ...offer("s", "sent", "sent"), plausibility: { score: 80, band: "high" as const, confidence: "low" as const } },
    { ...offer("a", "accepted", "sent"), plausibility: { score: 80, band: "high" as const, confidence: "low" as const } },
    { ...offer("r", "rejected", "sent"), plausibility: { score: 80, band: "high" as const, confidence: "low" as const } },
  ];
  const high = summarizePlausibilityCalibration(records).find((bucket) => bucket.band === "high")!;
  assert.deepEqual(high, { band: "high", observations: 2, accepted: 1, countered: 0, rejectedOrIgnored: 1 });
});
