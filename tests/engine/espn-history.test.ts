import assert from "node:assert/strict";
import test from "node:test";
import { weeklyPeriods } from "../../src/server/espnLeague";

test("historical display weeks are supplemented without changing the canonical current week", () => {
  const periods = weeklyPeriods(5, 18, 2);
  assert.ok(periods.includes(2), "the requested earlier week must be fetched for forecasts");
  assert.ok(periods.includes(6), "future weekly enrichment remains available");
  assert.equal(periods.filter((week) => week === 2).length, 1);
  assert.ok(!periods.includes(5), "the canonical base response already supplies the current week");
});
