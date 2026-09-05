export type DataMode = "live" | "stale" | "mock";

export interface DataProvenance {
  source: string;
  asOf: string;
  retrievedAt: string;
  version?: string;
}

export type CanonicalPosition =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "K"
  | "D/ST"
  | "HC"
  | "DL"
  | "LB"
  | "DB"
  | "P"
  | "UNKNOWN";

export type SlotKind = "active" | "bench" | "ir";

export interface LineupSlotDefinition {
  id: string;
  espnSlotId: number;
  name: string;
  count: number;
  kind: SlotKind;
  eligiblePositions: CanonicalPosition[];
}

export interface ScoringRule {
  statId: number;
  points: number;
  overrides?: Record<string, number>;
  raw: Record<string, unknown>;
}

export interface LeagueSettings {
  scoring: ScoringRule[];
  receptionPoints?: number;
  lineupSlots: LineupSlotDefinition[];
  rosterSize: number;
  positionLimits: Partial<Record<CanonicalPosition, number>>;
  irSlots: number;
  playoffTeamCount?: number;
  playoffWeeks: number[];
  regularSeasonWeeks?: number;
  waiverSystem?: string;
  acquisitionLimit?: number;
  faabBudget?: number;
  tradeDeadline?: number;
  rosterLockMode?: string;
  raw: Record<string, unknown>;
}

export interface PlayerForecast {
  playerId: string;
  week: number;
  mean: number;
  lower: number;
  upper: number;
  availabilityProbability: number;
  source: string;
  asOf: string;
  version?: string;
}

export interface PlayerActual {
  playerId: string;
  week: number;
  points: number;
  stats?: Record<string, number>;
  source: string;
  asOf: string;
}

export interface PlayerMarketInputs {
  percentOwned?: number;
  percentStarted?: number;
  ownershipChange?: number;
  averageDraftPosition?: number;
}

export interface LeaguePlayer {
  id: string;
  name: string;
  nflTeam: string;
  primaryPosition: CanonicalPosition;
  eligiblePositions: CanonicalPosition[];
  injuryStatus?: string;
  byeWeeks?: number[];
  rosteredTeamId?: string;
  waiverStatus?: "FREE_AGENT" | "WAIVERS" | "ROSTERED" | "UNKNOWN";
  forecasts: PlayerForecast[];
  actuals?: PlayerActual[];
  market?: PlayerMarketInputs;
  externalIds?: {
    espn?: string;
    gsis?: string;
    sleeper?: string;
  };
  provenance: DataProvenance;
}

export interface RosterEntry {
  playerId: string;
  assignedSlotId: number;
  location: SlotKind;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  pointsFor?: number;
}

export interface LeagueTeam {
  id: string;
  name: string;
  abbreviation?: string;
  ownerIds: string[];
  record: TeamRecord;
  roster: RosterEntry[];
  waiverRank?: number;
  faabRemaining?: number;
}

export interface FantasyMatchup {
  week: number;
  homeTeamId?: string;
  awayTeamId?: string;
  homeScore?: number;
  awayScore?: number;
}

export interface LeagueSnapshot {
  id: string;
  season: number;
  name: string;
  currentWeek: number;
  settings: LeagueSettings;
  teams: LeagueTeam[];
  players: Record<string, LeaguePlayer>;
  freeAgentIds: string[];
  waiverPlayerIds: string[];
  schedule: FantasyMatchup[];
  primaryTeamId: string;
  dataMode: DataMode;
  provenance: DataProvenance;
}

export interface SnapshotValidation {
  status: "READY" | "ENGINE_NOT_READY";
  missingRequirements: string[];
  warnings: string[];
}

export interface LineupAssignment {
  slotInstanceId: string;
  slotName: string;
  playerId: string;
  projectedPoints: number;
}

export interface LineupEvaluation {
  week: number;
  legal: boolean;
  projectedPoints: number;
  assignments: LineupAssignment[];
  benchPlayerIds: string[];
  missingSlots: string[];
  warnings: EvaluationWarning[];
}

export interface EvaluationWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  playerIds?: string[];
  weeks?: number[];
}

export interface PositionStrength {
  position: CanonicalPosition;
  starterPointsPerWeek: number;
  internalReplacementPointsPerWeek: number;
  waiverReplacementPointsPerWeek: number;
  vulnerabilityPoints: number;
}

export interface PlayerMarginalValue {
  playerId: string;
  removalUtility: number;
  starterPointsLost: number;
  depthLost: number;
  weeksStarted: number[];
}

export interface ByeWeekVulnerability {
  week: number;
  position: CanonicalPosition;
  missingSlots: number;
  projectedLoss: number;
}

export interface ConfidenceSummary {
  level: "high" | "medium" | "low";
  forecastCoverage: number;
  missingForecasts: number;
  notes: string[];
}

export interface UtilityComponents {
  regularSeasonStarterPoints: number;
  playoffStarterPoints: number;
  depthValue: number;
  vulnerabilityPenalty: number;
  total: number;
}

export interface RosterEvaluation {
  teamId: string;
  legal: boolean;
  weeklyLineups: LineupEvaluation[];
  expectedRemainingStarterPoints: number;
  expectedPlayoffStarterPoints?: number;
  positionalStrengths: PositionStrength[];
  depthValue: number;
  injuryResilience: number;
  vulnerabilityPenalty: number;
  playerMarginalValues: PlayerMarginalValue[];
  byeWeekVulnerabilities: ByeWeekVulnerability[];
  eliteAssetCount: number;
  starterConcentration: number;
  benchRedundancy: number;
  utility: UtilityComponents;
  warnings: EvaluationWarning[];
  dataConfidence: ConfidenceSummary;
}

export interface RosterUtilityConfig {
  regularSeasonWeight: number;
  playoffWeight: number;
  depthWeight: number;
  vulnerabilityPenaltyWeight: number;
  positionMissedGameProbability: Partial<Record<CanonicalPosition, number>>;
}

export interface RequiredDrop {
  teamId: string;
  playerId: string;
  utilityCost: number;
}

export interface PositionChange {
  position: CanonicalPosition;
  starterPointsDelta: number;
  replacementPointsDelta: number;
  vulnerabilityDelta: number;
}

export interface ExplanationFactor {
  code: string;
  direction: "positive" | "negative" | "neutral";
  metric: string;
  before?: number;
  after?: number;
  delta?: number;
  weeks?: number[];
  playerIds?: string[];
  message: string;
}

export interface TeamTransactionImpact {
  teamId: string;
  before: RosterEvaluation;
  after: RosterEvaluation;
  weeklyStarterDeltas: Record<number, number>;
  remainingStarterPointsDelta: number;
  playoffPointsDelta?: number;
  depthDelta: number;
  injuryResilienceDelta: number;
  netUtilityDelta: number;
  requiredDrops: RequiredDrop[];
  positionalChanges: PositionChange[];
  explanations: ExplanationFactor[];
  warnings: EvaluationWarning[];
}

export interface TransactionEvaluation {
  legal: boolean;
  primaryTeam: TeamTransactionImpact;
  opponentTeam?: TeamTransactionImpact;
  plausibility?: {
    level: "Low" | "Medium" | "High";
    confidence: "Low";
    descriptors: string[];
  };
  warnings: EvaluationWarning[];
}

export interface PositionalNeed {
  position: CanonicalPosition;
  needScore: number;
  level: "High" | "Medium" | "Low";
  reasons: string[];
}
