import type { TradeOfferRecord } from "./types";

export interface PlausibilityCalibrationBand {
  band: NonNullable<TradeOfferRecord["plausibility"]>["band"];
  observations: number;
  accepted: number;
  countered: number;
  rejectedOrIgnored: number;
}
/** Descriptive only: selection-biased offer logs are not acceptance probabilities. */
export function summarizePlausibilityCalibration(records: TradeOfferRecord[]): PlausibilityCalibrationBand[] {
  const bands: PlausibilityCalibrationBand["band"][] = ["very_low", "low", "medium", "high", "very_high"];
  return bands.map((band) => {
    const subset = records.filter((record) => record.plausibility?.band === band && ["accepted", "countered", "rejected", "ignored"].includes(record.status));
    return {
      band, observations: subset.length,
      accepted: subset.filter((record) => record.status === "accepted").length,
      countered: subset.filter((record) => record.status === "countered").length,
      rejectedOrIgnored: subset.filter((record) => record.status === "rejected" || record.status === "ignored").length,
    };
  });
}
