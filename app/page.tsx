"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import {
  navigation,
  tradeIdeas,
  waiverTargets,
  type Player,
  type RosterFilter,
  type TeamSnapshot,
} from "./data";
import { ManualTradeBuilder } from "./components/ManualTradeBuilder";
import { EspnSyncController, type EspnSyncSnapshot } from "../src/client/espnSyncController";

const iconMap = {
  dashboard: LayoutDashboard,
  trades: BadgeDollarSign,
  waivers: ClipboardList,
  league: Users,
};

function Sidebar({
  active,
  onChange,
}: {
  active: string;
  onChange: (item: string) => void;
}) {
  return (
    <aside className="sidebar">
      <button
        className="brand"
        aria-label="Fantasy Command Center"
        onClick={() => onChange("Dashboard")}
      >
        <span className="brand-mark">
          <Shield size={20} strokeWidth={2.2} />
        </span>
        <span className="brand-name">
          Fantasy
          <br />
          Command Center
        </span>
      </button>
      <nav className="nav-list" aria-label="Primary navigation">
        {navigation.map((item) => {
          const Icon = iconMap[item.icon as keyof typeof iconMap];
          return (
            <button
              key={item.label}
              className={`nav-item ${active === item.label ? "active" : ""}`}
              onClick={() => onChange(item.label)}
              aria-current={active === item.label ? "page" : undefined}
              title={item.label}
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {active === item.label && <i />}
            </button>
          );
        })}
      </nav>
      <button
        className="nav-item settings"
        title="Settings"
        onClick={() => onChange("Settings")}
      >
        <Settings size={19} />
        <span>Settings</span>
      </button>
    </aside>
  );
}

export function TopBar({
  week,
  setWeek,
  onSync,
  syncState,
  lastSuccessfulAt,
  team,
  onPerspective,
}: {
  week?: number;
  setWeek: (week: number) => void;
  onSync: () => Promise<void>;
  syncState: EspnSyncSnapshot<TeamSnapshot>["state"];
  lastSuccessfulAt?: number;
  team?: TeamSnapshot;
  onPerspective?: (value: "MY_TEAM" | "MARVIN_TEAM") => void;
}) {
  const syncing = syncState === "SYNCING" || syncState === "REFRESHING";
  const displayWeek = week ?? 1;
  const [now, setNow] = useState(0);
  useEffect(() => { const initial = window.setTimeout(() => setNow(Date.now()), 0); const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, []);
  const age = lastSuccessfulAt ? Math.max(0, Math.floor((now - lastSuccessfulAt) / 60000)) : undefined;
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">VIEWING AS</div>
        <h1>{team?.teamName ?? "Hi My Name's Charlie McGlaughon"}</h1>
        <p>
          Magnet <span>•</span> 12 Team <span>•</span> Full PPR
        </p>
      </div>
      <div className="top-actions">
        {team && <label className="team-perspective"><span>Viewing as</span><select aria-label="Team perspective" value={team.selectedPerspective ?? "MY_TEAM"} onChange={(event) => onPerspective?.(event.target.value as "MY_TEAM" | "MARVIN_TEAM")}>{(team.perspectives ?? [{ perspective: "MY_TEAM", label: "My Team", available: true }]).map((option) => <option key={option.perspective} value={option.perspective} disabled={!option.available}>{option.label}{option.teamName ? ` — ${option.teamName}` : " unavailable"}</option>)}</select></label>}
        <button className="search-button" aria-label="Search">
          <Search size={17} />
        </button>
        <div className="week-control" aria-label="Week selector">
          <button
            onClick={() => setWeek(Math.max(1, displayWeek - 1))}
            aria-label="Previous week"
            disabled={!week}
          >
            <ChevronLeft size={17} />
          </button>
          <span>Week {week ?? "—"}</span>
          <button
            onClick={() => setWeek(Math.min(18, displayWeek + 1))}
            aria-label="Next week"
            disabled={!week}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <span className={`sync-status sync-${syncState.toLowerCase()}`}>ESPN • {syncState === "LIVE" ? "Live" : syncState === "SYNCING" ? "Syncing…" : syncState === "REFRESHING" ? "Refreshing…" : syncState === "STALE" ? "Stale" : "Error"}{lastSuccessfulAt && syncState !== "SYNCING" && <small>Updated {age === 0 ? "just now" : `${age}m ago`}</small>}</span>
        <button className={`sync-button ${syncing ? "syncing" : ""}`} onClick={() => void onSync()} disabled={syncing} aria-label="Refresh ESPN data">
          <RefreshCw size={17} />
        </button>
      </div>
    </header>
  );
}

function SummaryStrip({ team }: { team: TeamSnapshot }) {
  const ready = team.engine.status === "READY";
  return (
    <>
      <section className="summary-strip" aria-label="Team summary">
        <div>
          <span>Optimized projection</span>
          <strong>
            {ready ? team.projected.toFixed(1) : "—"} <small>PTS</small>
          </strong>
        </div>
        <div>
          <span>League-relative strength</span>
          <strong>
            {ready ? team.engine.rosterStrength : "—"} <small>/ 100</small>
          </strong>
        </div>
        <div>
          <span>Record</span>
          <strong>{team.record}</strong>
        </div>
        <div className="summary-context">
          <span className={`pulse-dot ${ready ? "" : "offline"}`} />
          <p>
            <b>{ready ? "Intelligence ready" : "Intelligence paused"}</b>
            <small>
              {team.dataMode.toUpperCase()} DATA · Week {team.week}
            </small>
          </p>
        </div>
      </section>
      {!ready && (
        <section className="engine-notice" role="status">
          <Shield size={18} />
          <div>
            <strong>League intelligence unavailable</strong>
            <p>
              {team.engine.missingRequirements.join(" · ") ||
                "Required live league data is incomplete."}
            </p>
          </div>
        </section>
      )}
    </>
  );
}

function PlayerAvatar({ player }: { player: Player }) {
  return (
    <div
      className={`avatar avatar-${player.position.toLowerCase().replace("/", "")}`}
    >
      {player.initials}
    </div>
  );
}
function PlayerRow({
  player,
  selected,
  onSelect,
}: {
  player: Player;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`player-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="slot">{player.slot}</span>
      <PlayerAvatar player={player} />
      <span className="player-identity">
        <strong>{player.name}</strong>
        <small>
          {player.team} <i>•</i> {player.position}
          {player.status ? <em>{player.status}</em> : null}
        </small>
      </span>
      <span className="opponent">
        <small>WEEK</small>
        <b>{player.opponent}</b>
      </span>
      <span className="projection">
        <small>PROJ</small>
        <b>{player.projected.toFixed(1)}</b>
      </span>
      <span className="row-menu" aria-label={`More options for ${player.name}`}>
        <MoreHorizontal size={18} />
      </span>
    </button>
  );
}

function Roster({
  players,
  loading,
  dataMode,
}: {
  players: Player[];
  loading: boolean;
  dataMode: "live" | "stale" | "mock";
}) {
  const [filter, setFilter] = useState<RosterFilter>("All");
  const [selected, setSelected] = useState(players[0]?.id ?? "");
  const selectedId = players.some((player) => player.id === selected)
    ? selected
    : (players[0]?.id ?? "");
  const visible = players.filter(
    (player) => filter === "All" || player.group === filter,
  );
  const starters = players.filter(
    (player) => player.group === "Starters",
  ).length;
  const modeLabel =
    dataMode === "live"
      ? "ESPN LIVE"
      : dataMode === "stale"
        ? "STALE SNAPSHOT"
        : "MOCK DATA";
  return (
    <section className={`card roster-card ${loading ? "is-loading" : ""}`}>
      <div className="card-header roster-header">
        <div>
          <h2>My Roster</h2>
          <p>
            {players.length} players · {starters} assigned starters{" "}
            <span className={`live-label ${dataMode !== "live" ? "mock" : ""}`}>
              {modeLabel}
            </span>
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Roster filter">
          {(["All", "Starters", "Bench"] as RosterFilter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="roster-columns" aria-hidden="true">
        <span>LINEUP</span>
        <span>PLAYER</span>
        <span>WEEK</span>
        <span>PROJ</span>
        <span />
      </div>
      {(["Starters", "Bench"] as const).map((group) => {
        const groupPlayers = visible.filter((player) => player.group === group);
        return groupPlayers.length ? (
          <div className="roster-group" key={group}>
            <div className="group-label">
              <span>{group.toUpperCase()}</span>
              <i />
            </div>
            {groupPlayers.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                selected={selectedId === player.id}
                onSelect={() => setSelected(player.id)}
              />
            ))}
          </div>
        ) : null;
      })}
    </section>
  );
}

function TeamNeeds({ team }: { team: TeamSnapshot }) {
  const needs = team.engine.status === "READY" ? (team.engine.needs ?? []) : [];
  return (
    <section className="card side-card">
      <div className="card-header">
        <div>
          <h2>Team Needs</h2>
          <p>
            {needs.length
              ? "Calculated against your league"
              : "Waiting for validated data"}
          </p>
        </div>
        <CircleHelp size={16} className="muted-icon" />
      </div>
      {needs.length ? (
        <div className="needs-list">
          {needs.map((need) => (
            <div
              className="need-row"
              key={need.position}
              title={need.reasons.join(" ")}
            >
              <span className="position-chip">{need.position}</span>
              <span className="need-track">
                <i style={{ width: `${need.needScore}%` }} />
              </span>
              <strong className={`need-${need.level.toLowerCase()}`}>
                {need.level}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-intelligence">
          No need score is shown until ESPN settings and forecasts validate.
        </p>
      )}
    </section>
  );
}

function TradeSuggestion() {
  const [selected, setSelected] = useState(tradeIdeas[0].id);
  return (
    <section className="card side-card">
      <div className="card-header">
        <div>
          <h2>
            Trade Ideas <span className="demo-badge">DEMO</span>
          </h2>
          <p>Automatic discovery arrives in V2</p>
        </div>
        <Sparkles size={17} className="accent-icon" />
      </div>
      <div className="trade-list">
        {tradeIdeas.map((trade) => (
          <button
            key={trade.id}
            className={`trade-card ${selected === trade.id ? "selected" : ""}`}
            onClick={() => setSelected(trade.id)}
          >
            <span className="trade-top">
              <b>{trade.label}</b>
              <em>Example</em>
            </span>
            <span className="trade-exchange">
              <span>
                <small>SEND</small>
                <strong>{trade.send}</strong>
              </span>
              <ArrowRight size={15} />
              <span>
                <small>RECEIVE</small>
                <strong>{trade.receive}</strong>
              </span>
            </span>
            <span className="trade-action">
              Preview layout <ChevronRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <button className="text-link">
        Manual evaluator foundation ready <ArrowRight size={15} />
      </button>
    </section>
  );
}

function WaiverSuggestion() {
  const [added, setAdded] = useState<string[]>([]);
  const toggleAdd = (id: string) =>
    setAdded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  return (
    <section className="card side-card">
      <div className="card-header">
        <div>
          <h2>
            Waiver Targets <span className="demo-badge">DEMO</span>
          </h2>
          <p>Example UI — not league advice</p>
        </div>
        <CalendarDays size={17} className="muted-icon" />
      </div>
      <div className="waiver-list">
        {waiverTargets.map((player) => (
          <div className="waiver-row" key={player.id}>
            <div className="mini-avatar">{player.initials}</div>
            <div>
              <strong>{player.name}</strong>
              <small>
                {player.position} · {player.team}
              </small>
              <p>{player.reason}</p>
            </div>
            <button
              className={added.includes(player.id) ? "added" : ""}
              onClick={() => toggleAdd(player.id)}
            >
              {added.includes(player.id) ? "Demo added" : "Demo add"}
            </button>
          </div>
        ))}
      </div>
      <button className="text-link">
        Automatic waiver search in V2 <ArrowRight size={15} />
      </button>
    </section>
  );
}

function PlayerToken({ id, team }: { id: string; team: TeamSnapshot }) {
  const player = team.playerDirectory?.[id];
  return (
    <span className="move-player">
      <b>{player?.name ?? id}</b>
      <small>
        {player?.position ?? "—"} · {player?.team ?? "—"}
      </small>
    </span>
  );
}

function IntelligenceUnavailable({
  team,
  loading,
}: {
  team: TeamSnapshot;
  loading: boolean;
}) {
  return (
    <section className="moves-unavailable card">
      <AlertTriangle size={24} />
      <h2>
        {loading ? "Analyzing your league…" : "Trade intelligence unavailable"}
      </h2>
      <p>
        {loading
          ? "Building roster-relative candidates and evaluating legal lineups."
          : "Reconnect ESPN league data to analyze your actual league."}
      </p>
      {!loading && <small>{team.engine.missingRequirements.join(" · ")}</small>}
    </section>
  );
}

function TradeWorkspace({ team }: { team: TeamSnapshot }) {
  const results = team.engine.search?.trades.results ?? [];
  const [selectedId, setSelectedId] = useState(0);
  const [filter, setFilter] = useState("All");
  const filters = [
    "All",
    "Upgrade WR",
    "Upgrade RB",
    "Upgrade TE",
    "Consolidate",
  ];
  const tagFor: Record<string, string> = {
    "Upgrade WR": "UPGRADE_WR",
    "Upgrade RB": "UPGRADE_RB",
    "Upgrade TE": "UPGRADE_TE",
    Consolidate: "CONSOLIDATION",
  };
  const visible =
    filter === "All"
      ? results
      : results.filter((result) =>
          result.tags.includes(tagFor[filter] as never),
        );
  const selected = visible[selectedId] ?? visible[0];
  if (!results.length)
    return (
      <section className="moves-unavailable card">
        <Sparkles size={24} />
        <h2>No positive, plausible trades found</h2>
        <p>
          The search did not find a legal move that clears both your utility
          threshold and opponent-fit safeguards.
        </p>
      </section>
    );
  return (
    <div className="moves-grid">
      <section className="moves-results card">
        <div className="moves-filters">
          {filters.map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => {
                setFilter(item);
                setSelectedId(0);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="move-list">
          {visible.map((result, index) => {
            const weeks = Math.max(
              1,
              result.evaluation.primaryTeam.after.weeklyLineups.length,
            );
            return (
              <button
                key={`${result.opponentTeamId}-${result.trade.teamAGives.join("-")}-${result.trade.teamBGives.join("-")}`}
                className={`move-card ${selected === result ? "selected" : ""}`}
                onClick={() => setSelectedId(index)}
              >
                <span className="move-exchange">
                  <span>
                    <small>YOU SEND</small>
                    {result.trade.teamAGives.map((id) => (
                      <PlayerToken key={id} id={id} team={team} />
                    ))}
                  </span>
                  <ArrowRight size={18} />
                  <span>
                    <small>YOU RECEIVE</small>
                    {result.trade.teamBGives.map((id) => (
                      <PlayerToken key={id} id={id} team={team} />
                    ))}
                  </span>
                </span>
                <span className="move-score">
                  <b>{result.teamFitScore}</b>
                  <small>TEAM FIT</small>
                </span>
                <span className="move-metrics">
                  <em className="positive">
                    <Plus size={12} />
                    {(
                      result.evaluation.primaryTeam
                        .remainingStarterPointsDelta / weeks
                    ).toFixed(1)}{" "}
                    starter PPG
                  </em>
                  <em>
                    {result.opponentFit.band.replace("_", " ")} opponent fit
                  </em>
                  {result.dealPlausibility && (
                    <em>
                      {result.dealPlausibility.band.replace("_", " ")} deal plausibility
                    </em>
                  )}
                  {result.evaluation.primaryTeam.depthDelta < 0 && (
                    <em className="negative">
                      <Minus size={12} />
                      {Math.abs(
                        result.evaluation.primaryTeam.depthDelta,
                      ).toFixed(1)}{" "}
                      depth
                    </em>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {selected && <TradeDetail result={selected} team={team} />}
    </div>
  );
}

function TradeDetail({
  result,
  team,
}: {
  result: NonNullable<
    TeamSnapshot["engine"]["search"]
  >["trades"]["results"][number];
  team: TeamSnapshot;
}) {
  const impact = result.evaluation.primaryTeam;
  const manager = team.engine.search?.managerProfiles?.[result.opponentTeamId];
  const [offerId, setOfferId] = useState<string>();
  const [offerStatus, setOfferStatus] = useState<string>();
  const [counterText, setCounterText] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [managerTag, setManagerTag] = useState("PREFERS_DEPTH");
  const saveOffer = async (status: "sent" | "accepted" | "rejected" | "ignored", counterOfferId?: string) => {
    if (!team.leagueId || !team.season || !team.primaryTeamId) return;
    const id = offerId ?? crypto.randomUUID();
    const response = await fetch("/api/trade-offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offer: {
          id, leagueId: team.leagueId, season: team.season,
          senderTeamId: team.primaryTeamId, recipientTeamId: result.opponentTeamId,
          playersSent: result.trade.teamAGives, playersReceived: result.trade.teamBGives,
          createdAt: new Date().toISOString(), source: status === "sent" ? "sent" : "manual",
          status: "sent", snapshotVersion: team.engine.asOf,
          plausibility: result.dealPlausibility ? { score: result.dealPlausibility.score, band: result.dealPlausibility.band, confidence: result.dealPlausibility.confidence } : undefined,
        },
        event: { status, counterOfferId },
      }),
    });
    if (response.ok) {
      setOfferId(id);
      setOfferStatus(status);
    } else setOfferStatus("history unavailable");
  };
  const recordCounter = async () => {
    if (!team.leagueId || !team.season || !team.primaryTeamId || !counterText.trim()) return;
    const [theirText = "", yourText = ""] = counterText.split("|");
    const findIds = (text: string) => text.split(",").map((name) => {
      const query = name.trim().toLowerCase();
      return Object.entries(team.playerDirectory ?? {}).find(([, player]) => player.name.toLowerCase() === query)?.[0];
    }).filter((id): id is string => Boolean(id));
    const theirPlayers = findIds(theirText), yourPlayers = findIds(yourText);
    if (!theirPlayers.length || !yourPlayers.length) {
      setOfferStatus("Use exact player names: They send | You send");
      return;
    }
    const counterId = crypto.randomUUID();
    const originalId = offerId ?? crypto.randomUUID();
    await fetch("/api/trade-offers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer: {
        id: counterId, leagueId: team.leagueId, season: team.season,
        senderTeamId: result.opponentTeamId, recipientTeamId: team.primaryTeamId,
        playersSent: theirPlayers, playersReceived: yourPlayers,
        createdAt: new Date().toISOString(), source: "manual", status: "countered", snapshotVersion: team.engine.asOf,
      } }),
    });
    setOfferId(originalId);
    await fetch("/api/trade-offers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer: {
        id: originalId, leagueId: team.leagueId, season: team.season,
        senderTeamId: team.primaryTeamId, recipientTeamId: result.opponentTeamId,
        playersSent: result.trade.teamAGives, playersReceived: result.trade.teamBGives,
        createdAt: new Date().toISOString(), source: "manual", status: "sent", snapshotVersion: team.engine.asOf,
      }, event: { status: "countered", counterOfferId: counterId } }),
    });
    setOfferStatus("countered");
  };
  const saveManagerNote = async () => {
    if (!team.leagueId || !team.season || !managerNote.trim()) return;
    const response = await fetch("/api/manager-notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), leagueId: team.leagueId, season: team.season, teamId: result.opponentTeamId, createdAt: new Date().toISOString(), text: managerNote.trim(), tags: [managerTag] }),
    });
    if (response.ok) {
      setManagerNote("");
      setOfferStatus("manager note saved; refresh to apply");
    }
  };
  return (
    <aside className="move-detail card">
      <div className="detail-head">
        <span>
          <small>TEAM IMPACT</small>
          <strong>{result.teamFitScore}</strong>
        </span>
        <span>
          <small>MARKET OPPORTUNITY</small>
          <strong>{result.marketOpportunityScore}</strong>
        </span>
        <span className="fit-pill">
          Opponent Fit · {result.opponentFit.band.replace("_", " ")}
        </span>
      </div>
      <div className="market-fairness">
        <small>MARKET FAIRNESS</small>
        <b>{result.marketFairness.band.replaceAll("_", " ")}</b>
        <p>{result.marketFairness.explanation}</p>
      </div>
      {result.dealPlausibility && (
        <div className="plausibility-panel">
          <div>
            <small>DEAL PLAUSIBILITY</small>
            <b>{result.dealPlausibility.band.replaceAll("_", " ")}</b>
            <span>Confidence: {result.dealPlausibility.confidence}</span>
          </div>
          <div>
            <small>WHY THEY MIGHT SAY YES</small>
            <p>{result.dealPlausibility.reasons[0]?.message ?? "Opponent fit is the primary available signal."}</p>
          </div>
          <div>
            <small>WHY THEY MIGHT SAY NO</small>
            <p>{result.dealPlausibility.risks[0]?.message ?? "Manager-specific history is still limited."}</p>
          </div>
        </div>
      )}
      {manager && (
        <div className="manager-profile">
          <small>MANAGER TENDENCIES</small>
          <b>{manager.tradeFrequency >= 0.5 ? "Trades often" : "Limited trade history"}</b>
          <span>{manager.depthPreference === undefined ? "No learned depth/star preference yet" : manager.depthPreference > 0 ? "Leans toward depth" : "Leans toward consolidation"}</span>
          <span>Confidence: {manager.confidence} · {manager.sampleSize} observed outcome{manager.sampleSize === 1 ? "" : "s"}</span>
          <div className="manager-note-input">
            <input value={managerNote} onChange={(event) => setManagerNote(event.target.value)} placeholder="Add a manager note" />
            <select value={managerTag} onChange={(event) => setManagerTag(event.target.value)}>
              <option value="PREFERS_DEPTH">Prefers depth</option>
              <option value="PREFERS_STARS">Prefers stars</option>
              <option value="RARE_TRADER">Rare trader</option>
              <option value="ACTIVE_TRADER">Active trader</option>
              <option value="RB_INTEREST">RB interest</option>
              <option value="WR_INTEREST">WR interest</option>
              <option value="QB_INTEREST">QB interest</option>
              <option value="TE_INTEREST">TE interest</option>
            </select>
            <button onClick={() => void saveManagerNote()}>Save note</button>
          </div>
        </div>
      )}
      <div className="detail-section">
        <h3>Before vs after</h3>
        <div className="before-after">
          <span>
            <small>ROSTER UTILITY</small>
            <b>{impact.before.utility.total.toFixed(1)}</b>
          </span>
          <ArrowRight size={16} />
          <span>
            <small>AFTER</small>
            <b>{impact.after.utility.total.toFixed(1)}</b>
          </span>
        </div>
      </div>
      <div className="detail-section">
        <h3>Weekly impact</h3>
        <div className="week-impact">
          {Object.entries(impact.weeklyStarterDeltas)
            .slice(0, 8)
            .map(([week, delta]) => (
              <span key={week}>
                <small>Week {week}</small>
                <b className={delta >= 0 ? "positive" : "negative"}>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </b>
              </span>
            ))}
        </div>
      </div>
      <div className="detail-section">
        <h3>Why it works</h3>
        <ul>
          {result.reasons.slice(0, 4).map((reason) => (
            <li key={reason.code} className={reason.direction}>
              {reason.message}
            </li>
          ))}
        </ul>
      </div>
      {impact.requiredDrops.length > 0 && (
        <div className="detail-section">
          <h3>Required drop</h3>
          {impact.requiredDrops.map((drop) => (
            <PlayerToken key={drop.playerId} id={drop.playerId} team={team} />
          ))}
        </div>
      )}
      <div className="detail-section">
        <h3>Opponent view</h3>
        <ul>
          {result.opponentFit.reasons.slice(0, 4).map((reason) => (
            <li key={reason.code} className={reason.direction}>
              {reason.message}
            </li>
          ))}
        </ul>
      </div>
      <div className="offer-log">
        <small>OFFER HISTORY {offerStatus ? `· ${offerStatus}` : ""}</small>
        <div>
          <button onClick={() => void saveOffer("sent")}>Mark sent</button>
          <button onClick={() => void saveOffer("accepted")}>Accepted</button>
          <button onClick={() => void saveOffer("rejected")}>Rejected</button>
          <button onClick={() => void saveOffer("ignored")}>Ignored</button>
        </div>
        <input value={counterText} onChange={(event) => setCounterText(event.target.value)} placeholder="Counter: They send | You send" />
        <button onClick={() => void recordCounter()}>Record counter</button>
      </div>
    </aside>
  );
}

function WaiverWorkspace({ team }: { team: TeamSnapshot }) {
  const results = team.engine.search?.waivers.results ?? [];
  if (!results.length)
    return (
      <section className="moves-unavailable card">
        <ClipboardList size={24} />
        <h2>No positive waiver upgrades found</h2>
        <p>
          Available players did not improve this roster enough to clear the
          recommendation threshold.
        </p>
      </section>
    );
  return (
    <section className="waiver-workspace card">
      <div className="waiver-search-head">
        <span>Recommended transaction</span>
        <span>Actionability</span>
        <span>Roster impact</span>
      </div>
      {results.map((result) => {
        const add = team.playerDirectory?.[result.addPlayerId];
        const drop = result.dropPlayerId
          ? team.playerDirectory?.[result.dropPlayerId]
          : undefined;
        const weeks = Math.max(1, result.weeksEvaluated);
        return (
          <article
            className={`waiver-result action-${result.actionability.toLowerCase()}`}
            key={result.addPlayerId}
          >
            <div className="waiver-swap">
              <span>
                <small>ADD</small>
                <b>{add?.name ?? result.addPlayerId}</b>
                <em>
                  {add?.position} · {add?.team}
                </em>
              </span>
              <ArrowRight size={17} />
              <span>
                <small>DROP</small>
                <b>{drop?.name ?? "Open roster slot"}</b>
                <em>
                  {drop
                    ? `${drop.position} · ${drop.team}`
                    : "No drop required"}
                </em>
              </span>
            </div>
            <div className="waiver-fit">
              <strong>{result.actionability.replaceAll("_", " ")}</strong>
              <small>
                {result.category.replaceAll("_", " ")} · {result.confidence}
              </small>
            </div>
            <div className="waiver-impact">
              <b
                className={
                  result.adjustedUtilityDelta >= 0 ? "positive" : "negative"
                }
              >
                {result.adjustedUtilityDelta >= 0 ? "+" : ""}
                {result.adjustedUtilityDelta.toFixed(1)} adjusted utility
              </b>
              <span>
                {(result.starterDelta / weeks).toFixed(1)} starter PPG ·{" "}
                {result.optionValueDelta >= 0 ? "+" : ""}
                {result.optionValueDelta.toFixed(1)} option value
              </span>
              <p>{result.explanations.at(-1)?.message}</p>
            </div>
          </article>
        );
      })}
    </section>
  );
}

type MoveTab = "Best Moves" | "Buy Low" | "Sell High" | "Waivers";
function SignalWorkspace({
  team,
  kind,
}: {
  team: TeamSnapshot;
  kind: "buy" | "sell";
}) {
  const signals =
    kind === "buy"
      ? (team.engine.search?.buyLow ?? [])
      : (team.engine.search?.sellHigh ?? []);
  const firstSignalId = signals[0]?.playerId ?? "";
  const [selected, setSelected] = useState(firstSignalId);
  const selectedId = signals.some((signal) => signal.playerId === selected)
    ? selected
    : firstSignalId;
  const selectedSignal = signals.find((signal) => signal.playerId === selectedId);
  const selectedIntel = selectedSignal
    ? team.engine.search?.intelligence.players[selectedSignal.playerId]
    : undefined;
  if (!signals.length)
    return (
      <section className="moves-unavailable card">
        <Shield size={24} />
        <h2>No supported {kind === "buy" ? "buy-low" : "sell-high"} signals</h2>
        <p>
          Market or usage evidence is not strong enough to label a player
          without fabricating confidence.
        </p>
      </section>
    );
  return (
    <section className="signal-workspace card">
      <div className="signal-head">
        <span>Player</span>
        <span>Market gap</span>
        <span>Roster fit</span>
        <span>Signal</span>
      </div>
      {signals.map((signal) => {
        const intel = team.engine.search?.intelligence.players[signal.playerId];
        return (
          <button
            key={signal.playerId}
            className={`signal-row ${selectedId === signal.playerId ? "selected" : ""}`}
            onClick={() => setSelected(signal.playerId)}
          >
            <PlayerToken id={signal.playerId} team={team} />
            <span>
              <b>
                {signal.marketGapZ >= 0 ? "+" : ""}
                {signal.marketGapZ.toFixed(2)}σ
              </b>
              <small>{intel?.market.trend ?? "unknown"} market</small>
            </span>
            <span>
              <b>{signal.rosterFit.toFixed(1)}</b>
              <small>{intel?.fundamental.trend ?? "unknown"} fundamental</small>
            </span>
            <span className="signal-pill">
              {signal.signal.replace("_", " ")} · {signal.confidence}
            </span>
            {selectedId === signal.playerId && (
              <span className="signal-reasons">
                {signal.reasons.slice(0, 3).map((reason) => (
                  <small key={reason}>• {reason}</small>
                ))}
              </span>
            )}
          </button>
        );
      })}
      {selectedSignal && selectedIntel && (
        <div className="signal-detail">
          <div>
            <small>FUNDAMENTAL</small>
            <b>{selectedIntel.fundamental.expectedPoints.toFixed(1)}</b>
            <span>Tier {selectedIntel.fundamentalTier} · {selectedIntel.fundamental.trend.replaceAll("_", " ")}</span>
          </div>
          <div>
            <small>MARKET</small>
            <b>{selectedIntel.market.value.toFixed(0)} / 100</b>
            <span>{selectedIntel.market.independentSourceCount ?? 0} independent source{(selectedIntel.market.independentSourceCount ?? 0) === 1 ? "" : "s"}</span>
          </div>
          <div>
            <small>ROLE</small>
            <b>{selectedIntel.role.opportunityScore?.toFixed(0) ?? "—"}</b>
            <span>{selectedIntel.role.securityBand ?? "low"} security</span>
          </div>
          <div>
            <small>CONFIDENCE</small>
            <b>{selectedIntel.confidence}</b>
            <span>{selectedIntel.fundamental.expectedProduction.fantasyPointsOverExpected === undefined ? "Usage unavailable" : `${selectedIntel.fundamental.expectedProduction.fantasyPointsOverExpected >= 0 ? "+" : ""}${selectedIntel.fundamental.expectedProduction.fantasyPointsOverExpected.toFixed(1)} xFP gap`}</span>
          </div>
          <ul>
            {selectedSignal.reasons.slice(0, 3).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            {selectedSignal.risks.slice(0, 1).map((risk) => (
              <li className="risk" key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MovesWorkspace({
  team,
  loading,
  tab,
  onTab,
  onRefresh,
}: {
  team: TeamSnapshot;
  loading: boolean;
  tab: MoveTab;
  onTab: (tab: MoveTab) => void;
  onRefresh: () => Promise<void>;
}) {
  const search = team.engine.search,
    tabs: MoveTab[] = ["Best Moves", "Buy Low", "Sell High", "Waivers"];
  return (
    <section className="moves-page">
      <div className="moves-title">
        <div>
          <span className="eyebrow">ROSTER + MARKET INTELLIGENCE</span>
          <h2>Best Moves for Your Team</h2>
          <p>
            Fundamental value, market perception, and exact roster impact remain
            separate.
          </p>
        </div>
        <div className="moves-tabs">
          {tabs.map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => onTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {team.dataMode !== "live" && (
        <div className="data-state-badge">
          {team.dataMode === "stale" ? "STALE SNAPSHOT" : "DEMO DATA"}
        </div>
      )}
      {tab === "Best Moves" ? <>
        <ManualTradeBuilder team={team} onRefresh={onRefresh} />
        {team.engine.status !== "READY" || !search ? <IntelligenceUnavailable team={team} loading={loading} /> : <TradeWorkspace team={team} />}
      </> : team.engine.status !== "READY" || !search ? (
        <IntelligenceUnavailable team={team} loading={loading} />
      ) : tab === "Buy Low" ? (
        <SignalWorkspace team={team} kind="buy" />
      ) : tab === "Sell High" ? (
        <SignalWorkspace team={team} kind="sell" />
      ) : (
        <WaiverWorkspace team={team} />
      )}{" "}
      {search && (
        <details className="search-debug">
          <summary>Search diagnostics</summary>
          <pre>
            {JSON.stringify(
              tab === "Waivers"
                ? search.waivers.instrumentation
                : search.trades.instrumentation,
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </section>
  );
}

const initialTeam: TeamSnapshot = {
  teamName: "Hi My Name's Charlie McGlaughon",
  abbreviation: "ICMG",
  week: 0,
  record: "0–0",
  projected: 0,
  players: [],
  source: "ESPN",
  dataMode: "live",
  engine: {
    status: "ENGINE_NOT_READY",
    missingRequirements: ["Live ESPN snapshot has not loaded"],
    warnings: [],
    asOf: new Date(0).toISOString(),
  },
};

export default function Home() {
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [movesTab, setMovesTab] = useState<MoveTab>("Best Moves");
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamSnapshot>(initialTeam);
  const [syncSnapshot, setSyncSnapshot] = useState<EspnSyncSnapshot<TeamSnapshot>>({ state: "SYNCING" });
  const [perspective, setPerspective] = useState<"MY_TEAM" | "MARVIN_TEAM">(() => { try { return window.localStorage.getItem("fcc-team-perspective") === "MARVIN_TEAM" ? "MARVIN_TEAM" : "MY_TEAM"; } catch { return "MY_TEAM"; } });
  const controllerRef = useRef<EspnSyncController<TeamSnapshot> | undefined>(undefined);
  const weekRef = useRef(week);
  const includeSearchRef = useRef(false);
  const syncSetWeekRef = useRef(false);
  const perspectiveRef = useRef(perspective);
  useEffect(() => { perspectiveRef.current = perspective; try { window.localStorage.setItem("fcc-team-perspective", perspective); } catch { /* storage unavailable */ } }, [perspective]);
  useEffect(() => { weekRef.current = week; includeSearchRef.current = activeNav === "Trades" || activeNav === "Waivers"; }, [week, activeNav]);
  const loadTeam = useCallback(
    async (targetWeek: number | undefined, includeSearch = false, force = false) => {
      setLoading(true);
      try {
        const weekParam = targetWeek === undefined ? "" : `week=${targetWeek}&`;
        const response = await fetch(
          `/api/espn?${weekParam}perspective=${perspectiveRef.current}&${includeSearch ? "includeSearch=1&" : ""}${force ? "refresh=1" : ""}`.replace(/[?&]$/, ""),
          { cache: "no-store" },
        );
        const payload = (await response.json()) as Partial<TeamSnapshot> & {
          error?: string;
        };
        if (!response.ok || !payload.players) {
          setTeam((current) => ({
            ...current,
            ...(targetWeek === undefined ? {} : { week: targetWeek }),
            dataMode: current.players.length ? "stale" : "live",
            source: "ESPN",
            engine: payload.engine ?? current.engine,
          }));
        } else {
          setTeam(payload as TeamSnapshot);
          if (targetWeek === undefined) {
            syncSetWeekRef.current = true;
            setWeek(payload.week);
          }
          return payload as TeamSnapshot;
        }
      } catch {
        setTeam((current) => ({
          ...current,
          ...(targetWeek === undefined ? {} : { week: targetWeek }),
          dataMode: current.players.length ? "stale" : "live",
        }));
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    const controller = new EspnSyncController<TeamSnapshot>({
      request: async (force) => {
        const requestWeek = weekRef.current;
        const payload = await loadTeam(requestWeek, includeSearchRef.current, force);
        if (!payload) throw new Error("ESPN sync failed");
        return payload;
      },
      isStale: (payload) => payload.dataMode === "stale",
      successfulAt: (payload) => {
        const value = payload.sync?.lastSuccessfulAt;
        return value ? Date.parse(value) : undefined;
      },
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSyncSnapshot);
    const onActivate = () => { if (document.visibilityState === "visible") void controller.activate(); };
    window.addEventListener("focus", onActivate);
    document.addEventListener("visibilitychange", onActivate);
    controller.start();
    return () => { window.removeEventListener("focus", onActivate); document.removeEventListener("visibilitychange", onActivate); unsubscribe(); controller.stop(); };
  }, [loadTeam]);
  useEffect(() => {
    if (activeNav !== "Trades" && activeNav !== "Waivers") return;
    void controllerRef.current?.refresh(false).then((payload) => {
      if (payload && !payload.engine.search)
        return controllerRef.current?.refresh(true);
    });
  }, [activeNav, loadTeam]);
  useEffect(() => {
    if (syncSetWeekRef.current) {
      syncSetWeekRef.current = false;
      return;
    }
    const refresh = controllerRef.current?.refresh(true);
    if (!refresh) return;
    void refresh.then((payload) => {
      if (payload && weekRef.current !== undefined && weekRef.current !== payload.week)
        void controllerRef.current?.refresh(true);
    });
  }, [week]);
  useEffect(() => { if (controllerRef.current) void controllerRef.current.refresh(true); }, [perspective]);
  const changeNav = (item: string) => {
    if (item === "Trades") setMovesTab("Best Moves");
    if (item === "Waivers") setMovesTab("Waivers");
    setActiveNav(item);
  };
  const movesActive = activeNav === "Trades" || activeNav === "Waivers";
  return (
    <div className="app-shell">
      <Sidebar active={activeNav} onChange={changeNav} />
      <main>
        <TopBar
          week={week}
          setWeek={setWeek}
          onSync={async () => { await controllerRef.current?.refresh(true); }}
          syncState={syncSnapshot.state}
          lastSuccessfulAt={syncSnapshot.lastSuccessfulAt}
          team={team}
          onPerspective={(next) => { if (next === "MARVIN_TEAM" && !team.perspectives?.find((item) => item.perspective === next)?.available) return; setPerspective(next); }}
        />
        <div className="content-wrap">
          {movesActive ? (
            <MovesWorkspace
              team={team}
              loading={loading}
              tab={movesTab}
              onTab={(tab) => setMovesTab(tab)}
              onRefresh={async () => { await controllerRef.current?.refresh(true); }}
            />
          ) : activeNav !== "Dashboard" ? (
            <section className="placeholder-view">
              <Trophy size={24} />
              <h2>{activeNav}</h2>
              <p>
                This workspace is ready for the next phase of Fantasy Command
                Center.
              </p>
              <button onClick={() => setActiveNav("Dashboard")}>
                Back to dashboard
              </button>
            </section>
          ) : (
            <>
              <SummaryStrip team={team} />
              <div className="dashboard-grid">
                <Roster
                  players={team.players}
                  loading={loading}
                  dataMode={team.dataMode}
                />
                <aside className="right-column">
                  <TeamNeeds team={team} />
                  <TradeSuggestion />
                  <WaiverSuggestion />
                </aside>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
