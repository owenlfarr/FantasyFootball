import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAddDrop,
  DEFAULT_UTILITY_CONFIG,
  evaluateRoster,
  evaluateTrade,
  findBestDropForAdd,
  getEngineProfile,
  getRosterEvaluationKey,
  normalizeEspnLeague,
  optimizeLineup,
  optimizeLineupIncremental,
  resetEngineProfile,
  validateLeagueSnapshot,
} from "../../src/engine/index";
import type {
  CanonicalPosition,
  LeaguePlayer,
  LeagueSnapshot,
  LineupSlotDefinition,
  PlayerForecast,
  RosterEntry,
} from "../../src/engine/types";

const asOf = "2026-09-01T12:00:00.000Z";
function slot(
  id: number,
  name: string,
  count: number,
  eligible: CanonicalPosition[],
  kind: "active" | "bench" | "ir" = "active",
): LineupSlotDefinition {
  return {
    id: `slot-${id}`,
    espnSlotId: id,
    name,
    count,
    kind,
    eligiblePositions: eligible,
  };
}
function player(
  id: string,
  position: CanonicalPosition,
  means: number[],
  eligible = [position],
  injuryStatus?: string,
): LeaguePlayer {
  const forecasts: PlayerForecast[] = means.map((mean, index) => ({
    playerId: id,
    week: index + 1,
    mean,
    lower: Math.max(0, mean - 5),
    upper: mean + 5,
    availabilityProbability: injuryStatus === "OUT" ? 0 : 1,
    source: "test",
    asOf,
  }));
  return {
    id,
    name: id,
    nflTeam: "TST",
    primaryPosition: position,
    eligiblePositions: eligible,
    injuryStatus,
    forecasts,
    provenance: { source: "test", asOf, retrievedAt: asOf },
  };
}
function snapshot(
  slotDefs: LineupSlotDefinition[],
  teamARoster: RosterEntry[],
  allPlayers: LeaguePlayer[],
  teamBRoster: RosterEntry[] = [],
): LeagueSnapshot {
  const players = Object.fromEntries(allPlayers.map((item) => [item.id, item]));
  for (const entry of teamARoster) players[entry.playerId].rosteredTeamId = "A";
  for (const entry of teamBRoster) players[entry.playerId].rosteredTeamId = "B";
  return {
    id: "L",
    season: 2026,
    name: "Test",
    currentWeek: 1,
    settings: {
      scoring: [{ statId: 53, points: 1, raw: {} }],
      lineupSlots: slotDefs,
      rosterSize: slotDefs
        .filter((item) => item.kind !== "ir")
        .reduce((sum, item) => sum + item.count, 0),
      positionLimits: {},
      irSlots: slotDefs
        .filter((item) => item.kind === "ir")
        .reduce((sum, item) => sum + item.count, 0),
      playoffWeeks: [2],
      regularSeasonWeeks: 2,
      raw: {},
    },
    teams: [
      {
        id: "A",
        name: "A",
        ownerIds: [],
        record: { wins: 0, losses: 0, ties: 0 },
        roster: teamARoster,
      },
      {
        id: "B",
        name: "B",
        ownerIds: [],
        record: { wins: 0, losses: 0, ties: 0 },
        roster: teamBRoster,
      },
    ],
    players,
    freeAgentIds: allPlayers
      .filter((item) => !item.rosteredTeamId)
      .map((item) => item.id),
    waiverPlayerIds: [],
    schedule: [],
    primaryTeamId: "A",
    dataMode: "live",
    provenance: { source: "test", asOf, retrievedAt: asOf },
  };
}
function entry(
  id: string,
  assignedSlotId = 20,
  location: RosterEntry["location"] = "bench",
): RosterEntry {
  return { playerId: id, assignedSlotId, location };
}
function forecasts(s: LeagueSnapshot, week = 1): Map<string, PlayerForecast> {
  return new Map(
    Object.values(s.players).flatMap((item) => {
      const value = item.forecasts.find((forecast) => forecast.week === week);
      return value ? [[item.id, value] as const] : [];
    }),
  );
}

function bruteForce(
  s: LeagueSnapshot,
  roster: RosterEntry[],
  week = 1,
): number {
  const instances = s.settings.lineupSlots
    .filter((item) => item.kind === "active")
    .flatMap((item) => Array.from({ length: item.count }, () => item));
  let best = -Infinity;
  function visit(index: number, used: Set<string>, total: number) {
    if (index === instances.length) {
      best = Math.max(best, total);
      return;
    }
    for (const rosterEntry of roster) {
      const p = s.players[rosterEntry.playerId];
      const f = p.forecasts.find((item) => item.week === week);
      if (
        rosterEntry.location !== "ir" &&
        !p.byeWeeks?.includes(week) &&
        !used.has(p.id) &&
        f &&
        f.availabilityProbability > 0 &&
        p.eligiblePositions.some((position) =>
          instances[index].eligiblePositions.includes(position),
        )
      ) {
        used.add(p.id);
        visit(index + 1, used, total + f.mean * f.availabilityProbability);
        used.delete(p.id);
      }
    }
  }
  visit(0, new Set(), 0);
  return best;
}

test("exact optimizer handles standard, FLEX, shared eligibility, repeated slots, byes/injuries, and specialty slots", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 2, ["RB"]),
    slot(4, "WR", 2, ["WR"]),
    slot(6, "TE", 1, ["TE"]),
    slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    slot(16, "D/ST", 1, ["D/ST"]),
    slot(17, "K", 1, ["K"]),
    slot(19, "HC", 1, ["HC"]),
    slot(20, "BE", 5, [], "bench"),
    slot(21, "IR", 1, [], "ir"),
  ];
  const ps = [
    player("qb", "QB", [20, 20]),
    player("rb1", "RB", [18, 18]),
    player("rb2", "RB", [16, 16]),
    player("rb3", "RB", [15, 15]),
    player("wr1", "WR", [17, 17]),
    player("wr2", "WR", [14, 14]),
    player("wr3", "WR", [19, 19]),
    player("te1", "TE", [10, 10]),
    player("teFlex", "TE", [21, 21]),
    player("dst", "D/ST", [8, 8]),
    player("k", "K", [7, 7]),
    player("hc", "HC", [5, 5]),
    player("out", "WR", [30, 30], ["WR"], "OUT"),
    player("irStar", "WR", [40, 40]),
  ];
  const roster = ps.map((p) => entry(p.id));
  roster[roster.length - 1] = entry("irStar", 21, "ir");
  const s = snapshot(slots, roster, ps);
  s.players.rb3.byeWeeks = [1];
  const result = optimizeLineup(roster, 1, forecasts(s), s.settings, s.players);
  assert.equal(result.legal, true);
  assert.equal(result.assignments.length, 10);
  assert.ok(result.assignments.some((a) => a.playerId === "teFlex"));
  assert.equal(
    result.assignments.find((a) => a.slotName === "FLEX")?.playerId,
    "wr3",
  );
  assert.ok(
    !result.assignments.some((a) => ["out", "rb3"].includes(a.playerId)),
  );
  assert.equal(result.projectedPoints, bruteForce(s, roster));
});

test("FLEX independently chooses the best legal RB, WR, or TE", () => {
  for (const [winner, position] of [
    ["r", "RB"],
    ["w", "WR"],
    ["t", "TE"],
  ] as const) {
    const ps = [
      player("r", "RB", [winner === "r" ? 20 : 8]),
      player("w", "WR", [winner === "w" ? 20 : 8]),
      player("t", "TE", [winner === "t" ? 20 : 8]),
    ];
    const s = snapshot(
      [slot(23, "FLEX", 1, ["RB", "WR", "TE"]), slot(20, "BE", 2, [], "bench")],
      ps.map((p) => entry(p.id)),
      ps,
    );
    const result = optimizeLineup(
      s.teams[0].roster,
      1,
      forecasts(s),
      s.settings,
      s.players,
    );
    assert.equal(result.assignments[0].playerId, winner);
    assert.equal(s.players[winner].primaryPosition, position);
  }
});

test("optimizer matches brute force across randomized small FLEX rosters", () => {
  let seed = 17;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 50; trial++) {
    const slots = [
      slot(2, "RB", 1, ["RB"]),
      slot(4, "WR", 1, ["WR"]),
      slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    ];
    const positions: CanonicalPosition[] = ["RB", "WR", "TE"];
    const ps = Array.from({ length: 6 }, (_, i) =>
      player(
        `p${trial}-${i}`,
        positions[Math.floor(random() * positions.length)],
        [Math.round(random() * 250) / 10],
      ),
    );
    const roster = ps.map((p) => entry(p.id));
    const s = snapshot(slots, roster, ps);
    const exact = optimizeLineup(
      roster,
      1,
      forecasts(s),
      s.settings,
      s.players,
    );
    const brute = bruteForce(s, roster);
    assert.equal(exact.legal, Number.isFinite(brute));
    if (exact.legal) assert.ok(Math.abs(exact.projectedPoints - brute) < 0.001);
  }
});

test("roster evaluator is deterministic and marginal values are roster-relative", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 1, ["RB"]),
    slot(4, "WR", 1, ["WR"]),
    slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    slot(20, "BE", 2, [], "bench"),
  ];
  const ps = [
    player("qb", "QB", [20, 21]),
    player("rb", "RB", [15, 15]),
    player("wr", "WR", [14, 14]),
    player("wrBench", "WR", [13, 13]),
    player("rbBench", "RB", [5, 5]),
    player("teBench", "TE", [4, 4]),
  ];
  const s = snapshot(
    slots,
    ps.map((p) => entry(p.id)),
    ps,
  );
  const a = evaluateRoster(s, "A");
  const b = evaluateRoster(s, "A");
  assert.deepEqual(a, b);
  assert.ok(
    a.playerMarginalValues.find((v) => v.playerId === "qb")!.removalUtility >
      a.playerMarginalValues.find((v) => v.playerId === "teBench")!
        .removalUtility,
  );
});

test("trade evaluator covers 1-for-1, 2-for-1 required drops, consolidation, redundancy, and illegal QB removal", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 1, ["RB"]),
    slot(4, "WR", 1, ["WR"]),
    slot(23, "FLEX", 1, ["RB", "WR"]),
    slot(20, "BE", 2, [], "bench"),
  ];
  const ps = [
    player("aQ", "QB", [20, 20]),
    player("aR1", "RB", [14, 14]),
    player("aR2", "RB", [13, 13]),
    player("aW", "WR", [12, 12]),
    player("aB", "WR", [3, 3]),
    player("aB2", "RB", [12, 12]),
    player("bQ", "QB", [18, 18]),
    player("star", "WR", [22, 22]),
    player("bR", "RB", [11, 11]),
    player("bW", "WR", [10, 10]),
    player("bB", "RB", [4, 4]),
    player("bB2", "WR", [3, 3]),
  ];
  const s = snapshot(
    slots,
    ps.slice(0, 6).map((p) => entry(p.id)),
    ps,
    ps.slice(6).map((p) => entry(p.id)),
  );
  const one = evaluateTrade(s, {
    teamAId: "A",
    teamBId: "B",
    teamAGives: ["aW"],
    teamBGives: ["bW"],
  });
  assert.equal(one.legal, true);
  const consolidation = evaluateTrade(s, {
    teamAId: "A",
    teamBId: "B",
    teamAGives: ["aR1", "aR2"],
    teamBGives: ["star"],
  });
  assert.ok(consolidation.primaryTeam.remainingStarterPointsDelta > 0);
  assert.ok(consolidation.opponentTeam!.requiredDrops.length === 1);
  assert.equal(
    evaluateTrade(s, {
      teamAId: "A",
      teamBId: "B",
      teamAGives: ["aR1"],
      teamBGives: ["bR", "bB2"],
    }).opponentTeam?.requiredDrops.length,
    0,
  );
  assert.equal(
    evaluateTrade(s, {
      teamAId: "A",
      teamBId: "B",
      teamAGives: ["aR1", "aB"],
      teamBGives: ["bR", "bW"],
    }).legal,
    true,
  );
  const illegal = evaluateTrade(s, {
    teamAId: "A",
    teamBId: "B",
    teamAGives: ["aQ"],
    teamBGives: ["bB"],
  });
  assert.equal(illegal.legal, false);
  assert.ok(
    illegal.warnings.some(
      (warning) => warning.code === "MISSING_MANDATORY_STARTER",
    ),
  );
  const redundant = evaluateTrade(s, {
    teamAId: "A",
    teamBId: "B",
    teamAGives: ["aB"],
    teamBGives: ["bB2"],
  });
  assert.ok(redundant.primaryTeam.remainingStarterPointsDelta <= 0);
});

test("add/drop finds starter upgrades, bench-only changes, bad moves, and optimal drops", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 1, ["RB"]),
    slot(4, "WR", 1, ["WR"]),
    slot(20, "BE", 1, [], "bench"),
  ];
  const ps = [
    player("q", "QB", [20, 20]),
    player("r", "RB", [8, 8]),
    player("w", "WR", [10, 10]),
    player("bench", "WR", [2, 2]),
    player("faStar", "RB", [16, 16]),
    player("faBench", "WR", [3, 3]),
    player("faBad", "WR", [1, 1]),
  ];
  const s = snapshot(
    slots,
    ps.slice(0, 4).map((p) => entry(p.id)),
    ps,
  );
  const upgrade = findBestDropForAdd(s, "A", "faStar");
  assert.ok(upgrade.primaryTeam.remainingStarterPointsDelta > 0);
  assert.equal(upgrade.primaryTeam.requiredDrops[0].playerId, "bench");
  const bench = evaluateAddDrop(s, {
    teamId: "A",
    addPlayerId: "faBench",
    dropPlayerId: "bench",
  });
  assert.equal(bench.primaryTeam.remainingStarterPointsDelta, 0);
  const bad = evaluateAddDrop(s, {
    teamId: "A",
    addPlayerId: "faBad",
    dropPlayerId: "bench",
  });
  assert.ok(bad.primaryTeam.netUtilityDelta <= 0);
});

test("add/drop enforces positional limits", () => {
  const ps = [
    player("q", "QB", [20]),
    player("r", "RB", [10]),
    player("w", "WR", [10]),
    player("faR", "RB", [15]),
  ];
  const s = snapshot(
    [
      slot(0, "QB", 1, ["QB"]),
      slot(2, "RB", 1, ["RB"]),
      slot(20, "BE", 1, [], "bench"),
    ],
    ps.slice(0, 3).map((p) => entry(p.id)),
    ps,
  );
  s.settings.positionLimits.RB = 1;
  const result = evaluateAddDrop(s, {
    teamId: "A",
    addPlayerId: "faR",
    dropPlayerId: "w",
  });
  assert.equal(result.legal, false);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "POSITION_LIMIT_EXCEEDED",
    ),
  );
});

test("ESPN normalization preserves scoring, HC/FLEX/IR and rejects unknown or malformed structures", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = {
    id: 1,
    scoringPeriodId: 1,
    settings: {
      name: "League",
      rosterSettings: {
        lineupSlotCounts: { 0: 1, 19: 1, 20: 2, 21: 1, 23: 1 },
        positionLimits: { 1: 2 },
      },
      scoringSettings: {
        scoringItems: [
          { statId: 53, points: 1 },
          { statId: 3, points: 0.04, pointsOverrides: { 300: 3 } },
        ],
      },
      scheduleSettings: {
        matchupPeriodCount: 14,
        playoffTeamCount: 4,
        playoffMatchupPeriodLength: 1,
      },
      acquisitionSettings: { acquisitionType: "WAIVERS_TRADITIONAL" },
      tradeSettings: {},
    },
    teams: [
      {
        id: 7,
        name: "Mine",
        owners: ["owner"],
        record: { overall: { wins: 1, losses: 0, ties: 0 } },
        roster: {
          entries: [
            {
              lineupSlotId: 0,
              playerPoolEntry: {
                player: {
                  id: 1,
                  fullName: "QB",
                  defaultPositionId: 1,
                  proTeamId: 1,
                  stats: [
                    {
                      seasonId: 2026,
                      statSourceId: 1,
                      statSplitTypeId: 1,
                      scoringPeriodId: 1,
                      appliedTotal: 20,
                    },
                  ],
                },
              },
            },
            {
              lineupSlotId: 19,
              playerPoolEntry: {
                player: {
                  id: 2,
                  fullName: "Coach",
                  defaultPositionId: 14,
                  proTeamId: 1,
                  stats: [
                    {
                      seasonId: 2026,
                      statSourceId: 1,
                      statSplitTypeId: 1,
                      scoringPeriodId: 1,
                      appliedTotal: 5,
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    ],
    schedule: [],
  };
  const s = normalizeEspnLeague({
    raw,
    leagueId: "1",
    season: 2026,
    primaryTeamId: "7",
    retrievedAt: asOf,
  });
  assert.equal(s.settings.scoring.length, 2);
  assert.ok(s.settings.lineupSlots.some((item) => item.name === "HC"));
  assert.ok(s.settings.lineupSlots.some((item) => item.name === "FLEX"));
  assert.equal(s.settings.irSlots, 1);
  assert.equal(validateLeagueSnapshot(s).status, "READY");
  const unknown = structuredClone(raw);
  unknown.settings.rosterSettings.lineupSlotCounts[99] = 1;
  assert.throws(
    () =>
      normalizeEspnLeague({
        raw: unknown,
        leagueId: "1",
        season: 2026,
        primaryTeamId: "7",
      }),
    /Unknown ESPN lineup slot/,
  );
  assert.throws(
    () =>
      normalizeEspnLeague({
        raw: {},
        leagueId: "1",
        season: 2026,
        primaryTeamId: "7",
      }),
    /Malformed ESPN response/,
  );
});

test("mock snapshots and missing settings never masquerade as ready live intelligence", () => {
  const s = snapshot([slot(20, "BE", 2, [], "bench")], [], []);
  s.dataMode = "mock";
  s.settings.scoring = [];
  const result = validateLeagueSnapshot(s);
  assert.equal(result.status, "ENGINE_NOT_READY");
  assert.ok(
    result.missingRequirements.includes("scoring configuration unavailable"),
  );
});

test("ESPN FLEX and OP slots do not invent player position eligibility", () => {
  const raw = {
    scoringPeriodId: 1,
    settings: {
      rosterSettings: {
        lineupSlotCounts: { 0: 1, 6: 1, 7: 1, 20: 2 },
        positionLimits: {},
      },
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      scheduleSettings: { matchupPeriodCount: 1 },
      acquisitionSettings: {},
      tradeSettings: {},
    },
    teams: [
      {
        id: 7,
        name: "Mine",
        record: { overall: {} },
        roster: {
          entries: [
            {
              lineupSlotId: 0,
              playerPoolEntry: {
                player: {
                  id: 1,
                  fullName: "Quarterback",
                  defaultPositionId: 1,
                  proTeamId: 1,
                  eligibleSlots: [0, 7, 20],
                  stats: [],
                },
              },
            },
            {
              lineupSlotId: 20,
              playerPoolEntry: {
                player: {
                  id: 2,
                  fullName: "Running Back",
                  defaultPositionId: 2,
                  proTeamId: 1,
                  eligibleSlots: [2, 3, 7, 20, 23],
                  stats: [],
                },
              },
            },
          ],
        },
      },
    ],
  };
  const normalized = normalizeEspnLeague({
    raw,
    leagueId: "1",
    season: 2026,
    primaryTeamId: "7",
    retrievedAt: asOf,
  });
  assert.deepEqual(normalized.players["1"].eligiblePositions, ["QB"]);
  assert.deepEqual(normalized.players["2"].eligiblePositions, ["RB"]);
});

test("evaluation keys are canonical and invalidate on roster, week, forecast, and injury changes", () => {
  const ps = [player("QB1", "QB", [20, 21]), player("QB2", "QB", [18, 19])];
  const roster = [entry("QB1"), entry("QB2")];
  const s = snapshot(
    [slot(0, "QB", 1, ["QB"]), slot(20, "BE", 1, [], "bench")],
    roster,
    ps,
  );
  const key = () =>
    getRosterEvaluationKey(
      s,
      "A",
      roster,
      [1, 2],
      DEFAULT_UTILITY_CONFIG,
      false,
    );
  const original = key();
  assert.equal(
    original,
    getRosterEvaluationKey(
      s,
      "A",
      [...roster].reverse(),
      [1, 2],
      DEFAULT_UTILITY_CONFIG,
      false,
    ),
  );
  s.players.QB1.forecasts[0].mean++;
  assert.notEqual(key(), original);
  s.players.QB1.forecasts[0].mean--;
  s.players.QB1.injuryStatus = "QUESTIONABLE";
  assert.notEqual(key(), original);
  s.players.QB1.injuryStatus = undefined;
  s.currentWeek = 2;
  assert.notEqual(key(), original);
  s.currentWeek = 1;
  assert.notEqual(
    getRosterEvaluationKey(
      s,
      "A",
      [entry("QB1")],
      [1, 2],
      DEFAULT_UTILITY_CONFIG,
      false,
    ),
    original,
  );
});

test("identical lineup and roster states hit their exact caches", () => {
  const ps = [player("QB1", "QB", [20, 21]), player("QB2", "QB", [18, 19])];
  const roster = [entry("QB1"), entry("QB2")];
  const s = snapshot(
    [slot(0, "QB", 1, ["QB"]), slot(20, "BE", 1, [], "bench")],
    roster,
    ps,
  );
  resetEngineProfile();
  optimizeLineup(roster, 1, forecasts(s), s.settings, s.players);
  optimizeLineup(roster, 1, forecasts(s), s.settings, s.players);
  evaluateRoster(s, "A", roster, { includeMarginals: false });
  evaluateRoster(s, "A", roster, { includeMarginals: false });
  const profile = getEngineProfile();
  assert.ok(profile.lineupOptimization.cacheHits >= 1);
  assert.ok(profile.evaluateRoster.cacheHits >= 1);
});

test("incremental optimizer matches full exact optimization across connected FLEX and OP changes", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 2, ["RB"]),
    slot(4, "WR", 2, ["WR"]),
    slot(6, "TE", 1, ["TE"]),
    slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    slot(7, "OP", 1, ["QB", "RB", "WR", "TE"]),
    slot(17, "K", 1, ["K"]),
    slot(16, "D/ST", 1, ["D/ST"]),
    slot(14, "HC", 1, ["HC"]),
    slot(20, "BE", 7, [], "bench"),
  ];
  const positions: CanonicalPosition[] = [
    "QB",
    "QB",
    "RB",
    "RB",
    "RB",
    "WR",
    "WR",
    "WR",
    "TE",
    "TE",
    "K",
    "D/ST",
    "HC",
    "RB",
    "WR",
    "TE",
    "QB",
    "WR",
  ];
  const ps = positions.map((position, index) =>
    player(`P${index}`, position, [
      8 + ((index * 7) % 17),
      7 + ((index * 5) % 18),
    ]),
  );
  const roster = ps.map((candidate) => entry(candidate.id));
  const s = snapshot(slots, roster, ps);
  const replacements: LeaguePlayer[] = [];
  for (let index = 0; index < 80; index++) {
    const position = positions[index % positions.length];
    const candidate = player(`X${index}`, position, [
      5 + ((index * 11) % 24),
      6 + ((index * 13) % 23),
    ]);
    if (index % 13 === 0) candidate.byeWeeks = [2];
    replacements.push(candidate);
    s.players[candidate.id] = candidate;
  }
  let seed = 711;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let matches = 0;
  for (let index = 0; index < 1000; index++) {
    const week = index % 2 ? 1 : 2;
    const next = [...roster];
    const changes = 1 + Math.floor(random() * 3);
    for (let change = 0; change < changes; change++) {
      const rosterIndex = Math.floor(random() * next.length);
      const replacement =
        replacements[Math.floor(random() * replacements.length)];
      next[rosterIndex] = entry(replacement.id);
    }
    const baseline = optimizeLineup(
      roster,
      week,
      forecasts(s, week),
      s.settings,
      s.players,
    );
    const incremental = optimizeLineupIncremental(
      roster,
      baseline,
      next,
      week,
      forecasts(s, week),
      s.settings,
      s.players,
    );
    const exact = optimizeLineup(
      next,
      week,
      forecasts(s, week),
      s.settings,
      s.players,
    );
    assert.equal(incremental.legal, exact.legal);
    assert.ok(
      Math.abs(incremental.projectedPoints - exact.projectedPoints) < 1e-9,
    );
    matches++;
  }
  assert.equal(matches, 1000);
});

test("incremental depth is numerically identical to the legacy full-depth oracle", () => {
  const slots = [
    slot(0, "QB", 1, ["QB"]),
    slot(2, "RB", 1, ["RB"]),
    slot(4, "WR", 1, ["WR"]),
    slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
    slot(17, "K", 1, ["K"]),
    slot(20, "BE", 4, [], "bench"),
  ];
  const ps = [
    player("Q", "QB", [20, 21]),
    player("R1", "RB", [18, 16]),
    player("R2", "RB", [12, 14]),
    player("W1", "WR", [17, 18]),
    player("W2", "WR", [11, 10]),
    player("T", "TE", [9, 12]),
    player("K1", "K", [8, 8]),
    player("K2", "K", [7, 9]),
  ];
  const s = snapshot(
    slots,
    ps.map((candidate) => entry(candidate.id)),
    ps,
  );
  const incremental = evaluateRoster(s, "A", undefined, {
    includeMarginals: false,
    useIncrementalDepth: true,
  });
  const legacy = evaluateRoster(s, "A", undefined, {
    includeMarginals: false,
    useIncrementalDepth: false,
  });
  assert.equal(incremental.depthValue, legacy.depthValue);
  assert.equal(incremental.vulnerabilityPenalty, legacy.vulnerabilityPenalty);
  assert.equal(incremental.utility.total, legacy.utility.total);
  assert.deepEqual(
    incremental.weeklyLineups.map((lineup) => lineup.projectedPoints),
    legacy.weeklyLineups.map((lineup) => lineup.projectedPoints),
  );

  for (let index = 0; index < 50; index++) {
    const replacedIndex = index % ps.length;
    const replaced = ps[replacedIndex];
    const candidate = player(
      `DEPTH-X${index}`,
      replaced.primaryPosition,
      [5 + ((index * 7) % 19), 6 + ((index * 11) % 18)],
      replaced.eligiblePositions,
    );
    s.players[candidate.id] = candidate;
    const changedRoster = ps.map((existing, rosterIndex) =>
      entry(rosterIndex === replacedIndex ? candidate.id : existing.id),
    );
    const changedIncremental = evaluateRoster(s, "A", changedRoster, {
      includeMarginals: false,
      useIncrementalDepth: true,
    });
    const changedLegacy = evaluateRoster(s, "A", changedRoster, {
      includeMarginals: false,
      useIncrementalDepth: false,
    });
    assert.equal(changedIncremental.legal, changedLegacy.legal);
    assert.equal(changedIncremental.depthValue, changedLegacy.depthValue);
    assert.equal(
      changedIncremental.vulnerabilityPenalty,
      changedLegacy.vulnerabilityPenalty,
    );
    assert.equal(
      changedIncremental.utility.total,
      changedLegacy.utility.total,
    );
  }
});

test("required-drop search reuses the exact receiving-roster result", () => {
  const ps = [
    player("Q", "QB", [20, 20]),
    player("R", "RB", [14, 14]),
    player("W", "WR", [12, 12]),
    player("FA", "WR", [16, 16]),
  ];
  const s = snapshot(
    [
      slot(0, "QB", 1, ["QB"]),
      slot(23, "FLEX", 1, ["RB", "WR", "TE"]),
      slot(20, "BE", 1, [], "bench"),
    ],
    [entry("Q"), entry("R"), entry("W")],
    ps,
  );
  resetEngineProfile();
  const first = findBestDropForAdd(s, "A", "FA", {
    baselineEvaluations: new Map([
      ["A", evaluateRoster(s, "A", undefined, { includeMarginals: false })],
    ]),
    includeMarginals: false,
  });
  const second = findBestDropForAdd(s, "A", "FA", {
    baselineEvaluations: new Map([
      ["A", evaluateRoster(s, "A", undefined, { includeMarginals: false })],
    ]),
    includeMarginals: false,
  });
  assert.deepEqual(second, first);
  assert.ok(getEngineProfile().requiredDropSearch.cacheHits >= 1);
});
