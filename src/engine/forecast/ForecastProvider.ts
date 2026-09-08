import type { LeagueSnapshot, PlayerForecast } from "../types";

export interface ForecastProvider {
  readonly version: string;
  getWeeklyForecast(
    playerId: string,
    week: number,
    context: LeagueSnapshot,
  ): PlayerForecast | undefined;
}

export class SnapshotForecastProvider implements ForecastProvider {
  readonly version: string;
  constructor(version = "snapshot-v1") {
    this.version = version;
  }
  getWeeklyForecast(
    playerId: string,
    week: number,
    context: LeagueSnapshot,
  ): PlayerForecast | undefined {
    return context.players[playerId]?.forecasts.find(
      (forecast) => forecast.week === week,
    );
  }
}

export function forecastKey(playerId: string, week: number): string {
  return `${playerId}:${week}`;
}
