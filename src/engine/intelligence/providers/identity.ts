import type { CanonicalPosition, LeaguePlayer } from "../../types";

const TEAM_ALIASES: Record<string, string> = {
  JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR",
  WSH: "WAS",
};
export const normalizeTeam = (team: string) =>
  TEAM_ALIASES[team.toUpperCase()] ?? team.toUpperCase();
export const normalizePlayerName = (name: string, stripSuffix = false) => {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return stripSuffix
    ? normalized.replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    : normalized;
};
export interface ExternalIdentity {
  id: string;
  name: string;
  team: string;
  position: CanonicalPosition;
  espnId?: string;
}
export interface IdentityResolution {
  internalPlayerId?: string;
  method: "stable_id" | "exact_identity" | "suffix_normalized" | "unmapped";
}

export function resolveExternalIdentity(
  external: ExternalIdentity,
  players: Readonly<Record<string, LeaguePlayer>>,
): IdentityResolution {
  if (external.espnId && players[external.espnId]) {
    const player = players[external.espnId];
    if (
      player.primaryPosition === external.position &&
      normalizeTeam(player.nflTeam) === normalizeTeam(external.team)
    ) return { internalPlayerId: player.id, method: "stable_id" };
    return { method: "unmapped" };
  }
  const candidates = Object.values(players).filter(
    (player) =>
      player.primaryPosition === external.position &&
      normalizeTeam(player.nflTeam) === normalizeTeam(external.team),
  );
  const exact = candidates.filter(
    (player) => normalizePlayerName(player.name) === normalizePlayerName(external.name),
  );
  if (exact.length === 1)
    return { internalPlayerId: exact[0].id, method: "exact_identity" };
  const suffix = candidates.filter(
    (player) =>
      normalizePlayerName(player.name, true) ===
      normalizePlayerName(external.name, true),
  );
  return suffix.length === 1
    ? { internalPlayerId: suffix[0].id, method: "suffix_normalized" }
    : { method: "unmapped" };
}
