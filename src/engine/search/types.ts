import type {
  CanonicalPosition,
  EvaluationWarning,
  ExplanationFactor,
  LeagueSnapshot,
  RosterEvaluation,
  TransactionEvaluation,
} from "../types";
import type { DealPlausibility, OfferLadder } from "../plausibility/types";

export type TradeShape =
  | "1-for-1"
  | "2-for-1"
  | "1-for-2"
  | "2-for-2"
  | "3-for-1";
export type OpponentFitBand =
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "very_high";
export type AssetClass =
  | "CORE"
  | "STARTER"
  | "REDUNDANT_VALUE"
  | "TRADE_CHIP"
  | "DEPTH_PROTECTION";
export type TradeTag =
  | "UPGRADE_QB"
  | "UPGRADE_RB"
  | "UPGRADE_WR"
  | "UPGRADE_TE"
  | "CONSOLIDATION"
  | "DEPTH_FOR_STAR"
  | "SELL_REDUNDANCY"
  | "PLAYOFF_UPGRADE"
  | "DEPTH_RISK"
  | "LOW_OPPONENT_FIT"
  | "STRONG_MUTUAL_FIT";

export interface AssetCharacterization {
  playerId: string;
  teamId: string;
  position: CanonicalPosition;
  assetClass: AssetClass;
  marginalValue: number;
  acquisitionValue: number;
  starterFrequency: number;
  benchFrequency: number;
  depthContribution: number;
  playoffContribution: number;
  averageProjection: number;
  replacementDifficulty: number;
  positionalRedundancy: number;
}

export interface TradePackage {
  teamAId: string;
  teamBId: string;
  teamAGives: string[];
  teamBGives: string[];
  shape: TradeShape;
}
export interface OpponentFit {
  score: number;
  band: OpponentFitBand;
  starterImpact: number;
  utilityDelta: number;
  depthDelta: number;
  requiredDropBurden: number;
  fillsNeed: boolean;
  losesCriticalStarter: boolean;
  reasons: ExplanationFactor[];
}
export interface TradeSearchResult {
  trade: TradePackage;
  evaluation: TransactionEvaluation;
  opponentTeamId: string;
  opponentFit: OpponentFit;
  marketFairness: MarketFairness;
  teamFitScore: number;
  marketOpportunityScore: number;
  pursuitScore: number;
  rank: number;
  tags: TradeTag[];
  reasons: ExplanationFactor[];
  warnings: EvaluationWarning[];
  downsideRisk: number;
  outgoingMarginalCost: number;
  incomingAcquisitionValue: number;
  dealPlausibility?: DealPlausibility;
  opportunityCategory?: "BEST_OVERALL" | "HIGH_UPSIDE" | "MOST_REALISTIC" | "CONSOLIDATION";
}
export interface MarketFairness {
  score: number;
  band: "advantage_you" | "fair" | "advantage_opponent" | "unavailable";
  confidence: "low" | "medium" | "high";
  youSend: number;
  youReceive: number;
  explanation: string;
}
export interface QuickTeamImpact {
  legal: boolean;
  starterDelta: number;
  depthProxyDelta: number;
  utilityDelta: number;
  requiredDropIds: string[];
}
export interface QuickTradeEvaluation {
  legal: boolean;
  primary: QuickTeamImpact;
  opponent: QuickTeamImpact;
  score: number;
}
export interface SearchInstrumentation {
  playersProcessed: number;
  opponentsSearched: number;
  naiveCandidateCount: number;
  rawCandidatesGenerated: number;
  structuralCandidates: number;
  quickEvaluationsRun: number;
  quickCandidatesRetained: number;
  candidatesPruned: number;
  fullEvaluationsRun: number;
  paretoResults: number;
  totalSearchTimeMs: number;
  plausibilityTimeMs?: number;
  profile?: Record<
    string,
    {
      calls: number;
      totalMs: number;
      averageMs: number;
      maxMs: number;
      cacheHits: number;
      cacheMisses: number;
      uniqueStates: number;
      repeatedStates: number;
    }
  >;
}
export interface TradeSearchResponse {
  status: "READY" | "ENGINE_NOT_READY";
  results: TradeSearchResult[];
  instrumentation: SearchInstrumentation;
  missingRequirements: string[];
}
export interface TradeSearchConfig {
  allowedShapes: TradeShape[];
  myOutgoingPoolSize: number;
  opponentTargetPoolSize: number;
  explorationFraction: number;
  maxQuickCandidatesPerOpponent: number;
  maxCandidatesPerOpponent: number;
  maxFinalResults: number;
  minimumMyUtilityGain: number;
  minimumOpponentFit: OpponentFitBand;
  includeExplorationCandidates: boolean;
}

export type TargetOfferStyle =
  | "CHEAPEST_WINNING_FIT"
  | "BEST_MUTUAL_FIT"
  | "CONSOLIDATION_OFFER"
  | "AGGRESSIVE_OFFER";
export interface TargetOffer {
  style: TargetOfferStyle;
  result: TradeSearchResult;
}
export interface TargetPlayerSearchResult {
  status: "READY" | "ENGINE_NOT_READY";
  targetPlayerId: string;
  targetMarginalGain: number;
  recommendation: "PURSUE" | "DO_NOT_OVERPAY" | "NO_PLAUSIBLE_OFFER";
  offers: TargetOffer[];
  missingRequirements: string[];
  instrumentation: SearchInstrumentation;
  ladder?: OfferLadder;
}

export type WaiverCategory =
  | "IMMEDIATE_STARTER"
  | "SHORT_TERM_INJURY_REPLACEMENT"
  | "HIGH_UPSIDE_STASH"
  | "ROLE_GROWTH_STASH"
  | "DIRECT_HANDCUFF"
  | "INDEPENDENT_HANDCUFF"
  | "BENCH_UPGRADE"
  | "DEPTH_UPGRADE"
  | "BYE_COVERAGE"
  | "INJURY_INSURANCE"
  | "STREAMER"
  | "PURE_DEPTH";
export type WaiverActionability =
  | "URGENT"
  | "STRONG_MOVE"
  | "WORTH_CONSIDERING"
  | "MARGINAL"
  | "IGNORE";
export interface WaiverRecommendation {
  addPlayerId: string;
  dropPlayerId?: string;
  utilityDelta: number;
  adjustedUtilityDelta: number;
  starterDelta: number;
  playoffDelta?: number;
  depthDelta: number;
  optionValueDelta: number;
  dropOpportunityCost: number;
  weeksEvaluated: number;
  needSolved?: CanonicalPosition;
  category: WaiverCategory;
  actionability: WaiverActionability;
  confidence: "low" | "medium" | "high";
  score: number;
  explanations: ExplanationFactor[];
  warnings: EvaluationWarning[];
}
export interface WaiverSearchConfig {
  maxPreFilteredCandidates: number;
  maxPriorityCandidates: number;
  explorationFraction: number;
  maxFinalResults: number;
  minimumUtilityGain: number;
  supportedPositions: CanonicalPosition[];
}
export interface WaiverSearchResponse {
  status: "READY" | "ENGINE_NOT_READY";
  results: WaiverRecommendation[];
  instrumentation: {
    availablePlayers: number;
    preFilteredCandidates: number;
    intelligencePlayersProcessed: number;
    candidatesGenerated: number;
    fullEvaluationsRun: number;
    retainedResults: number;
    totalSearchTimeMs: number;
  };
  missingRequirements: string[];
}

export interface SearchCache {
  baseline: Map<string, RosterEvaluation>;
  removalMarginal: Map<string, number>;
  acquisitionMarginal: Map<string, number>;
}
export interface SearchContext {
  snapshot: LeagueSnapshot;
  primaryTeamId: string;
  cache: SearchCache;
}
