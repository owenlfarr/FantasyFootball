export const ESPN_REFRESH_INTERVAL_MS = 600_000;
export const ACTIVATION_RETRY_THROTTLE_MS = 30_000;

export type EspnSyncState = "SYNCING" | "LIVE" | "REFRESHING" | "STALE" | "ERROR";
export type EspnSyncSnapshot<T> = {
  state: EspnSyncState;
  payload?: T;
  lastSuccessfulAt?: number;
  error?: Error;
};
export type EspnSyncControllerOptions<T> = {
  request: (force: boolean) => Promise<T>;
  isStale?: (payload: T) => boolean;
  successfulAt?: (payload: T) => number | undefined;
  now?: () => number;
  setInterval?: (callback: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  staleAfterMs?: number;
};

export class EspnSyncController<T> {
  private readonly options: Required<Pick<EspnSyncControllerOptions<T>, "now" | "setInterval" | "clearInterval">> & EspnSyncControllerOptions<T>;
  private snapshot: EspnSyncSnapshot<T> = { state: "SYNCING" };
  private listeners = new Set<(snapshot: EspnSyncSnapshot<T>) => void>();
  private inFlight?: Promise<T | undefined>;
  private interval?: ReturnType<typeof globalThis.setInterval>;
  private lastAttemptAt = 0;
  private stopped = false;

  constructor(options: EspnSyncControllerOptions<T>) {
    this.options = {
      ...options,
      now: options.now ?? Date.now,
      // Browser timer methods can require their Window receiver. Storing the
      // unbound native function caused "Illegal invocation" in the client.
      setInterval:
        options.setInterval ?? globalThis.setInterval.bind(globalThis),
      clearInterval:
        options.clearInterval ?? globalThis.clearInterval.bind(globalThis),
      staleAfterMs: options.staleAfterMs ?? ESPN_REFRESH_INTERVAL_MS,
    };
  }

  get state() { return this.snapshot; }
  subscribe(listener: (snapshot: EspnSyncSnapshot<T>) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
  private emit(snapshot: EspnSyncSnapshot<T>) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
  start() {
    this.stopped = false;
    if (!this.interval) {
      this.interval = this.options.setInterval(() => void this.refresh(true), ESPN_REFRESH_INTERVAL_MS);
    }
    void this.refresh(true);
  }
  stop() {
    this.stopped = true;
    if (this.interval) this.options.clearInterval(this.interval);
    this.interval = undefined;
  }
  async refresh(force = false): Promise<T | undefined> {
    if (this.stopped) return this.snapshot.payload;
    if (this.inFlight) return this.inFlight;
    if (!force && this.snapshot.lastSuccessfulAt && this.options.now() - this.snapshot.lastSuccessfulAt < this.options.staleAfterMs!) return this.snapshot.payload;
    this.lastAttemptAt = this.options.now();
    this.emit({ ...this.snapshot, state: this.snapshot.payload ? "REFRESHING" : "SYNCING", error: undefined });
    this.inFlight = this.options.request(force).then((payload) => {
      const stale = this.options.isStale?.(payload) ?? false;
      const lastSuccessfulAt = this.options.successfulAt?.(payload) ?? (stale ? this.snapshot.lastSuccessfulAt : this.options.now());
      this.emit({ state: stale ? "STALE" : "LIVE", payload, lastSuccessfulAt });
      return payload;
    }).catch((error: unknown) => {
      const next = this.snapshot.payload ? "STALE" : "ERROR";
      this.emit({ ...this.snapshot, state: next, error: error instanceof Error ? error : new Error(String(error)) });
      return undefined;
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  activate() {
    const stale = !this.snapshot.lastSuccessfulAt || this.options.now() - this.snapshot.lastSuccessfulAt >= this.options.staleAfterMs!;
    if (stale && this.options.now() - this.lastAttemptAt >= ACTIVATION_RETRY_THROTTLE_MS) return this.refresh(true);
    return Promise.resolve(this.snapshot.payload);
  }
}
