import { NextResponse } from "next/server";
import {
  applyFundamentalForecasts,
  buildManagerProfiles,
  buildLeagueIntelligence,
  createSearchCache,
  derivePositionalNeeds,
  evaluateRoster,
  findBuyLowTargets,
  findSellHighCandidates,
  getEngineProfile,
  historyRecordsForSnapshot,
  loadExternalIntelligence,
  rankWaivers,
  resetEngineProfile,
  rosteredPlayerIds,
  searchTrades,
  validateLeagueSnapshot,
} from "@/src/engine";
import { slotName } from "@/src/engine/league/espnMappings";
import { loadLiveLeagueSnapshot } from "@/src/server/espnLeague";
import type {
  IntelligenceHistoryRecord,
  LeagueIntelligence,
  LeagueSnapshot,
  PlausibilityContext,
  ManagerNote,
  TradeOfferRecord,
} from "@/src/engine";
import {
  appendIntelligenceHistory,
  loadIntelligenceHistory,
} from "@/db/history";
import { loadManagerNotes, loadTradeOffers, recordTradeOffer } from "@/db/tradeOffers";
import type { DashboardSnapshot, Player } from "../../data";

// ESPN's private API is unversioned; normalization validates its unknown shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;
const MAX_WEEK = 18;
let snapshotCache:
  | {
      key: string;
      firstWeek: number;
      expiresAt: number;
      snapshot: LeagueSnapshot;
      intelligence: LeagueIntelligence;
      plausibilityContext: PlausibilityContext;
    }
  | undefined;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function statusLabel(status?: string): string | undefined {
  if (!status || ["ACTIVE", "NORMAL"].includes(status)) return undefined;
  return (
    (
      {
        QUESTIONABLE: "Q",
        DOUBTFUL: "D",
        OUT: "O",
        INJURY_RESERVE: "IR",
      } as Record<string, string>
    )[status] ?? status.slice(0, 2)
  );
}
function strengthScore(utilities: number[], teamUtility: number): number {
  if (utilities.length <= 1) return 50;
  const sorted = [...utilities].sort((a, b) => a - b);
  const below = sorted.filter((value) => value < teamUtility).length;
  return Math.round((100 * below) / (sorted.length - 1));
}
/** ESPN's transaction view is not contractual. Only complete, recognizable
 * executed player trades become positive observed-history records. */
function observedEspnTrades(raw: JsonRecord, snapshot: LeagueSnapshot): TradeOfferRecord[] {
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  return transactions.flatMap((transaction: JsonRecord) => {
    const type = String(transaction.type ?? transaction.transactionType ?? "").toUpperCase();
    const status = String(transaction.status ?? transaction.state ?? "").toUpperCase();
    const items = Array.isArray(transaction.items) ? transaction.items : [];
    if (!type.includes("TRADE") || (status && !status.includes("EXECUT"))) return [];
    const byDirection = new Map<string, string[]>();
    for (const item of items) {
      const from = item.fromTeamId ?? item.fromTeam?.id;
      const to = item.toTeamId ?? item.toTeam?.id;
      const playerId = String(item.playerId ?? item.player?.id ?? "");
      if (from === undefined || to === undefined || !snapshot.players[playerId]) continue;
      byDirection.set(`${from}:${to}`, [...(byDirection.get(`${from}:${to}`) ?? []), playerId]);
    }
    const directions = [...byDirection.entries()];
    if (directions.length !== 2) return [];
    const [[firstDirection, firstPlayers], [secondDirection, secondPlayers]] = directions;
    const [sender, recipient] = firstDirection.split(":");
    const [reverseSender, reverseRecipient] = secondDirection.split(":");
    if (sender !== reverseRecipient || recipient !== reverseSender || !firstPlayers.length || !secondPlayers.length) return [];
    const createdAt = String(transaction.executionDate ?? transaction.date ?? snapshot.provenance.asOf);
    return [{
      id: `espn:${String(transaction.id ?? `${createdAt}:${sender}:${recipient}`)}`,
      leagueId: snapshot.id, season: snapshot.season, senderTeamId: sender, recipientTeamId: recipient,
      playersSent: firstPlayers, playersReceived: secondPlayers, createdAt,
      source: "observed" as const, status: "accepted" as const, respondedAt: createdAt,
      snapshotVersion: snapshot.provenance.version ?? "espn",
    }];
  });
}

function dashboardResponse(
  snapshot: LeagueSnapshot,
  requestedWeek: number,
  includeSearch = false,
  intelligence?: LeagueIntelligence,
  plausibilityContext?: PlausibilityContext,
  compactSearch = false,
): DashboardSnapshot {
  const validation = validateLeagueSnapshot(snapshot);
  const primary = snapshot.teams.find(
    (team) => team.id === snapshot.primaryTeamId,
  )!;
  const displayRoster: Player[] = primary.roster.map((entry) => {
    const player = snapshot.players[entry.playerId];
    const forecast = player?.forecasts.find(
      (item) => item.week === requestedWeek,
    );
    return {
      id: entry.playerId,
      name: player?.name ?? `Player ${entry.playerId}`,
      initials: initials(player?.name ?? "?"),
      team: player?.nflTeam ?? "UNK",
      position: player?.primaryPosition ?? "UNKNOWN",
      slot: slotName(entry.assignedSlotId) ?? `Slot ${entry.assignedSlotId}`,
      group: entry.location === "active" ? "Starters" : "Bench",
      projected: forecast?.mean ?? 0,
      opponent: `W${requestedWeek}`,
      status: statusLabel(player?.injuryStatus),
      lineupSlotId: entry.assignedSlotId,
    };
  });
  const record = `${primary.record.wins}–${primary.record.losses}${primary.record.ties ? `–${primary.record.ties}` : ""}`;
  const playerDirectory = Object.fromEntries(
    Object.values(snapshot.players).map((player) => [
      player.id,
      {
        name: player.name,
        position: player.primaryPosition,
        team: player.nflTeam,
      },
    ]),
  );
  if (validation.status !== "READY")
    return {
      leagueId: snapshot.id,
      season: snapshot.season,
      primaryTeamId: snapshot.primaryTeamId,
      teamName: primary.name,
      abbreviation: primary.abbreviation ?? "",
      week: requestedWeek,
      record,
      projected: 0,
      players: displayRoster,
      playerDirectory,
      source: "ESPN",
      dataMode: snapshot.dataMode,
      engine: {
        status: "ENGINE_NOT_READY",
        missingRequirements: validation.missingRequirements,
        warnings: validation.warnings,
        asOf: snapshot.provenance.asOf,
      },
    };
  const rawEvaluationSnapshot =
    snapshot.currentWeek === requestedWeek
      ? snapshot
      : { ...snapshot, currentWeek: requestedWeek };
  const intel = intelligence ?? buildLeagueIntelligence(rawEvaluationSnapshot);
  const evaluationSnapshot = applyFundamentalForecasts(
    rawEvaluationSnapshot,
    intel,
  );
  if (includeSearch) resetEngineProfile();
  const sharedSearchCache = includeSearch
    ? createSearchCache(evaluationSnapshot, [primary.id])
    : undefined;
  const evaluations = sharedSearchCache
    ? [...sharedSearchCache.baseline.values()]
    : evaluationSnapshot.teams.map((team) =>
        evaluateRoster(evaluationSnapshot, team.id, undefined, {
          includeMarginals: false,
        }),
      );
  const evaluation = evaluations.find((item) => item.teamId === primary.id)!;
  const currentLineup = evaluation.weeklyLineups.find(
    (lineup) => lineup.week === requestedWeek,
  );
  // The interactive route keeps a deliberately small exact-evaluation budget.
  // The framework-independent APIs retain broader configurable defaults for
  // offline analysis, while every survivor here still runs through V1.
  const search = includeSearch
    ? {
        trades: searchTrades(
          primary.id,
          evaluationSnapshot,
          {
            maxQuickCandidatesPerOpponent: compactSearch ? 8 : 60,
            maxCandidatesPerOpponent: compactSearch ? 1 : 3,
            maxFinalResults: compactSearch ? 3 : 10,
          },
          intel,
          sharedSearchCache,
          plausibilityContext,
        ),
        waivers: rankWaivers(
          primary.id,
          evaluationSnapshot,
          { maxPriorityCandidates: compactSearch ? 1 : 8, maxFinalResults: compactSearch ? 3 : 10 },
          intel,
          sharedSearchCache,
        ),
        buyLow: findBuyLowTargets(primary.id, evaluationSnapshot, intel),
        sellHigh: findSellHighCandidates(primary.id, evaluationSnapshot, intel),
        intelligence: intel,
        managerProfiles: plausibilityContext?.profiles ?? {},
        profile: getEngineProfile(),
      }
    : undefined;
  return {
    leagueId: snapshot.id,
    season: snapshot.season,
    primaryTeamId: snapshot.primaryTeamId,
    teamName: primary.name,
    abbreviation: primary.abbreviation ?? "",
    week: requestedWeek,
    record,
    projected: currentLineup?.projectedPoints ?? 0,
    players: displayRoster,
    playerDirectory,
    source: "ESPN",
    dataMode: snapshot.dataMode,
    engine: {
      status: "READY",
      missingRequirements: [],
      warnings: [
        ...validation.warnings,
        ...(snapshot.dataMode === "stale"
          ? [
              "Live refresh failed; intelligence uses the last validated snapshot.",
            ]
          : []),
        ...evaluation.warnings.map((warning) => warning.message),
      ],
      asOf: snapshot.provenance.asOf,
      rosterStrength: strengthScore(
        evaluations.map((item) => item.utility.total),
        evaluation.utility.total,
      ),
      rosterUtility: evaluation.utility.total,
      injuryResilience: evaluation.injuryResilience,
      optimizedStarterIds:
        currentLineup?.assignments.map((assignment) => assignment.playerId) ??
        [],
      needs: derivePositionalNeeds(
        evaluationSnapshot,
        primary.id,
        evaluations,
      ).slice(0, 4),
      confidence: evaluation.dataConfidence,
      search,
    },
  };
}

export async function GET(request: Request) {
  const requestedWeek = Math.min(
    MAX_WEEK,
    Math.max(1, Number(new URL(request.url).searchParams.get("week")) || 1),
  );
  const includeSearch =
    new URL(request.url).searchParams.get("includeSearch") === "1";
  const compactSearch = new URL(request.url).searchParams.get("compact") === "1";
  try {
    const requested = requestedWeek;
    const cacheKey = `${process.env.ESPN_LEAGUE_ID}:${process.env.ESPN_SEASON_ID}:${process.env.ESPN_TEAM_ID}`;
    if (
      snapshotCache?.key === cacheKey &&
      snapshotCache.expiresAt > Date.now() &&
      requestedWeek >= snapshotCache.firstWeek
    ) {
      const cached =
        snapshotCache.snapshot.currentWeek === requestedWeek
          ? snapshotCache.snapshot
          : { ...snapshotCache.snapshot, currentWeek: requestedWeek };
      return NextResponse.json(
        dashboardResponse(
          cached,
          requestedWeek,
          includeSearch,
          snapshotCache.intelligence,
          snapshotCache.plausibilityContext,
          compactSearch,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const {snapshot,raw:base} = await loadLiveLeagueSnapshot(requested);
    let history: IntelligenceHistoryRecord[] = [];
    try {
      history = await loadIntelligenceHistory(
        snapshot.id,
        snapshot.season,
        snapshot.provenance.asOf,
      );
    } catch (error) {
      console.warn("Intelligence history unavailable", error);
    }
    const external = await loadExternalIntelligence(snapshot);
    const tradePlayerIds = rosteredPlayerIds(snapshot);
    const intelligence = buildLeagueIntelligence(snapshot, {
      history,
      playerIds: tradePlayerIds,
      usage: external.usage,
      marketSources: external.marketSources,
      providerDiagnostics: external.diagnostics,
    });
    intelligence.buyLow = findBuyLowTargets(
      snapshot.primaryTeamId,
      snapshot,
      intelligence,
    );
    intelligence.sellHigh = findSellHighCandidates(
      snapshot.primaryTeamId,
      snapshot,
      intelligence,
    );
    const observedTrades = observedEspnTrades(base, snapshot);
    try {
      await Promise.all(observedTrades.map((offer) => recordTradeOffer({ offer })));
    } catch (error) {
      console.warn("Observed ESPN trades could not be persisted", error);
    }
    let offers: TradeOfferRecord[] = [], notes: ManagerNote[] = [];
    try {
      [offers, notes] = await Promise.all([
        loadTradeOffers(snapshot.id, snapshot.season),
        loadManagerNotes(snapshot.id, snapshot.season),
      ]);
    } catch (error) {
      console.warn("Trade behavior history unavailable", error);
      intelligence.dataWarnings.push("Trade-offer history is unavailable; manager plausibility uses league priors.");
    }
    const plausibilityContext: PlausibilityContext = {
      snapshot,
      intelligence,
      profiles: buildManagerProfiles(snapshot, [...offers, ...observedTrades], notes),
    };
    try {
      await appendIntelligenceHistory(
        historyRecordsForSnapshot(
          snapshot.id,
          snapshot.season,
          snapshot.currentWeek,
          snapshot.provenance.asOf,
          intelligence.players,
          snapshot.players,
          external.usage,
        ),
      );
    } catch (error) {
      console.warn("Intelligence history persistence failed", error);
      intelligence.dataWarnings.push(
        "Historical intelligence could not be persisted for this refresh.",
      );
    }
    snapshotCache = {
      key: cacheKey,
      firstWeek: requestedWeek,
      expiresAt: Date.now() + 60_000,
      snapshot,
      intelligence,
      plausibilityContext,
    };
    return NextResponse.json(
      dashboardResponse(snapshot, requestedWeek, includeSearch, intelligence, plausibilityContext, compactSearch),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    const error = caught as Error & { status?: number };
    console.error("ESPN league sync failed", error.message);
    if (snapshotCache && requestedWeek >= snapshotCache.firstWeek) {
      const stale = {
        ...snapshotCache.snapshot,
        currentWeek: requestedWeek,
        dataMode: "stale" as const,
      };
      return NextResponse.json(
        dashboardResponse(
          stale,
          requestedWeek,
          includeSearch,
          snapshotCache.intelligence,
          snapshotCache.plausibilityContext,
          compactSearch,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const status = error.status === 401 || error.status === 403 ? 401 : 502;
    return NextResponse.json(
      {
        dataMode: "live",
        engine: {
          status: "ENGINE_NOT_READY",
          missingRequirements: [
            status === 401
              ? "ESPN credentials are invalid or expired"
              : "live ESPN league snapshot unavailable",
          ],
          warnings: [],
          asOf: new Date().toISOString(),
        },
        error:
          status === 401
            ? "ESPN credentials are invalid or expired."
            : "ESPN league sync failed.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
