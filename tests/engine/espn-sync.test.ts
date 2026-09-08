import assert from "node:assert/strict";
import test from "node:test";
import { EspnSyncController, ESPN_REFRESH_INTERVAL_MS } from "../../src/client/espnSyncController";

test("default browser timer functions are invoked with a valid global receiver", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let receivedBoundReceiver = false;
  try {
    globalThis.setInterval = function (this: unknown) {
      receivedBoundReceiver = this === globalThis;
      return 1 as unknown as ReturnType<typeof setInterval>;
    } as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = (() => undefined) as typeof globalThis.clearInterval;
    const controller = new EspnSyncController<string>({ request: async () => "ok" });
    controller.start();
    assert.equal(receivedBoundReceiver, true);
    controller.stop();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("ESPN sync starts immediately and refreshes at ten minutes without overlap", async () => {
  let now = 0;
  let calls = 0;
  let resolve: ((value: string) => void) | undefined;
  let timer: (() => void) | undefined;
  const controller = new EspnSyncController<string>({ now: () => now, request: () => { calls++; return new Promise<string>((done) => { resolve = done; }); }, setInterval: (callback) => { timer = callback; return 1 as unknown as ReturnType<typeof setInterval>; }, clearInterval: () => undefined });
  controller.start();
  assert.equal(calls, 1);
  void controller.refresh(true);
  assert.equal(calls, 1);
  resolve?.("first");
  await new Promise((done) => setImmediate(done));
  now = ESPN_REFRESH_INTERVAL_MS;
  timer?.();
  assert.equal(calls, 2);
  resolve?.("second");
  await new Promise((done) => setImmediate(done));
  assert.equal(controller.state.state, "LIVE");
  controller.stop();
});

test("failed refresh retains the last valid payload and reports stale", async () => {
  let reject: ((reason?: unknown) => void) | undefined;
  let first = true;
  const controller = new EspnSyncController<string>({ request: () => first ? Promise.resolve("valid") : new Promise<string>((_, fail) => { reject = fail; }) });
  controller.start();
  await new Promise((done) => setImmediate(done));
  first = false;
  void controller.refresh(true);
  reject?.(new Error("temporary"));
  await new Promise((done) => setImmediate(done));
  assert.equal(controller.state.payload, "valid");
  assert.equal(controller.state.state, "STALE");
  controller.stop();
});

test("activation refreshes only when stale and throttles repeated activation", async () => {
  let now = 100_000;
  let calls = 0;
  const controller = new EspnSyncController<string>({ now: () => now, request: async () => { calls++; return "ok"; } });
  controller.start();
  await new Promise((done) => setImmediate(done));
  assert.equal(calls, 1);
  now = 101_000;
  await controller.activate();
  assert.equal(calls, 1);
  now = 700_000;
  void controller.activate();
  void controller.activate();
  await new Promise((done) => setImmediate(done));
  assert.equal(calls, 2);
  now += 1_000;
  await controller.activate();
  assert.equal(calls, 2);
  controller.stop();
});

test("forced manual refresh bypasses freshness", async () => {
  let calls = 0;
  const controller = new EspnSyncController<string>({ request: async () => `payload-${++calls}` });
  controller.start();
  await new Promise((done) => setImmediate(done));
  await controller.refresh(true);
  assert.equal(calls, 2);
  controller.stop();
});

test("a stale-but-valid first payload retains its server success time", async () => {
  const lastSuccessfulAt = 123_000;
  const controller = new EspnSyncController<{ stale: boolean; syncedAt: number }>({
    now: () => 900_000,
    request: async () => ({ stale: true, syncedAt: lastSuccessfulAt }),
    isStale: (payload) => payload.stale,
    successfulAt: (payload) => payload.syncedAt,
  });
  controller.start();
  await new Promise((done) => setImmediate(done));
  assert.equal(controller.state.state, "STALE");
  assert.equal(controller.state.lastSuccessfulAt, lastSuccessfulAt);
  assert.deepEqual(controller.state.payload, { stale: true, syncedAt: lastSuccessfulAt });
  controller.stop();
});

test("interval is registered at exactly ten minutes and an initial failure is not a live snapshot", async () => {
  let intervalMs = 0;
  let reject: ((reason?: unknown) => void) | undefined;
  const controller = new EspnSyncController<string>({
    request: () => new Promise<string>((_, fail) => { reject = fail; }),
    setInterval: (_callback, ms) => { intervalMs = ms; return 1 as unknown as ReturnType<typeof setInterval>; },
    clearInterval: () => undefined,
  });
  controller.start();
  assert.equal(intervalMs, ESPN_REFRESH_INTERVAL_MS);
  reject?.(new Error("ESPN unavailable"));
  await new Promise((done) => setImmediate(done));
  assert.equal(controller.state.state, "ERROR");
  assert.equal(controller.state.payload, undefined);
  assert.equal(controller.state.lastSuccessfulAt, undefined);
  controller.stop();
});

test("a fresh non-forced refresh is suppressed without replacing the payload", async () => {
  let calls = 0;
  const controller = new EspnSyncController<string>({ request: async () => `payload-${++calls}` });
  controller.start();
  await new Promise((done) => setImmediate(done));
  assert.equal(await controller.refresh(false), "payload-1");
  assert.equal(calls, 1);
  assert.equal(controller.state.payload, "payload-1");
  controller.stop();
});
