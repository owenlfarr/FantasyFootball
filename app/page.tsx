"use client";

import { useState } from "react";
import { ArrowRight, BadgeDollarSign, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, LayoutDashboard, MoreHorizontal, RefreshCw, Search, Settings, Shield, Sparkles, Trophy, Users } from "lucide-react";
import { navigation, roster, teamNeeds, tradeIdeas, waiverTargets, type Player, type RosterFilter } from "./data";

const iconMap = { dashboard: LayoutDashboard, trades: BadgeDollarSign, waivers: ClipboardList, league: Users };

function Sidebar({ active, onChange }: { active: string; onChange: (item: string) => void }) {
  return <aside className="sidebar">
    <button className="brand" aria-label="Fantasy Command Center" onClick={() => onChange("Dashboard")}><span className="brand-mark"><Shield size={20} strokeWidth={2.2} /></span><span className="brand-name">Fantasy<br />Command Center</span></button>
    <nav className="nav-list" aria-label="Primary navigation">{navigation.map((item) => { const Icon = iconMap[item.icon as keyof typeof iconMap]; return <button key={item.label} className={`nav-item ${active === item.label ? "active" : ""}`} onClick={() => onChange(item.label)} aria-current={active === item.label ? "page" : undefined} title={item.label}><Icon size={19} /><span>{item.label}</span>{active === item.label && <i />}</button>; })}</nav>
    <button className="nav-item settings" title="Settings" onClick={() => onChange("Settings")}><Settings size={19} /><span>Settings</span></button>
  </aside>;
}

function TopBar({ week, setWeek }: { week: number; setWeek: (week: number) => void }) {
  const [syncing, setSyncing] = useState(false);
  const sync = () => { setSyncing(true); window.setTimeout(() => setSyncing(false), 800); };
  return <header className="topbar">
    <div><div className="eyebrow">MY TEAM</div><h1>Hi My Name&apos;s Charlie McGlaughon</h1><p>Magnet <span>•</span> 12 Team <span>•</span> Full PPR</p></div>
    <div className="top-actions"><button className="search-button" aria-label="Search"><Search size={17} /></button><div className="week-control" aria-label="Week selector"><button onClick={() => setWeek(Math.max(1, week - 1))} aria-label="Previous week"><ChevronLeft size={17} /></button><span>Week {week}</span><button onClick={() => setWeek(Math.min(18, week + 1))} aria-label="Next week"><ChevronRight size={17} /></button></div><button className={`sync-button ${syncing ? "syncing" : ""}`} onClick={sync} aria-label="Sync roster" title="Sync roster"><RefreshCw size={17} /></button></div>
  </header>;
}

function SummaryStrip() {
  return <section className="summary-strip" aria-label="Team summary"><div><span>Projected</span><strong>128.4 <small>PTS</small></strong></div><div><span>Roster Strength</span><strong>86 <small>/ 100</small></strong></div><div><span>Record</span><strong>0–0</strong></div><div className="summary-context"><span className="pulse-dot" /><p><b>Week 1 outlook</b><small>Favored by 7.8 points</small></p></div></section>;
}

function PlayerAvatar({ player }: { player: Player }) { return <div className={`avatar avatar-${player.position.toLowerCase().replace("/", "")}`}>{player.initials}</div>; }

function PlayerRow({ player, selected, onSelect }: { player: Player; selected: boolean; onSelect: () => void }) {
  return <button className={`player-row ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected}><span className="slot">{player.slot}</span><PlayerAvatar player={player} /><span className="player-identity"><strong>{player.name}</strong><small>{player.team} <i>•</i> {player.position}{player.status ? <em>{player.status}</em> : null}</small></span><span className="opponent"><small>OPP</small><b>{player.opponent}</b></span><span className="projection"><small>PROJ</small><b>{player.projected.toFixed(1)}</b></span><span className="row-menu" aria-label={`More options for ${player.name}`}><MoreHorizontal size={18} /></span></button>;
}

function Roster() {
  const [filter, setFilter] = useState<RosterFilter>("All");
  const [selected, setSelected] = useState(roster[0].id);
  const visible = roster.filter((p) => filter === "All" || p.group === filter);
  return <section className="card roster-card"><div className="card-header roster-header"><div><h2>My Roster</h2><p>17 players · 9 starters</p></div><div className="segmented" role="group" aria-label="Roster filter">{(["All", "Starters", "Bench"] as RosterFilter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="roster-columns" aria-hidden="true"><span>LINEUP</span><span>PLAYER</span><span>OPP</span><span>PROJ</span><span /></div>{(["Starters", "Bench"] as const).map((group) => { const groupPlayers = visible.filter((player) => player.group === group); if (!groupPlayers.length) return null; return <div className="roster-group" key={group}><div className="group-label"><span>{group.toUpperCase()}</span><i /></div>{groupPlayers.map((player) => <PlayerRow key={player.id} player={player} selected={selected === player.id} onSelect={() => setSelected(player.id)} />)}</div>; })}</section>;
}

function TeamNeeds() {
  return <section className="card side-card"><div className="card-header"><div><h2>Team Needs</h2><p>Based on your roster</p></div><CircleHelp size={16} className="muted-icon" /></div><div className="needs-list">{teamNeeds.map((need) => <div className="need-row" key={need.position}><span className="position-chip">{need.position}</span><span className="need-track"><i style={{ width: `${need.score}%` }} /></span><strong className={`need-${need.level.toLowerCase()}`}>{need.level}</strong></div>)}</div></section>;
}

function TradeSuggestion() {
  const [selected, setSelected] = useState(tradeIdeas[0].id);
  return <section className="card side-card"><div className="card-header"><div><h2>Trade Ideas</h2><p>Moves tailored to your roster</p></div><Sparkles size={17} className="accent-icon" /></div><div className="trade-list">{tradeIdeas.map((trade) => <button key={trade.id} className={`trade-card ${selected === trade.id ? "selected" : ""}`} onClick={() => setSelected(trade.id)}><span className="trade-top"><b>{trade.label}</b><em>Fit {trade.fit}</em></span><span className="trade-exchange"><span><small>SEND</small><strong>{trade.send}</strong></span><ArrowRight size={15} /><span><small>RECEIVE</small><strong>{trade.receive}</strong></span></span><span className="trade-action">View trade <ChevronRight size={14} /></span></button>)}</div><button className="text-link">Explore Trades <ArrowRight size={15} /></button></section>;
}

function WaiverSuggestion() {
  const [added, setAdded] = useState<string[]>([]);
  const toggleAdd = (id: string) => setAdded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <section className="card side-card"><div className="card-header"><div><h2>Waiver Targets</h2><p>Available in your league</p></div><CalendarDays size={17} className="muted-icon" /></div><div className="waiver-list">{waiverTargets.map((player) => <div className="waiver-row" key={player.id}><div className="mini-avatar">{player.initials}</div><div><strong>{player.name}</strong><small>{player.position} · {player.team}</small><p>{player.reason}</p></div><button className={added.includes(player.id) ? "added" : ""} onClick={() => toggleAdd(player.id)}>{added.includes(player.id) ? "Added" : "+ Add"}</button></div>)}</div><button className="text-link">View Waivers <ArrowRight size={15} /></button></section>;
}

export default function Home() {
  const [week, setWeek] = useState(1);
  const [activeNav, setActiveNav] = useState("Dashboard");
  return <div className="app-shell"><Sidebar active={activeNav} onChange={setActiveNav} /><main><TopBar week={week} setWeek={setWeek} /><div className="content-wrap">{activeNav !== "Dashboard" ? <section className="placeholder-view"><Trophy size={24} /><h2>{activeNav}</h2><p>This workspace is ready for the next phase of Fantasy Command Center.</p><button onClick={() => setActiveNav("Dashboard")}>Back to dashboard</button></section> : <><SummaryStrip /><div className="dashboard-grid"><Roster /><aside className="right-column"><TeamNeeds /><TradeSuggestion /><WaiverSuggestion /></aside></div></>}</div></main></div>;
}
