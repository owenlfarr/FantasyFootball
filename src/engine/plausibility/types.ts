import type { CanonicalPosition, ExplanationFactor, LeagueSnapshot } from "../types";
import type { LeagueIntelligence } from "../intelligence/types";
import type { TradeSearchResult } from "../search/types";

export type OfferSource = "generated" | "sent" | "manual" | "observed";
export type OfferStatus =
  | "generated"
  | "sent"
  | "viewed"
  | "ignored"
  | "rejected"
  | "countered"
  | "accepted"
  | "expired"
  | "unknown";
export type PlausibilityBand = "very_low" | "low" | "medium" | "high" | "very_high";
export type ManagerConfidence = "low" | "medium" | "high";
export type ManagerTag =
  | "PREFERS_DEPTH"
  | "PREFERS_STARS"
  | "RARE_TRADER"
  | "ACTIVE_TRADER"
  | "RB_INTEREST"
  | "WR_INTEREST"
  | "QB_INTEREST"
  | "TE_INTEREST";

export interface TradeOfferRecord {
  id: string;
  leagueId: string;
  season: number;
  senderTeamId: string;
  recipientTeamId: string;
  playersSent: string[];
  playersReceived: string[];
  createdAt: string;
  source: OfferSource;
  status: OfferStatus;
  respondedAt?: string;
  counterOfferId?: string;
  snapshotVersion: string;
  plausibility?: Pick<DealPlausibility, "score" | "band" | "confidence">;
}
export interface TradeOfferEvent {
  id: string;
  offerId: string;
  status: OfferStatus;
  occurredAt: string;
  counterOfferId?: string;
  note?: string;
}
export interface ManagerNote {
  id: string;
  leagueId: string;
  season: number;
  teamId: string;
  createdAt: string;
  text: string;
  tags: ManagerTag[];
  reluctantPlayerIds?: string[];
  availablePlayerIds?: string[];
}
export interface RevealedPreference {
  managerId: string;
  preferredPackage: string[];
  rejectedPackage: string[];
  contextId: string;
  timestamp: string;
}
export interface ManagerTradeProfile {
  managerId: string;
  teamId: string;
  sampleSize: number;
  tradeFrequency: number;
  consolidationPreference?: number;
  depthPreference?: number;
  positionPreferences?: Partial<Record<CanonicalPosition, number>>;
  starAttachment?: number;
  packageAversion?: number;
  marketFairnessSensitivity?: number;
  recentProductionBias?: number;
  draftCapitalAnchoring?: number;
  riskPreference?: number;
  confidence: ManagerConfidence;
  notes: ManagerNote[];
  revealedPreferences: RevealedPreference[];
}
export interface DealPlausibility {
  score: number;
  band: PlausibilityBand;
  confidence: ManagerConfidence;
  genericScore: number;
  managerAdjustment: number;
  components: {
    opponentBenefit: number;
    marketFairness: number;
    needFilled: number;
    starLoss: number;
    packageFriction: number;
    requiredDropBurden: number;
    qbScarcity: number;
  };
  reasons: ExplanationFactor[];
  risks: ExplanationFactor[];
}
export interface PlausibilityContext {
  snapshot: LeagueSnapshot;
  intelligence: LeagueIntelligence;
  profiles: Record<string, ManagerTradeProfile>;
}
export interface OfferLadder {
  opening?: TradeSearchResult;
  balanced?: TradeSearchResult;
  strong?: TradeSearchResult;
  maximum?: TradeSearchResult;
}
export interface TradeOfferMutation {
  offer: TradeOfferRecord;
  event?: Omit<TradeOfferEvent, "id" | "offerId" | "occurredAt"> & { occurredAt?: string };
}

export const plausibilityBand = (score: number): PlausibilityBand =>
  score < 20 ? "very_low" : score < 40 ? "low" : score < 60 ? "medium" : score < 80 ? "high" : "very_high";
