const started = performance.now();
const response = await fetch(
  "http://localhost:3000/api/espn?week=1&includeSearch=1",
  { cache: "no-store" },
);
const dashboard = await response.json();
const search = dashboard.engine?.search;
const name = (id) => dashboard.playerDirectory?.[id]?.name ?? id;
const intelligence = search?.intelligence;
const rostered = Object.keys(intelligence?.players ?? {});
const skill = rostered.filter((id) => {
  const position = intelligence.players[id]?.position;
  return ["RB", "WR", "TE"].includes(position);
});
const usageMapped = skill.filter(
  (id) => (intelligence?.usage?.[id]?.length ?? 0) > 0,
);
const marketMapped = rostered.filter(
  (id) => (intelligence.players[id]?.market.independentSourceCount ?? 0) > 0,
);
const player = (playerName) => {
  const id = Object.keys(dashboard.playerDirectory ?? {}).find(
    (candidate) => dashboard.playerDirectory[candidate].name === playerName,
  );
  const intel = id ? intelligence?.players[id] : undefined;
  return intel
    ? {
        player: playerName,
        fundamental: intel.fundamental,
        market: intel.market,
        role: intel.role,
        tier: intel.fundamentalTier,
        classification: intel.classification,
        confidence: intel.confidence,
        optionValue: intel.optionValue,
        evidence: intel.evidence,
        risks: intel.risks,
      }
    : { player: playerName, available: false };
};
const trades = (search?.trades?.results ?? []).slice(0, 5).map((result) => ({
  send: result.trade.teamAGives.map(name),
  receive: result.trade.teamBGives.map(name),
  utility: result.evaluation.primaryTeam.netUtilityDelta,
  starter: result.evaluation.primaryTeam.remainingStarterPointsDelta,
  depth: result.evaluation.primaryTeam.depthDelta,
  opponentFit: result.opponentFit.band,
  marketFairness: result.marketFairness.band,
}));
const signal = (item) => ({
  player: name(item.playerId),
  score: item.score,
  marketGapZ: item.marketGapZ,
  rosterFit: item.rosterFit,
  confidence: item.confidence,
  reasons: item.reasons,
  risks: item.risks,
});
console.log(JSON.stringify({
  status: response.status,
  dataMode: dashboard.dataMode,
  engine: dashboard.engine?.status,
  requestTimeMs: Math.round(performance.now() - started),
  diagnostics: intelligence?.providerDiagnostics,
  coverage: {
    rosteredPlayers: rostered.length,
    rosteredRbWrTe: skill.length,
    usageMapped: usageMapped.length,
    marketMapped: marketMapped.length,
  },
  trade: search?.trades?.instrumentation,
  waivers: search?.waivers?.instrumentation,
  trades,
  plausibility: (search?.trades?.results ?? []).slice(0, 5).map((result) => ({
    send: result.trade.teamAGives.map(name),
    receive: result.trade.teamBGives.map(name),
    teamImpact: result.teamFitScore,
    opponentFit: result.opponentFit.band,
    marketFairness: result.marketFairness.band,
    plausibility: result.dealPlausibility,
    category: result.opportunityCategory,
  })),
  managerProfiles: Object.values(search?.managerProfiles ?? {}).map((profile) => ({
    teamId: profile.teamId,
    sampleSize: profile.sampleSize,
    tradeFrequency: profile.tradeFrequency,
    depthPreference: profile.depthPreference,
    consolidationPreference: profile.consolidationPreference,
    confidence: profile.confidence,
  })),
  buyLow: (search?.buyLow ?? []).slice(0, 8).map(signal),
  sellHigh: (search?.sellHigh ?? []).slice(0, 8).map(signal),
  waiverMoves: (search?.waivers?.results ?? []).slice(0, 8).map((move) => ({
    add: name(move.addPlayerId),
    drop: move.dropPlayerId ? name(move.dropPlayerId) : null,
    actionability: move.actionability,
    category: move.category,
    adjustedUtility: move.adjustedUtilityDelta,
    starter: move.starterDelta,
  })),
  focusedPlayers: [
    player("Marvin Harrison Jr."),
    player("Matthew Golden"),
    player("Breece Hall"),
  ],
}, null, 2));
