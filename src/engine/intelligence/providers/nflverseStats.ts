import { optionalNumber } from "./csv";

export type NflverseStatRow = Record<string, string>;

const teamWeekKey = (row: NflverseStatRow) =>
  `${row.season}:${row.week}:${row.team}`;

/** Shared historical/live denominator for the serialized V6 RB volume feature. */
export function nflverseTeamCarryTotals(rows: NflverseStatRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = teamWeekKey(row);
    totals.set(key, (totals.get(key) ?? 0) + (optionalNumber(row.carries) ?? 0));
  }
  return totals;
}

export function nflverseCarryShare(
  row: NflverseStatRow,
  totals: ReadonlyMap<string, number>,
) {
  const carries = optionalNumber(row.carries);
  const teamCarries = totals.get(teamWeekKey(row));
  return carries !== undefined && teamCarries ? carries / teamCarries : undefined;
}
