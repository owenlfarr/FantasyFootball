export type RosterFilter = "All" | "Starters" | "Bench";
export type Player = { id: string; name: string; initials: string; team: string; position: string; slot: string; group: Exclude<RosterFilter, "All">; projected: number; opponent: string; status?: string; };
export const navigation = [{ label: "Dashboard", icon: "dashboard" }, { label: "Trades", icon: "trades" }, { label: "Waivers", icon: "waivers" }, { label: "League", icon: "league" }];
export const roster: Player[] = [
  { id: "jalen-hurts", name: "Jalen Hurts", initials: "JH", team: "PHI", position: "QB", slot: "QB", group: "Starters", projected: 22.8, opponent: "vs DAL" },
  { id: "bijan-robinson", name: "Bijan Robinson", initials: "BR", team: "ATL", position: "RB", slot: "RB", group: "Starters", projected: 19.4, opponent: "vs TB" },
  { id: "breece-hall", name: "Breece Hall", initials: "BH", team: "NYJ", position: "RB", slot: "RB", group: "Starters", projected: 17.2, opponent: "@ BUF" },
  { id: "drake-london", name: "Drake London", initials: "DL", team: "ATL", position: "WR", slot: "WR", group: "Starters", projected: 14.8, opponent: "vs TB" },
  { id: "devonta-smith", name: "DeVonta Smith", initials: "DS", team: "PHI", position: "WR", slot: "WR", group: "Starters", projected: 13.5, opponent: "vs DAL" },
  { id: "dallas-goedert", name: "Dallas Goedert", initials: "DG", team: "PHI", position: "TE", slot: "TE", group: "Starters", projected: 9.1, opponent: "vs DAL", status: "Q" },
  { id: "james-cook", name: "James Cook", initials: "JC", team: "BUF", position: "RB", slot: "FLEX", group: "Starters", projected: 15.6, opponent: "vs NYJ" },
  { id: "steelers-dst", name: "Pittsburgh Steelers", initials: "PIT", team: "PIT", position: "D/ST", slot: "D/ST", group: "Starters", projected: 8.2, opponent: "@ CLE" },
  { id: "brandon-aubrey", name: "Brandon Aubrey", initials: "BA", team: "DAL", position: "K", slot: "K", group: "Starters", projected: 7.8, opponent: "@ PHI" },
  { id: "zay-flowers", name: "Zay Flowers", initials: "ZF", team: "BAL", position: "WR", slot: "BE", group: "Bench", projected: 12.9, opponent: "@ KC" },
  { id: "rome-odunze", name: "Rome Odunze", initials: "RO", team: "CHI", position: "WR", slot: "BE", group: "Bench", projected: 10.6, opponent: "vs MIN" },
  { id: "jonathon-brooks", name: "Jonathon Brooks", initials: "JB", team: "CAR", position: "RB", slot: "BE", group: "Bench", projected: 8.4, opponent: "@ NO", status: "Q" },
  { id: "trey-benson", name: "Trey Benson", initials: "TB", team: "ARI", position: "RB", slot: "BE", group: "Bench", projected: 7.7, opponent: "@ BUF" },
  { id: "brian-thomas", name: "Brian Thomas Jr.", initials: "BT", team: "JAX", position: "WR", slot: "BE", group: "Bench", projected: 11.3, opponent: "@ MIA" },
  { id: "brock-bowers", name: "Brock Bowers", initials: "BB", team: "LV", position: "TE", slot: "BE", group: "Bench", projected: 8.8, opponent: "@ LAC" },
  { id: "jayden-daniels", name: "Jayden Daniels", initials: "JD", team: "WAS", position: "QB", slot: "BE", group: "Bench", projected: 18.5, opponent: "@ TB" },
  { id: "rashid-shaheed", name: "Rashid Shaheed", initials: "RS", team: "NO", position: "WR", slot: "BE", group: "Bench", projected: 9.6, opponent: "vs CAR" },
];
export const teamNeeds = [{ position: "WR", level: "High", score: 82 }, { position: "TE", level: "Medium", score: 54 }, { position: "RB", level: "Low", score: 27 }];
export const tradeIdeas = [{ id: "upgrade-wr", label: "Upgrade at WR", send: "Z. Flowers + R. Odunze", receive: "G. Wilson", fit: 92 }, { id: "elite-te", label: "Consolidate for elite TE", send: "D. Goedert + J. Cook", receive: "S. LaPorta", fit: 87 }];
export const waiverTargets = [{ id: "jayden-higgins", name: "Jayden Higgins", initials: "JH", position: "WR", team: "HOU", reason: "High-upside bench stash" }, { id: "brashard-smith", name: "Brashard Smith", initials: "BS", position: "RB", team: "KC", reason: "Path to passing-down work" }, { id: "mason-taylor", name: "Mason Taylor", initials: "MT", position: "TE", team: "NYJ", reason: "Emerging red-zone target" }];
