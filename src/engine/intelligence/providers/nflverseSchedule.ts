import { parseCsv, responseText } from "./csv";
export interface NFLGameSchedule { gameId:string; season:number; week:number; homeTeam:string; awayTeam:string; kickoffAt:string; status:"scheduled"|"in_progress"|"final"|"postponed"|"cancelled"; }
const url="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
/** nflverse nfldata schedules; NFL game times are published in US Eastern time. */
export class NflverseScheduleProvider {
  constructor(private readonly fetcher:typeof fetch=fetch){}
  async getSeason(season:number):Promise<NFLGameSchedule[]>{const r=await this.fetcher(url,{signal:AbortSignal.timeout(12_000)});if(!r.ok)throw new Error(`schedule HTTP ${r.status}`);const rows=parseCsv(await responseText(r,false));return rows.filter(x=>Number(x.season)===season&&x.game_type==="REG"&&Number(x.week)>0).flatMap(x=>{const date=x.gameday, time=x.gametime;if(!date||!time)return[];const month=Number(date.slice(5,7));const offset=month>=3&&month<=10?"-04:00":"-05:00";const raw=`${date}T${time}:00${offset}`, kickoff=new Date(raw);if(Number.isNaN(kickoff.valueOf()))return[];const status=x.home_score!==""&&x.away_score!==""?"final":"scheduled" as const;return[{gameId:x.game_id,season,week:Number(x.week),homeTeam:x.home_team,awayTeam:x.away_team,kickoffAt:kickoff.toISOString(),status}];});}
}
export function gameForTeam(games:NFLGameSchedule[], team:string, week:number){return games.find(g=>g.week===week&&(g.homeTeam===team||g.awayTeam===team));}
