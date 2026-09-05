import type { LeagueIntelligence } from "./types";
import type { MarketFairness } from "../search/types";
function packageValue(ids: string[], intel: LeagueIntelligence) {
  return ids
    .map((id) => intel.players[id]?.market)
    .filter((m) => m?.sufficientForMispricing)
    .sort((a, b) => b.value - a.value)
    .reduce(
      (sum, m, index) =>
        sum + m.value * (index === 0 ? 1 : index === 1 ? 0.55 : 0.3),
      0,
    );
}
export function assessMarketFairness(
  sendIds: string[],
  receiveIds: string[],
  intel: LeagueIntelligence,
): MarketFairness {
  const send = packageValue(sendIds, intel),
    receive = packageValue(receiveIds, intel);
  const covered = [...sendIds, ...receiveIds].filter(
    (id) => intel.players[id]?.market.sufficientForMispricing,
  );
  if (covered.length < [...sendIds, ...receiveIds].length)
    return {
      score: 50,
      band: "unavailable",
      confidence: "low",
      youSend: send,
      youReceive: receive,
      explanation: "Independent market coverage is incomplete.",
    };
  const ratio = send / Math.max(1, receive);
  const score = Math.round(Math.max(0, Math.min(100, 50 + 50 * (ratio - 1))));
  const band =
    ratio > 1.15
      ? "advantage_opponent"
      : ratio < 0.85
        ? "advantage_you"
        : "fair";
  const confidence = covered.every(
    (id) => intel.players[id].market.confidence >= 0.72,
  )
    ? "high"
    : covered.every((id) => intel.players[id].market.confidence >= 0.45)
      ? "medium"
      : "low";
  return {
    score,
    band,
    confidence,
    youSend: send,
    youReceive: receive,
    explanation:
      band === "fair"
        ? "The package falls inside the model's market-fair range."
        : band === "advantage_opponent"
          ? "The opponent receives more perceived market value."
          : "You receive more perceived market value.",
  };
}
