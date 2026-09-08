import type {
  CanonicalPosition,
  DataProvenance,
  LeagueSnapshot,
} from "../types";

export type TrendDirection =
  | "strongly_rising"
  | "rising"
  | "stable"
  | "falling"
  | "strongly_falling"
  | "unknown";
export type ConfidenceBand = "low" | "medium" | "high";
export type RoleChange =
  | "BACKUP_TO_STARTER"
  | "COMMITTEE_TO_LEAD"
  | "STARTER_TO_COMMITTEE"
  | "EVERY_DOWN_ROLE_GAINED"
  | "TEMPORARY_INJURY_FILL_IN"
  | "GOAL_LINE_ROLE_GAINED"
  | "PASSING_DOWN_ROLE_LOST";
export interface UsageMetrics {
  snaps?: number;
  snapShare?: number;
  routes?: number;
  routeParticipation?: number;
  targets?: number;
  targetShare?: number;
  airYards?: number;
  airYardShare?: number;
  redZoneTargets?: number;
  endZoneTargets?: number;
  carries?: number;
  carryShare?: number;
  redZoneCarries?: number;
  goalLineCarries?: number;
  twoMinuteShare?: number;
  thirdDownShare?: number;
  passAttempts?: number;
  designedRushes?: number;
  scrambleRate?: number;
  teamPassRate?: number;
  receptions?: number;
  receivingYards?: number;
  rushingYards?: number;
  touchdowns?: number;
  actualFantasyPoints?: number;
}
export interface UsageSnapshot {
  playerId: string;
  position?: CanonicalPosition;
  season?: number;
  week: number;
  games: number;
  metrics: UsageMetrics;
  provenance: DataProvenance;
}
export interface RoleEstimate {
  opportunityScore?: number;
  roleSecurity?: number;
  highValueTouchScore?: number;
  receivingRole?: number;
  goalLineRole?: number;
  trend: TrendDirection;
  securityBand?: ConfidenceBand;
  structuralChanges?: RoleChange[];
  recentOpportunity?: number;
  priorOpportunity?: number;
  confidence: number;
  evidence: string[];
}
export interface ExpectedProductionEstimate {
  expectedFantasyPoints?: number;
  actualFantasyPoints?: number;
  fantasyPointsOverExpected?: number;
  expectedTouchdowns?: number;
  actualTouchdowns?: number;
  regressionDirection: "positive" | "neutral" | "negative" | "unknown";
  confidence: number;
}
export interface FundamentalPlayerEstimate {
  playerId: string;
  week: number;
  expectedPoints: number;
  median: number;
  floor: number;
  ceiling: number;
  uncertainty: number;
  opportunityScore?: number;
  roleSecurity?: number;
  trend: TrendDirection;
  baselinePoints: number;
  roleAdjustment: number;
  regressionAdjustment: number;
  expectedProduction: ExpectedProductionEstimate;
  confidence: number;
  sources: DataProvenance[];
  modelVersion: string;
}
export interface MarketValueEstimate {
  playerId: string;
  value: number;
  low: number;
  high: number;
  tier: number;
  liquidity: number;
  trend: TrendDirection;
  confidence: number;
  sources: DataProvenance[];
  sufficientForMispricing: boolean;
  modelVersion: string;
  sourceValues?: MarketSourceObservation[];
  independentSourceCount?: number;
}
export interface MarketSourceObservation {
  playerId: string;
  sourcePlayerId?: string;
  source: string;
  value: number;
  rank?: number;
  positionRank?: number;
  trendValue?: number;
  reliability: number;
  asOf: string;
  retrievedAt: string;
  independent: boolean;
}
export interface ProviderDiagnostic {
  provider: string;
  status: "available" | "partial" | "unavailable" | "stale";
  asOf?: string;
  retrievedAt: string;
  records: number;
  mapped: number;
  identityAttempts?: number;
  identityFailures?: number;
  identityFailurePlayerIds?: string[];
  message?: string;
}
export interface PlayerIntelligence {
  playerId: string;
  position: CanonicalPosition;
  fundamental: FundamentalPlayerEstimate;
  market: MarketValueEstimate;
  role: RoleEstimate;
  fundamentalPercentile: number;
  fundamentalTier: number;
  mispricingZ?: number;
  classification: "BUY_LOW" | "SELL_HIGH" | "FAIR" | "INSUFFICIENT_DATA";
  confidence: ConfidenceBand;
  optionValue: number;
  evidence: string[];
  risks: string[];
}
export interface IntelligenceHistoryRecord {
  leagueId: string;
  season: number;
  week: number;
  playerId: string;
  position?: CanonicalPosition;
  asOf: string;
  forecastMean: number;
  actualFuturePoints?: number;
  usage?: UsageSnapshot;
  fundamental: FundamentalPlayerEstimate;
  market: MarketValueEstimate;
  role?: RoleEstimate;
  optionValue?: number;
  classification?: PlayerIntelligence["classification"];
  injuryStatus?: string;
  rosteredTeamId?: string;
  modelVersion: string;
}
export interface PlayerSignal {
  playerId: string;
  signal: "BUY_LOW" | "SELL_HIGH";
  score: number;
  confidence: ConfidenceBand;
  rosterFit: number;
  marketGapZ: number;
  reasons: string[];
  risks: string[];
  bestPartnerTeamIds?: string[];
}
export interface LeagueIntelligence {
  asOf: string;
  modelVersion: string;
  players: Record<string, PlayerIntelligence>;
  buyLow: PlayerSignal[];
  sellHigh: PlayerSignal[];
  dataWarnings: string[];
  usage?: Record<string, UsageSnapshot[]>;
  marketSources?: Record<string, MarketSourceObservation[]>;
  providerDiagnostics?: ProviderDiagnostic[];
}
export interface IntelligenceBuildOptions {
  usage?: Record<string, UsageSnapshot[]>;
  marketSources?: Record<string, MarketSourceObservation[]>;
  providerDiagnostics?: ProviderDiagnostic[];
  history?: IntelligenceHistoryRecord[];
  playerIds?: string[];
}
export interface WalkForwardSample {
  asOf: string;
  playerId: string;
  predicted: number;
  lower: number;
  upper: number;
  baseline: number;
  actual: number;
  position?: CanonicalPosition;
}
export interface ForecastValidation {
  samples: number;
  modelMae: number;
  baselineMae: number;
  modelRmse: number;
  baselineRmse: number;
  rankCorrelation: number;
  baselineRankCorrelation: number;
  intervalCoverage: number;
  beatsBaseline: boolean;
}
export interface IntelligenceHistoryStore {
  append(records: IntelligenceHistoryRecord[]): Promise<void>;
  query(
    leagueId: string,
    season: number,
    asOfExclusive?: string,
  ): Promise<IntelligenceHistoryRecord[]>;
}
export interface IntelligenceContext {
  snapshot: LeagueSnapshot;
  intelligence: LeagueIntelligence;
}
