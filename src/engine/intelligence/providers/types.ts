import type { LeagueSnapshot } from "../../types";
import type {
  MarketSourceObservation,
  ProviderDiagnostic,
  UsageSnapshot,
} from "../types";

export interface UsageProviderResult {
  usage: Record<string, UsageSnapshot[]>;
  diagnostic: ProviderDiagnostic;
}
export interface MarketProviderResult {
  observations: Record<string, MarketSourceObservation[]>;
  diagnostic: ProviderDiagnostic;
}
export interface UsageDataProvider {
  readonly name: string;
  getLeagueUsage(snapshot: LeagueSnapshot): Promise<UsageProviderResult>;
}
export interface MarketDataProvider {
  readonly name: string;
  getLeagueMarket(snapshot: LeagueSnapshot): Promise<MarketProviderResult>;
}
export interface ExternalIntelligenceData {
  usage: Record<string, UsageSnapshot[]>;
  marketSources: Record<string, MarketSourceObservation[]>;
  diagnostics: ProviderDiagnostic[];
}
