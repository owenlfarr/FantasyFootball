import type { LeagueSnapshot } from "../types";
import type { LeagueIntelligence } from "../intelligence/types";
import type { TradeSearchResult } from "../search/types";
import {
  type DealPlausibility,
  type ManagerNote,
  type ManagerTradeProfile,
  type PlausibilityContext,
  type TradeOfferRecord,
  plausibilityBand,
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 1000) / 1000;
const actualOutcome = (status: TradeOfferRecord["status"]) =>
  status === "accepted" || status === "rejected" || status === "countered" || status === "ignored";
const daysOld = (value: string, now: string) =>
  Math.max(0, (Date.parse(now) - Date.parse(value)) / 86_400_000);
const decay = (value: string, now: string) => Math.exp(-daysOld(value, now) / 90);
const confidence = (n: number): ManagerTradeProfile["confidence"] => n >= 12 ? "high" : n >= 5 ? "medium" : "low";

/**
 * Learns only from observed outcomes. Generated and sent-only offers are
 * deliberately excluded: they carry no evidence about recipient behavior.
 */
export function buildManagerProfiles(
  snapshot: LeagueSnapshot,
  offers: TradeOfferRecord[] = [],
  notes: ManagerNote[] = [],
): Record<string, ManagerTradeProfile> {
  const now = snapshot.provenance.asOf;
  return Object.fromEntries(snapshot.teams.map((team) => {
    const relevant = offers.filter((offer) =>
      offer.recipientTeamId === team.id &&
      offer.leagueId === snapshot.id && offer.season === snapshot.season &&
      offer.source !== "generated" && actualOutcome(offer.status),
    );
    const weighted = relevant.reduce((sum, offer) => sum + decay(offer.respondedAt ?? offer.createdAt, now), 0);
    const accepted = relevant.filter((offer) => offer.status === "accepted" || offer.status === "countered");
    const depthEvidence = accepted.map((offer) =>
      Math.sign(offer.playersSent.length - offer.playersReceived.length) * decay(offer.respondedAt ?? offer.createdAt, now),
    );
    const packageEvidence = accepted.map((offer) =>
      (offer.playersSent.length > 1 ? 1 : -0.25) * decay(offer.respondedAt ?? offer.createdAt, now),
    );
    const teamNotes = notes.filter((note) => note.teamId === team.id);
    const sampleSize = relevant.length;
    const noteHas = (tag: ManagerNote["tags"][number]) => teamNotes.some((note) => note.tags.includes(tag));
    // Values intentionally stay undefined until at least two actual outcomes
    // exist. Notes merely provide a small, visible, user-authored prior.
    const evidence = weighted > 0 ? 1 - Math.exp(-weighted / 4) : 0;
    const depth = sampleSize >= 2
      ? clamp((depthEvidence.reduce((a, b) => a + b, 0) / Math.max(1, weighted)) * evidence, -0.35, 0.35)
      : noteHas("PREFERS_DEPTH") ? 0.08 : noteHas("PREFERS_STARS") ? -0.08 : undefined;
    const packageAversion = sampleSize >= 2
      ? clamp(-(packageEvidence.reduce((a, b) => a + b, 0) / Math.max(1, weighted)) * 0.18, -0.18, 0.18)
      : undefined;
    const managerId = team.ownerIds[0] ?? team.id;
    return [team.id, {
      managerId,
      teamId: team.id,
      sampleSize,
      tradeFrequency: round(relevant.length / Math.max(1, snapshot.currentWeek)),
      consolidationPreference: depth === undefined ? undefined : round(-depth),
      depthPreference: depth === undefined ? undefined : round(depth),
      packageAversion: packageAversion === undefined ? undefined : round(packageAversion),
      starAttachment: sampleSize >= 3 ? round(clamp(-(packageAversion ?? 0) * 0.7, -0.12, 0.12)) : undefined,
      confidence: confidence(sampleSize),
      notes: teamNotes,
      revealedPreferences: [],
    } satisfies ManagerTradeProfile];
  }));
}

function playerTier(id: string, intel: LeagueIntelligence) {
  return intel.players[id]?.fundamentalTier ?? 8;
}
function isOpLeague(snapshot: LeagueSnapshot) {
  return snapshot.settings.lineupSlots.some((slot) =>
    slot.kind === "active" && slot.eligiblePositions.includes("QB") && slot.eligiblePositions.length > 1,
  );
}
function managerAdjustment(
  profile: ManagerTradeProfile | undefined,
  result: TradeSearchResult,
): { value: number; reasons: DealPlausibility["reasons"]; risks: DealPlausibility["risks"] } {
  if (!profile) return { value: 0, reasons: [], risks: [] };
  const evidenceWeight = clamp(profile.sampleSize / 12, 0, 1);
  const netCount = result.trade.teamAGives.length - result.trade.teamBGives.length;
  let value = 0;
  const reasons: DealPlausibility["reasons"] = [];
  const risks: DealPlausibility["risks"] = [];
  if (profile.depthPreference && netCount > 0) value += 14 * profile.depthPreference * evidenceWeight;
  if (profile.consolidationPreference && netCount < 0) value += 14 * profile.consolidationPreference * evidenceWeight;
  if (profile.packageAversion && result.trade.teamAGives.length > 1)
    value -= 18 * Math.max(0, profile.packageAversion) * evidenceWeight;
  const received = result.trade.teamAGives;
  if (profile.notes.some((note) => received.some((id) => note.availablePlayerIds?.includes(id)))) {
    value += 4;
    reasons.push({ code: "MANAGER_AVAILABLE_ASSET", direction: "positive", metric: "managerNote", message: "A user-recorded manager note indicates openness to an incoming asset." });
  }
  if (profile.notes.some((note) => result.trade.teamBGives.some((id) => note.reluctantPlayerIds?.includes(id)))) {
    value -= 8;
    risks.push({ code: "MANAGER_RELUCTANT_ASSET", direction: "negative", metric: "managerNote", message: "A user-recorded manager note marks an outgoing asset as reluctant/untouchable." });
  }
  return { value: clamp(value, -12, 12), reasons, risks };
}

/** Cheap, deterministic plausibility scorer. It consumes already-computed V1/V2/V4 data and never calls roster evaluation. */
export function evaluateDealPlausibility(
  result: TradeSearchResult,
  context: PlausibilityContext,
): DealPlausibility {
  const { snapshot, intelligence } = context;
  const opponent = result.evaluation.opponentTeam!;
  const weeks = Math.max(1, opponent.after.weeklyLineups.length);
  const starter = opponent.remainingStarterPointsDelta / weeks;
  const benefit = clamp(
    0.55 * (result.opponentFit.score - 50) + 5 * clamp(starter, -4, 4),
    -30,
    30,
  );
  const fairness = result.marketFairness.band === "advantage_opponent" ? 12
    : result.marketFairness.band === "fair" ? 5
      : result.marketFairness.band === "advantage_you" ? -10 : -2;
  const need = result.opponentFit.fillsNeed ? 7 : 0;
  const outgoingTiers = result.trade.teamBGives.map((id) => playerTier(id, intelligence));
  const incomingTiers = result.trade.teamAGives.map((id) => playerTier(id, intelligence));
  const bestLost = Math.min(8, ...outgoingTiers);
  const bestReceived = Math.min(8, ...incomingTiers);
  const eliteLostWithoutPeer = bestLost <= 2 && bestReceived > bestLost;
  const incomingStarters = result.opponentFit.starterImpact > 0 ? result.trade.teamAGives.length : 0;
  const starLoss = eliteLostWithoutPeer ? -(bestLost === 1 ? 14 : 8) * (incomingStarters >= 2 && result.opponentFit.fillsNeed ? 0.55 : 1) : 0;
  const countDifference = Math.abs(result.trade.teamAGives.length - result.trade.teamBGives.length);
  const packageFriction = -Math.min(10, 2 * countDifference + (result.trade.teamAGives.length + result.trade.teamBGives.length >= 4 ? 2 : 0));
  const drop = -Math.min(12, 1.5 * result.opponentFit.requiredDropBurden / weeks);
  const qbScarcity = isOpLeague(snapshot) && result.trade.teamBGives.some((id) => intelligence.players[id]?.position === "QB")
    ? -7 : 0;
  const genericScore = clamp(50 + benefit + fairness + need + starLoss + packageFriction + drop + qbScarcity, 0, 100);
  const profile = context.profiles[result.opponentTeamId];
  const adjustment = managerAdjustment(profile, result);
  const score = clamp(genericScore + adjustment.value, 0, 100);
  const marketConfidence = result.marketFairness.confidence === "high" ? 1 : result.marketFairness.confidence === "medium" ? 0.65 : 0.35;
  const rosterConfidence = result.opponentFit.losesCriticalStarter ? 0.4 : 1;
  const managerConfidence = profile?.confidence ?? "low";
  const c = marketConfidence * rosterConfidence * (managerConfidence === "high" ? 1 : managerConfidence === "medium" ? 0.75 : 0.5);
  const band = c >= 0.68 ? "high" : c >= 0.42 ? "medium" : "low";
  const reasons: DealPlausibility["reasons"] = [
    ...(result.opponentFit.starterImpact > 0 ? [{ code: "PLAUSIBILITY_STARTER_GAIN", direction: "positive" as const, metric: "opponentStarterImpact", delta: result.opponentFit.starterImpact, message: `Their optimized starters improve by ${result.opponentFit.starterImpact.toFixed(1)} projected points per week.` }] : []),
    ...(result.opponentFit.fillsNeed ? [{ code: "PLAUSIBILITY_NEED_FILLED", direction: "positive" as const, metric: "opponentNeed", message: "The package addresses a higher-need position on their roster." }] : []),
    ...(fairness > 0 ? [{ code: "PLAUSIBILITY_MARKET_FAIR", direction: "positive" as const, metric: "marketFairness", message: result.marketFairness.explanation }] : []),
    ...adjustment.reasons,
  ];
  const risks: DealPlausibility["risks"] = [
    ...(eliteLostWithoutPeer ? [{ code: "PLAUSIBILITY_STAR_LOSS", direction: "negative" as const, metric: "eliteAssetLoss", message: "They surrender a higher-tier asset without receiving a similarly prestigious replacement." }] : []),
    ...(result.opponentFit.requiredDropBurden > 0 ? [{ code: "PLAUSIBILITY_ROSTER_SPOT_BURDEN", direction: "negative" as const, metric: "requiredDrop", delta: -result.opponentFit.requiredDropBurden, message: "The incoming package creates a required-drop/roster-space burden." }] : []),
    ...(qbScarcity < 0 ? [{ code: "PLAUSIBILITY_OP_QB_SCARCITY", direction: "negative" as const, metric: "opQuarterback", message: "This league's OP structure makes a starting quarterback unusually difficult to move." }] : []),
    ...adjustment.risks,
  ];
  return {
    score: Math.round(score), band: plausibilityBand(score), confidence: band,
    genericScore: Math.round(genericScore), managerAdjustment: round(adjustment.value),
    components: { opponentBenefit: round(benefit), marketFairness: fairness, needFilled: need, starLoss, packageFriction, requiredDropBurden: round(drop), qbScarcity },
    reasons, risks,
  };
}
