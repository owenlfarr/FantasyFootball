const start = performance.now();
const response = await fetch("http://localhost:3000/api/espn?week=1&includeSearch=1&compact=1", { cache: "no-store" });
const data = await response.json();
const search = data.engine?.search;
const name = (id) => data.playerDirectory?.[id]?.name ?? id;
console.log(JSON.stringify({
  status: response.status, mode: data.dataMode, elapsedMs: Math.round(performance.now() - start),
  diagnostics: search?.intelligence?.providerDiagnostics,
  trade: search?.trades?.instrumentation,
  waiver: search?.waivers?.instrumentation,
  profiles: Object.values(search?.managerProfiles ?? {}).map((profile) => ({ teamId: profile.teamId, sample: profile.sampleSize, confidence: profile.confidence })),
  trades: (search?.trades?.results ?? []).map((result) => ({
    send: result.trade.teamAGives.map(name), receive: result.trade.teamBGives.map(name),
    impact: result.teamFitScore, opponentFit: result.opponentFit.band, market: result.marketFairness.band,
    plausibility: result.dealPlausibility?.band, confidence: result.dealPlausibility?.confidence,
    whyYes: result.dealPlausibility?.reasons[0]?.message, whyNo: result.dealPlausibility?.risks[0]?.message,
    category: result.opportunityCategory,
  })),
}, null, 2));
