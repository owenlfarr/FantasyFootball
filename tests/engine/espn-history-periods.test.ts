import assert from "node:assert/strict";
import test from "node:test";
import { weeklyPeriods } from "../../src/server/espnLeague";

test("weekly enrichment does not duplicate the canonical or requested future period", () => {
  const periods = weeklyPeriods(5, 8, 7);
  assert.deepEqual(periods, [6, 7, 8]);
  assert.equal(periods.filter((week) => week === 5).length, 0);
  assert.equal(periods.filter((week) => week === 7).length, 1);
});
