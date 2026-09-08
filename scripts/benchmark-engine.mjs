const benchmarkUrl =
  process.env.BENCHMARK_URL ??
  "http://localhost:3000/api/espn?week=1&includeSearch=1";
const runs = Math.max(1, Number.parseInt(process.argv[2] ?? "2", 10));

const rows = [];
for (let run = 1; run <= runs; run++) {
  const started = performance.now();
  const response = await fetch(benchmarkUrl, { cache: "no-store" });
  const body = await response.json();
  const totalMs = Math.round(performance.now() - started);
  const trades = body.engine?.search?.trades?.instrumentation;
  const waivers = body.engine?.search?.waivers?.instrumentation;
  rows.push({
    run,
    kind: run === 1 ? "cold request" : "repeat request",
    status: response.status,
    dataMode: body.dataMode,
    engineStatus: body.engine?.status,
    totalMs,
    tradeMs: trades?.totalSearchTimeMs,
    waiverMs: waivers?.totalSearchTimeMs,
    tradeGenerationMs: trades?.generationTimeMs,
    quickEvaluations: trades?.quickEvaluationsRun,
    fullTradeEvaluations: trades?.fullEvaluationsRun,
    fullWaiverEvaluations: waivers?.fullEvaluationsRun,
    rawTradeCandidates: trades?.rawCandidatesGenerated,
    profile: body.engine?.search?.profile ?? trades?.profile,
  });
}

console.log(JSON.stringify({ benchmarkUrl, runs: rows }, null, 2));
