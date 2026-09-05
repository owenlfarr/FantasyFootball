import type {
  CanonicalPosition,
  LineupSlotDefinition,
  SlotKind,
} from "../types";

const positionById: Record<number, CanonicalPosition> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  6: "P",
  7: "DL",
  8: "LB",
  9: "DB",
  14: "HC",
  16: "D/ST",
};

type SlotTemplate = Omit<LineupSlotDefinition, "id" | "count">;

const slotById: Record<number, SlotTemplate> = {
  0: { espnSlotId: 0, name: "QB", kind: "active", eligiblePositions: ["QB"] },
  1: { espnSlotId: 1, name: "TQB", kind: "active", eligiblePositions: ["QB"] },
  2: { espnSlotId: 2, name: "RB", kind: "active", eligiblePositions: ["RB"] },
  3: {
    espnSlotId: 3,
    name: "RB/WR",
    kind: "active",
    eligiblePositions: ["RB", "WR"],
  },
  4: { espnSlotId: 4, name: "WR", kind: "active", eligiblePositions: ["WR"] },
  5: {
    espnSlotId: 5,
    name: "WR/TE",
    kind: "active",
    eligiblePositions: ["WR", "TE"],
  },
  6: { espnSlotId: 6, name: "TE", kind: "active", eligiblePositions: ["TE"] },
  7: {
    espnSlotId: 7,
    name: "OP",
    kind: "active",
    eligiblePositions: ["QB", "RB", "WR", "TE"],
  },
  8: { espnSlotId: 8, name: "DT", kind: "active", eligiblePositions: ["DL"] },
  9: { espnSlotId: 9, name: "DE", kind: "active", eligiblePositions: ["DL"] },
  10: { espnSlotId: 10, name: "LB", kind: "active", eligiblePositions: ["LB"] },
  11: { espnSlotId: 11, name: "DL", kind: "active", eligiblePositions: ["DL"] },
  12: { espnSlotId: 12, name: "CB", kind: "active", eligiblePositions: ["DB"] },
  13: { espnSlotId: 13, name: "S", kind: "active", eligiblePositions: ["DB"] },
  14: { espnSlotId: 14, name: "DB", kind: "active", eligiblePositions: ["DB"] },
  15: {
    espnSlotId: 15,
    name: "DP",
    kind: "active",
    eligiblePositions: ["DL", "LB", "DB"],
  },
  16: {
    espnSlotId: 16,
    name: "D/ST",
    kind: "active",
    eligiblePositions: ["D/ST"],
  },
  17: { espnSlotId: 17, name: "K", kind: "active", eligiblePositions: ["K"] },
  18: { espnSlotId: 18, name: "P", kind: "active", eligiblePositions: ["P"] },
  19: { espnSlotId: 19, name: "HC", kind: "active", eligiblePositions: ["HC"] },
  20: { espnSlotId: 20, name: "BE", kind: "bench", eligiblePositions: [] },
  21: { espnSlotId: 21, name: "IR", kind: "ir", eligiblePositions: [] },
  22: {
    espnSlotId: 22,
    name: "FLEX",
    kind: "active",
    eligiblePositions: ["RB", "WR", "TE"],
  },
  23: {
    espnSlotId: 23,
    name: "FLEX",
    kind: "active",
    eligiblePositions: ["RB", "WR", "TE"],
  },
  24: { espnSlotId: 24, name: "ER", kind: "bench", eligiblePositions: [] },
  25: {
    espnSlotId: 25,
    name: "Rookie BE",
    kind: "bench",
    eligiblePositions: [],
  },
};

export function canonicalPosition(positionId?: number): CanonicalPosition {
  return positionId === undefined
    ? "UNKNOWN"
    : (positionById[positionId] ?? "UNKNOWN");
}

export function canonicalSlot(
  slotId: number,
  count: number,
): LineupSlotDefinition | undefined {
  const template = slotById[slotId];
  return template ? { ...template, id: `espn-${slotId}`, count } : undefined;
}

export function slotKind(slotId: number): SlotKind | undefined {
  return slotById[slotId]?.kind;
}
export function slotName(slotId: number): string | undefined {
  return slotById[slotId]?.name;
}

export function positionIdMap(): Readonly<Record<number, CanonicalPosition>> {
  return positionById;
}
