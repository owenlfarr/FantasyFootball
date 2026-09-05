import { NextResponse } from "next/server";
import { saveManagerNote } from "@/db/tradeOffers";
import type { ManagerNote, ManagerTag } from "@/src/engine";

const tags = new Set<ManagerTag>(["PREFERS_DEPTH", "PREFERS_STARS", "RARE_TRADER", "ACTIVE_TRADER", "RB_INTEREST", "WR_INTEREST", "QB_INTEREST", "TE_INTEREST"]);
export async function POST(request: Request) {
  try {
    const note = await request.json() as ManagerNote;
    if (!note?.id || !note.leagueId || !note.teamId || !note.text?.trim() || !Array.isArray(note.tags) || !note.tags.every((tag) => tags.has(tag)))
      return NextResponse.json({ error: "Invalid manager note." }, { status: 400 });
    await saveManagerNote(note);
    return NextResponse.json({ ok: true, id: note.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manager note persistence failed." }, { status: 500 });
  }
}
