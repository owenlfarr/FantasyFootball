"use client";

import { useState } from "react";
import type { LeagueTeamSummary, TeamSnapshot } from "../data";
import type { ManualTradeEvaluation } from "../../src/engine/transactions/evaluateManualTrade";

type LineupItem = ManualTradeEvaluation["beforeAssignments"][number];

export function ManualTradeBuilder({ team, onRefresh }: { team: TeamSnapshot; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [opponentId, setOpponentId] = useState("");
  const [mine, setMine] = useState<string[]>([]);
  const [theirs, setTheirs] = useState<string[]>([]);
  const [query, setQuery] = useState({ mine: "", theirs: "" });
  const [result, setResult] = useState<ManualTradeEvaluation>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const opponent = team.teams?.find((candidate) => candidate.id === opponentId);
  const player = (id?: string) => id ? [...team.players, ...(opponent?.players ?? [])].find((candidate) => candidate.id === id) : undefined;
  const toggle = (items: string[], id: string) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id];

  const evaluate = async () => {
    setMessage("");
    if (!opponentId || !mine.length || !theirs.length) {
      setMessage("Choose an opponent and at least one player from each side.");
      return;
    }
    if (!team.sync?.lastSuccessfulAt || Date.now() - Date.parse(team.sync.lastSuccessfulAt) >= 600_000) await onRefresh();
    setBusy(true);
    try {
      const response = await fetch("/api/espn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamBId: opponentId, teamAGives: mine, teamBGives: theirs, perspective: team.selectedPerspective ?? "MY_TEAM" }) });
      const payload = await response.json() as ManualTradeEvaluation & { code?: string; error?: string };
      if (!response.ok) throw new Error(payload.code === "REFRESH_REQUIRED" ? "Refresh ESPN before evaluating this trade." : payload.error ?? "Trade could not be evaluated.");
      setResult(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trade could not be evaluated.");
    } finally {
      setBusy(false);
    }
  };

  const roster = (summary: LeagueTeamSummary, side: "mine" | "theirs") => summary.players
    .filter((candidate) => `${candidate.name} ${candidate.position} ${candidate.team}`.toLowerCase().includes(query[side].toLowerCase()))
    .map((candidate) => {
      const selected = (side === "mine" ? mine : theirs).includes(candidate.id);
      return <label aria-label={`${side === "mine" ? "Send" : "Receive"} ${candidate.name}`} className={`trade-player-row ${selected ? "selected" : ""}`} key={candidate.id} htmlFor={`trade-${side}-${candidate.id}`}>
        <input id={`trade-${side}-${candidate.id}`} type="checkbox" checked={selected} onChange={() => side === "mine" ? setMine(toggle(mine, candidate.id)) : setTheirs(toggle(theirs, candidate.id))} />
        <span><b>{candidate.name}</b><small>{candidate.position} · {candidate.team} · {candidate.projected.toFixed(1)} PPG · {candidate.isStarter ? "Starter" : "Bench"}</small></span>
      </label>;
    });

  const impact = result?.evaluation.primaryTeam;
  const opponentImpact = result?.evaluation.opponentTeam;
  const beforeBySlot = new Map(result?.beforeAssignments.map((item) => [item.slotInstanceId, item]) ?? []);
  const afterBySlot = new Map(result?.afterAssignments.map((item) => [item.slotInstanceId, item]) ?? []);
  const lineupSlots = [...new Set([...beforeBySlot.keys(), ...afterBySlot.keys()])];
  const lineupName = (item?: LineupItem) => player(item?.playerId)?.name ?? item?.playerId ?? "Empty";

  return <section className="manual-trade card">
    <div className="manual-trade-head"><div><small>MANUAL EVALUATOR</small><h2>Build a trade</h2></div><button className="make-trade-button" onClick={() => setOpen((value) => !value)}>{open ? "− Close" : "+ Make Trade"}</button></div>
    {open && <>
      <label className="trade-select-label" htmlFor="trade-opponent">Trade With: <select id="trade-opponent" value={opponentId} onChange={(event) => { setOpponentId(event.target.value); setMine([]); setTheirs([]); setResult(undefined); }}><option value="">Select fantasy team</option>{(team.teams ?? []).filter((candidate) => candidate.id !== team.primaryTeamId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {opponent && <div className="trade-builder-columns"><div className="trade-roster"><h3>MY TEAM</h3><input aria-label="MY TEAM search" placeholder="Search players" value={query.mine} onChange={(event) => setQuery({ ...query, mine: event.target.value })} />{roster({ ...opponent, players: team.players }, "mine")}</div><div className="trade-roster"><h3>THEIR TEAM</h3><input aria-label="THEIR TEAM search" placeholder="Search players" value={query.theirs} onChange={(event) => setQuery({ ...query, theirs: event.target.value })} />{roster(opponent, "theirs")}</div></div>}
      <div className="trade-summary"><div><small>YOU SEND</small>{mine.map((id) => <button key={id} onClick={() => setMine(toggle(mine, id))}>{player(id)?.name ?? id} ×</button>)}</div><div><small>YOU RECEIVE</small>{theirs.map((id) => <button key={id} onClick={() => setTheirs(toggle(theirs, id))}>{player(id)?.name ?? id} ×</button>)}</div></div>
      {message && <p className="trade-message">{message}</p>}
      <button className="evaluate-trade-button" disabled={busy || !opponentId || !mine.length || !theirs.length} onClick={() => void evaluate()}>{busy ? "Evaluating…" : result ? "Re-evaluate" : "Evaluate Trade"}</button>
      {result && impact && <div className={`manual-result ${result.evaluation.legal ? "" : "invalid"}`}>
        <div className="manual-result-title"><small>TRADE RESULT</small><strong>{result.verdict}</strong>{result.evaluation.legal && <span>{impact.netUtilityDelta >= 0 ? "+" : ""}{impact.netUtilityDelta.toFixed(1)} utility</span>}</div>
        {!result.evaluation.legal && <p className="required-drop-warning">This trade is not legal: {result.evaluation.warnings.map((warning) => warning.message).join(" ") || "The resulting roster or lineup is not legal."}</p>}
        <div className="result-dimensions"><span>Before / after <b>{impact.before.utility.total.toFixed(1)} → {impact.after.utility.total.toFixed(1)}</b></span><span>Starter <b>{(impact.remainingStarterPointsDelta / Math.max(1, Object.keys(impact.weeklyStarterDeltas).length)).toFixed(1)} pts/week</b></span><span>Remaining season <b>{impact.remainingStarterPointsDelta.toFixed(1)}</b></span><span>Depth <b>{impact.depthDelta.toFixed(1)}</b></span><span>Playoff <b>{impact.playoffPointsDelta?.toFixed(1) ?? "Unavailable"}</b></span><span>Opponent utility <b>{opponentImpact?.netUtilityDelta.toFixed(1) ?? "Unavailable"}</b></span><span>Opponent fit <b>{result.opponentFit.band.replaceAll("_", " ")}</b></span><span>Market fairness <b>{result.marketFairness.band.replaceAll("_", " ")}</b></span><span>Plausibility <b>{result.plausibility.band.replaceAll("_", " ")}</b></span></div>
        {impact.requiredDrops.length > 0 && <p className="required-drop-warning">Roster move required: {impact.requiredDrops.map((drop) => player(drop.playerId)?.name ?? drop.playerId).join(", ")}</p>}
        {opponentImpact?.requiredDrops.length ? <p className="required-drop-warning">Opponent required drop: {opponentImpact.requiredDrops.map((drop) => player(drop.playerId)?.name ?? drop.playerId).join(", ")}</p> : null}
        <h3>Before / after lineup</h3><div className="manual-lineup"><div className="manual-lineup-head"><span>SLOT</span><span>BEFORE</span><span>AFTER</span></div>{lineupSlots.map((slot) => { const before = beforeBySlot.get(slot), after = afterBySlot.get(slot), changed = before?.playerId !== after?.playerId; return <div className={`manual-lineup-row ${changed ? "changed-lineup" : ""}`} key={slot}><span>{before?.slotName ?? after?.slotName}</span><b>{lineupName(before)}</b><b>{lineupName(after)}</b></div>; })}</div>
        <ul>{result.explanations.slice(0, 5).map((explanation) => <li className={explanation.direction} key={explanation.code}>{explanation.message}</li>)}</ul><small>Exact V1 evaluation · {result.evaluationTimeMs.toFixed(1)} ms</small>
      </div>}
    </>}
  </section>;
}
