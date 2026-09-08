import type { LeagueSnapshot } from "../../types";
import { NflverseUsageProvider } from "./nflverseUsage";
import { StatsGuyMarketProvider } from "./statsGuyMarket";
import type {
  ExternalIntelligenceData,
  MarketDataProvider,
  UsageDataProvider,
} from "./types";

export async function loadExternalIntelligence(
  snapshot: LeagueSnapshot,
  providers: {
    usage?: UsageDataProvider[];
    market?: MarketDataProvider[];
  } = {},
): Promise<ExternalIntelligenceData> {
  const usageProviders = providers.usage ?? [new NflverseUsageProvider()];
  const marketProviders = providers.market ?? [new StatsGuyMarketProvider()];
  const [usageResults, marketResults] = await Promise.all([
    Promise.all(usageProviders.map((provider) => provider.getLeagueUsage(snapshot))),
    Promise.all(marketProviders.map((provider) => provider.getLeagueMarket(snapshot))),
  ]);
  const usage: ExternalIntelligenceData["usage"] = {};
  for (const result of usageResults)
    for (const [id, snapshots] of Object.entries(result.usage))
      usage[id] = [...(usage[id] ?? []), ...snapshots].sort((a, b) => a.week - b.week);
  const marketSources: ExternalIntelligenceData["marketSources"] = {};
  for (const result of marketResults)
    for (const [id, observations] of Object.entries(result.observations))
      marketSources[id] = [...(marketSources[id] ?? []), ...observations];
  return {
    usage,
    marketSources,
    diagnostics: [
      ...usageResults.map((result) => result.diagnostic),
      ...marketResults.map((result) => result.diagnostic),
    ],
  };
}
