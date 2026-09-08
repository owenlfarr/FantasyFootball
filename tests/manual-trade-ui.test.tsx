import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { TeamSnapshot } from "../app/data";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ManualTradeBuilder } = await import("../app/components/ManualTradeBuilder");
const { default: Home, TopBar } = await import("../app/page");
const team = { teamName: "Mine", abbreviation: "M", week: 1, record: "0-0", projected: 0, players: [{ id: "mine", name: "Mine Player", initials: "MP", team: "TST", position: "WR", slot: "WR", group: "Starters", projected: 10, opponent: "W1", isStarter: true }], teams: [{ id: "A", name: "Mine", players: [] }, { id: "B", name: "Other", players: [{ id: "other", name: "Other Player", initials: "OP", team: "TST", position: "RB", slot: "RB", group: "Starters", projected: 10, opponent: "W1", isStarter: true }] }], primaryTeamId: "A", source: "ESPN", dataMode: "live", sync: { lastSuccessfulAt: new Date().toISOString() }, engine: { status: "ENGINE_NOT_READY", missingRequirements: [], warnings: [], asOf: "now" } } as TeamSnapshot;

test("manual builder filters the primary team out and disables empty evaluation", () => {
  render(<ManualTradeBuilder team={team} onRefresh={async () => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: /Make Trade/ }));
  const opponent = screen.getByRole("combobox");
  assert.equal(opponent.querySelectorAll("option").length, 2);
  fireEvent.change(opponent, { target: { value: "B" } });
  assert.equal(screen.getByRole("button", { name: "Evaluate Trade" }).hasAttribute("disabled"), true);
  cleanup();
});

test("manual builder selects both sides and removes summary chips without evaluating", () => {
  render(<ManualTradeBuilder team={team} onRefresh={async () => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: /Make Trade/ }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "B" } });
  const checkboxes = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxes[0]);
  fireEvent.click(checkboxes[1]);
  assert.ok(screen.getByText("Mine Player ×"));
  assert.ok(screen.getByText("Other Player ×"));
  fireEvent.click(screen.getByText("Mine Player ×"));
  assert.equal(screen.queryByText("Mine Player ×"), null);
  cleanup();
});

const result = {
  verdict: "GOOD FOR YOU",
  evaluationTimeMs: 4.2,
  evaluation: {
    legal: true,
    warnings: [],
    primaryTeam: { netUtilityDelta: 8, remainingStarterPointsDelta: 4, depthDelta: 2, playoffPointsDelta: 3, weeklyStarterDeltas: { 1: 4 }, requiredDrops: [{ playerId: "mine" }], before: { utility: { total: 100 } }, after: { utility: { total: 108 } } },
    opponentTeam: { netUtilityDelta: -2, requiredDrops: [{ playerId: "other" }] },
  },
  opponentFit: { band: "medium" }, marketFairness: { band: "fair" }, plausibility: { band: "low" },
  beforeAssignments: [{ slotInstanceId: "WR-1", slotName: "WR", playerId: "mine" }],
  afterAssignments: [{ slotInstanceId: "WR-1", slotName: "WR", playerId: "other" }],
  explanations: [{ code: "STARTER_GAIN", direction: "positive", message: "The optimized starter improves." }],
} as const;

function selectPackage() {
  fireEvent.click(screen.getByRole("button", { name: /Make Trade/ }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "B" } });
  screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
}

function selectAllPlayers() {
  fireEvent.click(screen.getByRole("button", { name: /Make Trade/ }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "B" } });
  screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
}

test("manual builder submits a 3-for-3 package only on evaluation", async () => {
  const extraMine = ["Mine 2", "Mine 3"].map((name, index) => ({ ...team.players[0], id: `mine-${index + 2}`, name, initials: `M${index + 2}` }));
  const other = team.teams!.find((candidate) => candidate.id === "B")!;
  const extraTheirs = ["Other 2", "Other 3"].map((name, index) => ({ ...other?.players[0], id: `other-${index + 2}`, name, initials: `O${index + 2}` }));
  const expandedTeam = { ...team, players: [...team.players, ...extraMine], teams: team.teams?.map((candidate) => candidate.id === "B" ? { ...candidate, players: [...candidate.players, ...extraTheirs] } : candidate) };
  const originalFetch = globalThis.fetch;
  const requests: Array<{ teamAGives: string[]; teamBGives: string[] }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as { teamAGives: string[]; teamBGives: string[] });
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  render(<ManualTradeBuilder team={expandedTeam} onRefresh={async () => undefined} />);
  selectAllPlayers();
  assert.equal(requests.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Evaluate Trade" }));
  await screen.findByText("GOOD FOR YOU");
  assert.equal(requests[0].teamAGives.length, 3);
  assert.equal(requests[0].teamBGives.length, 3);
  globalThis.fetch = originalFetch;
  cleanup();
});

test("manual builder refreshes stale data, evaluates, renders drops and lineup changes, then re-evaluates", async () => {
  let refreshes = 0, requests = 0;
  const staleTeam = { ...team, sync: { lastSuccessfulAt: new Date(Date.now() - 700_000).toISOString() } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests++;
    assert.equal(input, "/api/espn");
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  render(<ManualTradeBuilder team={staleTeam} onRefresh={async () => { refreshes++; }} />);
  selectPackage();
  fireEvent.click(screen.getByRole("button", { name: "Evaluate Trade" }));
  assert.ok(await screen.findByText("GOOD FOR YOU"));
  assert.equal(refreshes, 1);
  assert.equal(requests, 1);
  assert.ok(screen.getByText(/Roster move required: Mine Player/));
  assert.ok(screen.getByText(/Opponent required drop: Other Player/));
  assert.ok(document.querySelector(".manual-lineup-row.changed-lineup"));
  fireEvent.click(screen.getByText("Mine Player ×"));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Re-evaluate" }));
  await waitFor(() => assert.equal(requests, 2));
  assert.equal([...document.querySelectorAll("button")].some((button) => /Mark sent/i.test(button.textContent ?? "")), false);
  globalThis.fetch = originalFetch;
  cleanup();
});

test("illegal evaluation is labeled invalid rather than receiving a quality verdict", async () => {
  const originalFetch = globalThis.fetch;
  const invalid = { ...result, verdict: "INVALID TRADE", evaluation: { ...result.evaluation, legal: false, warnings: [{ code: "MISSING_MANDATORY_STARTER", message: "A QB starter is missing." }] } };
  globalThis.fetch = async () => new Response(JSON.stringify(invalid), { status: 200, headers: { "Content-Type": "application/json" } });
  render(<ManualTradeBuilder team={team} onRefresh={async () => undefined} />);
  selectPackage();
  fireEvent.click(screen.getByRole("button", { name: "Evaluate Trade" }));
  assert.ok(await screen.findByText("INVALID TRADE"));
  assert.equal(screen.queryByText("GOOD FOR YOU"), null);
  assert.ok(screen.getByText(/This trade is not legal: A QB starter is missing/));
  globalThis.fetch = originalFetch;
  cleanup();
});

test("manual builder displays API validation failures without creating a result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Every selected player must belong to the selected roster." }), { status: 400, headers: { "Content-Type": "application/json" } });
  render(<ManualTradeBuilder team={team} onRefresh={async () => undefined} />);
  selectPackage();
  fireEvent.click(screen.getByRole("button", { name: "Evaluate Trade" }));
  assert.ok(await screen.findByText("Every selected player must belong to the selected roster."));
  assert.equal(screen.queryByText("TRADE RESULT"), null);
  globalThis.fetch = originalFetch;
  cleanup();
});

test("header renders stale status with the retained successful-sync age", async () => {
  render(<TopBar week={1} setWeek={() => undefined} onSync={async () => undefined} syncState="STALE" lastSuccessfulAt={Date.now() - 14 * 60_000} />);
  assert.ok(screen.getByText(/ESPN • Stale/));
  await waitFor(() => assert.ok(screen.getByText("Updated 14m ago")));
  cleanup();
});

test("a week change queues the new week when a manual refresh is already in flight", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const resolvers: Array<(response: Response) => void> = [];
  const payload = (week: number) => ({
    teamName: "Mine",
    abbreviation: "M",
    week,
    record: "0-0",
    projected: 0,
    players: [],
    teams: [],
    primaryTeamId: "A",
    source: "ESPN",
    dataMode: "live",
    sync: { lastSuccessfulAt: new Date().toISOString() },
    engine: { status: "ENGINE_NOT_READY", missingRequirements: [], warnings: [], asOf: "now" },
  });
  globalThis.fetch = (input) => {
    requests.push(String(input));
    return new Promise<Response>((resolve) => resolvers.push(resolve));
  };
  try {
    render(<Home />);
    assert.equal(requests.length, 1);
    resolvers.shift()?.(new Response(JSON.stringify(payload(1)), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => assert.equal(screen.getByRole("button", { name: "Refresh ESPN data" }).hasAttribute("disabled"), false));

    await waitFor(() => assert.equal(requests.length, 1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh ESPN data" }));
    await waitFor(() => assert.equal(requests.length, 2));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    assert.equal(requests.length, 2);
    resolvers.shift()?.(new Response(JSON.stringify(payload(1)), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => assert.equal(requests.length, 3));
    assert.match(requests[2], /week=2/);
    resolvers.shift()?.(new Response(JSON.stringify(payload(2)), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => assert.equal(screen.getByText("Week 2") !== null, true));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});
