import type { LeagueSnapshot } from "./types";
export type TeamPerspective = "MY_TEAM" | "MARVIN_TEAM";
export type TeamPerspectiveResolution = { perspective: TeamPerspective; teamId?: string; available: boolean; label: string; teamName?: string };
const MARVIN_ESPN_ID = "4432708";
export function resolveTeamPerspectives(snapshot: LeagueSnapshot): TeamPerspectiveResolution[] {
  const mine=snapshot.teams.find(t=>t.id===snapshot.primaryTeamId);
  const marvin=Object.values(snapshot.players).find(p=>p.externalIds?.espn===MARVIN_ESPN_ID || p.id===MARVIN_ESPN_ID || p.name.trim().toLowerCase()==="marvin harrison jr.");
  const marvinTeam=marvin?.rosteredTeamId ? snapshot.teams.find(t=>t.id===marvin.rosteredTeamId) : undefined;
  return [{perspective:"MY_TEAM",teamId:mine?.id,available:Boolean(mine),label:"My Team",teamName:mine?.name},{perspective:"MARVIN_TEAM",teamId:marvinTeam?.id,available:Boolean(marvinTeam),label:"Marvin Team",teamName:marvinTeam?.name}];
}
export function selectPerspective(snapshot: LeagueSnapshot, perspective:TeamPerspective="MY_TEAM") { const chosen=resolveTeamPerspectives(snapshot).find(x=>x.perspective===perspective); return chosen?.available&&chosen.teamId?{...snapshot,primaryTeamId:chosen.teamId}:snapshot; }
