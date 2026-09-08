import type {
  CanonicalPosition,
  LeagueSnapshot,
  PositionalNeed,
  RosterEvaluation,
} from "../types";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function derivePositionalNeeds(
  snapshot: LeagueSnapshot,
  teamId: string,
  evaluations: RosterEvaluation[],
): PositionalNeed[] {
  const target = evaluations.find((evaluation) => evaluation.teamId === teamId);
  if (!target) return [];
  const positions = target.positionalStrengths
    .map((strength) => strength.position)
    .filter((position) => !["K", "D/ST", "HC", "P"].includes(position));
  return positions
    .map((position) => {
      const strength = target.positionalStrengths.find(
        (item) => item.position === position,
      )!;
      const peers = evaluations.map(
        (evaluation) =>
          evaluation.positionalStrengths.find(
            (item) => item.position === position,
          )?.starterPointsPerWeek ?? 0,
      );
      const depthPeers = evaluations.map(
        (evaluation) =>
          evaluation.positionalStrengths.find(
            (item) => item.position === position,
          )?.internalReplacementPointsPerWeek ?? 0,
      );
      const starterMedian = median(peers);
      const depthMedian = median(depthPeers);
      const starterGap = Math.max(
        0,
        starterMedian - strength.starterPointsPerWeek,
      );
      const depthGap = Math.max(
        0,
        depthMedian - strength.internalReplacementPointsPerWeek,
      );
      const below = peers.filter(
        (value) => value < strength.starterPointsPerWeek,
      ).length;
      const weaknessPercentile =
        peers.length <= 1 ? 50 : 100 * (1 - below / (peers.length - 1));
      const needScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            0.7 * weaknessPercentile +
              Math.min(30, starterGap * 5 + depthGap * 2),
          ),
        ),
      );
      const reasons: string[] = [];
      if (starterGap >= 0.1)
        reasons.push(
          `${position} starters project ${starterGap.toFixed(1)} points per week below the league median.`,
        );
      else
        reasons.push(
          `${position} starter production is at or above the league median.`,
        );
      if (depthGap >= 0.1)
        reasons.push(
          `Internal ${position} replacement is ${depthGap.toFixed(1)} points below league-median depth.`,
        );
      if (strength.vulnerabilityPoints >= 1)
        reasons.push(
          `${strength.vulnerabilityPoints.toFixed(1)} scenario-weighted points are exposed to unavailability.`,
        );
      const level: PositionalNeed["level"] =
        needScore >= 67 ? "High" : needScore >= 34 ? "Medium" : "Low";
      return {
        position: position as CanonicalPosition,
        needScore,
        level,
        reasons,
      };
    })
    .sort((a, b) => b.needScore - a.needScore);
}
