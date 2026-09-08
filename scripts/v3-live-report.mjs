const requestStarted = performance.now();
const response = await fetch(
  "http://localhost:3000/api/espn?week=1&includeSearch=1",
  { cache: "no-store" },
);
const dashboard = await response.json();
const requestTimeMs = Math.round(performance.now() - requestStarted);
const search = dashboard.engine?.search;
const playerName = (id) => dashboard.playerDirectory?.[id]?.name ?? id;
const trades = (search?.trades?.results ?? []).slice(0, 5).map((result) => ({
  send: result.trade.teamAGives.map(playerName),
  receive: result.trade.teamBGives.map(playerName),
  utility: result.evaluation.primaryTeam.netUtilityDelta,
  starter: result.evaluation.primaryTeam.remainingStarterPointsDelta,
  playoff: result.evaluation.primaryTeam.playoffPointsDelta,
  depth: result.evaluation.primaryTeam.depthDelta,
  teamFit: result.teamFitScore,
  pursuit: result.pursuitScore,
  opponentFit: result.opponentFit.band,
  market: result.marketFairness.band,
  tags: result.tags,
}));
const signals = (items = []) =>
  items.slice(0, 8).map((signal) => ({
    player: playerName(signal.playerId),
    score: signal.score,
    gap: signal.marketGapZ,
    fit: signal.rosterFit,
    confidence: signal.confidence,
    classification: signal.classification,
    reasons: signal.reasons,
  }));
const waivers = (search?.waivers?.results ?? []).slice(0, 8).map((move) => ({
  add: playerName(move.addPlayerId),
  drop: move.dropPlayerId ? playerName(move.dropPlayerId) : null,
  action: move.actionability,
  category: move.category,
  utility: move.utilityDelta,
  adjusted: move.adjustedUtilityDelta,
  starter: move.starterDelta,
  option: move.optionValueDelta,
  confidence: move.confidence,
}));
console.log(
  JSON.stringify(
    {
      status: response.status,
      mode: dashboard.dataMode,
      engine: dashboard.engine?.status,
      team: dashboard.teamName,
      asOf: dashboard.engine?.asOf,
      requestTimeMs,
      tradeInstrumentation: search?.trades?.instrumentation,
      waiverInstrumentation: search?.waivers?.instrumentation,
      fullRequestProfile: search?.profile,
      trades,
      buyLow: signals(search?.buyLow),
      sellHigh: signals(search?.sellHigh),
      waivers,
      intelligenceWarnings: search?.intelligence?.dataWarnings,
    },
    null,
    2,
  ),
);
