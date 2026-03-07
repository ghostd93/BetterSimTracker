import test from "node:test";
import assert from "node:assert/strict";

import { defaultSettings } from "../src/settings";
import { createPromptRefreshController } from "../src/runtimePromptSync";
import type { BetterSimTrackerSettings, STContext, TrackerData } from "../src/types";

function makeTracker(timestamp: number): TrackerData {
  return {
    timestamp,
    activeCharacters: ["Seraphina"],
    statistics: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customStatistics: {},
    customNonNumericStatistics: {},
  };
}

test("queuePromptSync skips identical signatures and syncs on meaningful changes", async () => {
  const traces: Array<{ event: string; payload?: Record<string, unknown> }> = [];
  const syncCalls: Array<{ context: STContext; settings: BetterSimTrackerSettings; data: TrackerData | null }> = [];
  let latestData: TrackerData | null = makeTracker(1);
  let latestPromptMacroData: TrackerData | null = makeTracker(2);
  const context: STContext = { chat: [], characterId: 1 };

  const controller = createPromptRefreshController({
    getSettings: () => ({ ...defaultSettings, enabled: true }),
    getLatestData: () => latestData,
    getLatestPromptMacroData: () => latestPromptMacroData,
    pushTrace: (event, payload) => traces.push({ event, payload }),
    refreshFromStoredData: () => undefined,
    syncPromptInjectionFn: async payload => {
      syncCalls.push(payload);
    },
  });

  controller.queuePromptSync(context);
  controller.queuePromptSync(context);
  latestData = makeTracker(3);
  controller.queuePromptSync(context);

  await Promise.resolve();

  assert.equal(syncCalls.length, 2);
  assert.equal(traces.filter(item => item.event === "prompt.sync").length, 2);
  assert.equal(traces.filter(item => item.event === "prompt.sync.skip").length, 1);
  assert.equal(syncCalls[0].data?.timestamp, 2);
});

test("scheduleRefresh debounces timers and runs only the latest refresh", async () => {
  const realWindow = (globalThis as unknown as { window?: unknown }).window;
  const scheduled = new Map<number, () => void>();
  let nextId = 1;
  const refreshRuns: number[] = [];

  (globalThis as unknown as {
    window: {
      setTimeout: (fn: () => void, delay?: number) => number;
      clearTimeout: (id: number) => void;
    };
  }).window = {
    setTimeout(fn) {
      const id = nextId++;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
  };

  try {
    const controller = createPromptRefreshController({
      getSettings: () => defaultSettings,
      getLatestData: () => null,
      getLatestPromptMacroData: () => null,
      pushTrace: (event, payload) => {
        if (event === "refresh.run") {
          refreshRuns.push(Number(payload?.delay ?? 0));
        }
      },
      refreshFromStoredData: () => {
        refreshRuns.push(999);
      },
      syncPromptInjectionFn: async () => undefined,
    });

    controller.scheduleRefresh(80);
    controller.scheduleRefresh(120);

    assert.equal(scheduled.size, 1);
    const [fn] = [...scheduled.values()];
    fn();
    await Promise.resolve();

    assert.deepEqual(refreshRuns, [120, 999]);
  } finally {
    if (realWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window?: unknown }).window = realWindow;
    }
  }
});
