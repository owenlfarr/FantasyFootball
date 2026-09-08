import assert from "node:assert/strict";
import test from "node:test";
import { EspnSyncController } from "../../src/client/espnSyncController";

test("a pending interval refresh is followed by the newly selected week", async () => {
  let currentWeek = 1;
  let resolveRequest: ((week: number) => void) | undefined;
  const requestedWeeks: number[] = [];
  let intervalCallback: (() => void) | undefined;

  const controller = new EspnSyncController<number>({
    request: async () => {
      const requestedWeek = currentWeek;
      requestedWeeks.push(requestedWeek);
      return new Promise<number>((resolve) => {
        resolveRequest = resolve;
      });
    },
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => undefined,
  });

  controller.start();
  assert.deepEqual(requestedWeeks, [1]);
  resolveRequest?.(1);
  await new Promise((done) => setImmediate(done));

  intervalCallback?.();
  assert.deepEqual(requestedWeeks, [1, 1]);

  currentWeek = 2;
  const requestWeekAtChange = currentWeek - 1;
  const pendingRefresh = controller.refresh(true);
  assert.deepEqual(requestedWeeks, [1, 1]);

  resolveRequest?.(1);
  await pendingRefresh;
  if (currentWeek !== requestWeekAtChange) {
    void controller.refresh(true);
  }

  assert.deepEqual(requestedWeeks, [1, 1, 2]);
  controller.stop();
});
