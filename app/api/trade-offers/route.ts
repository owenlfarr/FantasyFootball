import { NextResponse } from "next/server";
import { recordTradeOffer } from "@/db/tradeOffers";
import type { OfferStatus, TradeOfferMutation } from "@/src/engine/plausibility/types";

const validStatus = new Set<OfferStatus>(["generated", "sent", "viewed", "ignored", "rejected", "countered", "accepted", "expired", "unknown"]);

export async function POST(request: Request) {
  try {
    const mutation = await request.json() as TradeOfferMutation;
    const offer = mutation.offer;
    if (!offer?.id || !offer.leagueId || !offer.senderTeamId || !offer.recipientTeamId ||
      !Array.isArray(offer.playersSent) || !Array.isArray(offer.playersReceived) ||
      !validStatus.has(offer.status) || !["generated", "sent", "manual", "observed"].includes(offer.source))
      return NextResponse.json({ error: "Invalid trade-off payload." }, { status: 400 });
    if (mutation.event && !validStatus.has(mutation.event.status))
      return NextResponse.json({ error: "Invalid offer event." }, { status: 400 });
    await recordTradeOffer(mutation);
    return NextResponse.json({ ok: true, id: offer.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Offer history persistence failed." }, { status: 500 });
  }
}
