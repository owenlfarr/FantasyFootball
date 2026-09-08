import { env } from "cloudflare:workers";
import type { ManagerNote, TradeOfferMutation, TradeOfferRecord } from "../src/engine/plausibility/types";

let initialized = false;
async function ensure() {
  if (initialized || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS trade_offers (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, season INTEGER NOT NULL, sender_team_id TEXT NOT NULL, recipient_team_id TEXT NOT NULL, players_sent_json TEXT NOT NULL, players_received_json TEXT NOT NULL, created_at TEXT NOT NULL, source TEXT NOT NULL, snapshot_version TEXT NOT NULL, plausibility_json TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS trade_offer_events (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, status TEXT NOT NULL, occurred_at TEXT NOT NULL, counter_offer_id TEXT, note TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS manager_notes (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, season INTEGER NOT NULL, team_id TEXT NOT NULL, created_at TEXT NOT NULL, text TEXT NOT NULL, tags_json TEXT NOT NULL, reluctant_player_ids_json TEXT, available_player_ids_json TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trade_offers_lookup ON trade_offers (league_id, season, recipient_team_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trade_offer_events_offer ON trade_offer_events (offer_id, occurred_at)"),
  ]);
  try { await env.DB.prepare("ALTER TABLE trade_offers ADD COLUMN plausibility_json TEXT").run(); } catch { /* existing V5 table is valid */ }
  initialized = true;
}
const eventId = () => crypto.randomUUID();
export async function recordTradeOffer(mutation: TradeOfferMutation): Promise<void> {
  if (!env.DB) return;
  await ensure();
  const { offer, event } = mutation;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO trade_offers (id, league_id, season, sender_team_id, recipient_team_id, players_sent_json, players_received_json, created_at, source, snapshot_version, plausibility_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(offer.id, offer.leagueId, offer.season, offer.senderTeamId, offer.recipientTeamId, JSON.stringify(offer.playersSent), JSON.stringify(offer.playersReceived), offer.createdAt, offer.source, offer.snapshotVersion, offer.plausibility ? JSON.stringify(offer.plausibility) : null),
    ...(event ? [env.DB.prepare("INSERT INTO trade_offer_events (id, offer_id, status, occurred_at, counter_offer_id, note) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(eventId(), offer.id, event.status, event.occurredAt ?? new Date().toISOString(), event.counterOfferId ?? null, event.note ?? null)] : []),
  ]);
}
export async function loadTradeOffers(leagueId: string, season: number): Promise<TradeOfferRecord[]> {
  if (!env.DB) return [];
  await ensure();
  const rows = await env.DB.prepare("SELECT o.*, e.status, e.occurred_at, e.counter_offer_id FROM trade_offers o LEFT JOIN trade_offer_events e ON e.id = (SELECT id FROM trade_offer_events x WHERE x.offer_id = o.id ORDER BY occurred_at DESC LIMIT 1) WHERE o.league_id = ? AND o.season = ? ORDER BY o.created_at ASC")
    .bind(leagueId, season).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id), leagueId: String(row.league_id), season: Number(row.season),
    senderTeamId: String(row.sender_team_id), recipientTeamId: String(row.recipient_team_id),
    playersSent: JSON.parse(String(row.players_sent_json)), playersReceived: JSON.parse(String(row.players_received_json)),
    createdAt: String(row.created_at), source: String(row.source) as TradeOfferRecord["source"],
    status: (row.status ? String(row.status) : "unknown") as TradeOfferRecord["status"],
    respondedAt: row.occurred_at ? String(row.occurred_at) : undefined,
    counterOfferId: row.counter_offer_id ? String(row.counter_offer_id) : undefined,
    snapshotVersion: String(row.snapshot_version), plausibility: row.plausibility_json ? JSON.parse(String(row.plausibility_json)) : undefined,
  }));
}
export async function saveManagerNote(note: ManagerNote): Promise<void> {
  if (!env.DB) return;
  await ensure();
  await env.DB.prepare("INSERT OR IGNORE INTO manager_notes (id, league_id, season, team_id, created_at, text, tags_json, reluctant_player_ids_json, available_player_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(note.id, note.leagueId, note.season, note.teamId, note.createdAt, note.text, JSON.stringify(note.tags), JSON.stringify(note.reluctantPlayerIds ?? []), JSON.stringify(note.availablePlayerIds ?? [])).run();
}
export async function loadManagerNotes(leagueId: string, season: number): Promise<ManagerNote[]> {
  if (!env.DB) return [];
  await ensure();
  const rows = await env.DB.prepare("SELECT * FROM manager_notes WHERE league_id = ? AND season = ? ORDER BY created_at ASC").bind(leagueId, season).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ id: String(row.id), leagueId: String(row.league_id), season: Number(row.season), teamId: String(row.team_id), createdAt: String(row.created_at), text: String(row.text), tags: JSON.parse(String(row.tags_json)), reluctantPlayerIds: JSON.parse(String(row.reluctant_player_ids_json ?? "[]")), availablePlayerIds: JSON.parse(String(row.available_player_ids_json ?? "[]")) }));
}
