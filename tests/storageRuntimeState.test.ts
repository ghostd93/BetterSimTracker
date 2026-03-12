import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { USER_TRACKER_KEY } from "../src/constants";
import { EXTENSION_KEY } from "../src/constants";
import { isTrackableMessage } from "../src/messageFilter";
import { buildMergedPromptMacroData, resolveLatestStoredTrackerData } from "../src/runtimeState";
import {
  clearTrackerDataForCurrentChat,
  getRecentTrackerHistoryEntries,
  getTrackerDataFromMessage,
  mergeCustomNonNumericStatisticsWithFallback,
  mergeCustomStatisticsWithFallback,
  mergeStatisticsWithFallback,
  saveTrackerSnapshot,
  writeTrackerDataToMessage,
} from "../src/storage";
import type { STContext, TrackerData } from "../src/types";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const localStorageMock = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = localStorageMock;

function makeTracker(timestamp: number, overrides: Partial<TrackerData> = {}): TrackerData {
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
      ...overrides.statistics,
    },
    customStatistics: overrides.customStatistics ?? {},
    customNonNumericStatistics: overrides.customNonNumericStatistics ?? {},
  };
}

function makeContext(): STContext {
  return {
    chat: [
      { mes: "Greeting", name: "Seraphina", is_user: false, is_system: false, extra: {} },
      { mes: "Hi", is_user: true, is_system: false, extra: {} },
      { mes: "Reply", name: "Seraphina", is_user: false, is_system: false, extra: {} },
    ],
    characterId: 1,
    chatMetadata: {},
  };
}

afterEach(() => {
  localStorageMock.clear();
});

test("getTrackerDataFromMessage respects swipe-specific payloads", () => {
  const tracker = makeTracker(1000);
  const message = {
    mes: "Reply",
    name: "Seraphina",
    is_user: false,
    is_system: false,
    swipe_id: 2,
    extra: {
      [EXTENSION_KEY]: {
        "2": tracker,
      },
    },
  };
  assert.deepEqual(getTrackerDataFromMessage(message), tracker);
});

test("writeTrackerDataToMessage stores per-message tracker data and snapshot history", () => {
  const context = makeContext();
  const tracker = makeTracker(1001, {
    statistics: {
      affection: { Seraphina: 55 },
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
  });
  writeTrackerDataToMessage(context, tracker, 2);
  assert.deepEqual(getTrackerDataFromMessage(context.chat[2]), tracker);
  const history = getRecentTrackerHistoryEntries(context, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].messageIndex, 2);
});

test("mergeStatisticsWithFallback and custom merges preserve previous missing values", () => {
  const mergedStats = mergeStatisticsWithFallback(
    {
      affection: { Seraphina: 60 },
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    {
      affection: { Seraphina: 50 },
      trust: { Seraphina: 40 },
      desire: {},
      connection: {},
      mood: { Seraphina: "Neutral" },
      lastThought: {},
    },
  );
  assert.deepEqual(mergedStats.trust, { Seraphina: 40 });
  assert.deepEqual(mergedStats.affection, { Seraphina: 60 });

  assert.deepEqual(
    mergeCustomStatisticsWithFallback(
      { satisfaction: { Seraphina: 70 } },
      { satisfaction: { User: 55 }, affinity: { Seraphina: 10 } },
    ),
    {
      satisfaction: { User: 55, Seraphina: 70 },
      affinity: { Seraphina: 10 },
    },
  );

  assert.deepEqual(
    mergeCustomNonNumericStatisticsWithFallback(
      { clothes: { Seraphina: ["Hat"] } },
      { clothes: { User: ["Boots"] }, pose: { Seraphina: "Standing" } },
    ),
    {
      clothes: { User: ["Boots"], Seraphina: ["Hat"] },
      pose: { Seraphina: "Standing" },
    },
  );

  assert.deepEqual(
    mergeCustomNonNumericStatisticsWithFallback(
      { clothes: { Seraphina: [] } },
      { clothes: { Seraphina: ["Hat"] } },
    ),
    {
      clothes: { Seraphina: [] },
    },
  );
});

test("getTrackerDataFromMessage preserves explicit empty array values", () => {
  const message = {
    mes: "Reply",
    name: "Seraphina",
    is_user: false,
    is_system: false,
    extra: {
      [EXTENSION_KEY]: makeTracker(1234, {
        customNonNumericStatistics: {
          clothes: { Seraphina: [] },
        },
      }),
    },
  };
  const data = getTrackerDataFromMessage(message);
  assert.ok(data);
  assert.deepEqual(data?.customNonNumericStatistics?.clothes, { Seraphina: [] });
});

test("buildMergedPromptMacroData merges tracker history into one richer snapshot", () => {
  const context = makeContext();
  const first = makeTracker(1000, {
    statistics: {
      affection: { Seraphina: 55 },
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customNonNumericStatistics: {
      clothes: { Seraphina: ["Hat"] },
    },
  });
  const second = makeTracker(2000, {
    statistics: {
      affection: {},
      trust: { Seraphina: 44 },
      desire: {},
      connection: {},
      mood: { Seraphina: "Hopeful" },
      lastThought: {},
    },
    customNonNumericStatistics: {
      pose: { Seraphina: "Standing" },
    },
  });

  saveTrackerSnapshot(context, first, 0);
  saveTrackerSnapshot(context, second, 2);

  const merged = buildMergedPromptMacroData(context, second);
  assert.ok(merged);
  assert.deepEqual(merged?.statistics.affection, { Seraphina: 55 });
  assert.deepEqual(merged?.statistics.trust, { Seraphina: 44 });
  assert.deepEqual(merged?.statistics.mood, { Seraphina: "Hopeful" });
  assert.deepEqual(merged?.customNonNumericStatistics?.clothes, { Seraphina: ["Hat"] });
  assert.deepEqual(merged?.customNonNumericStatistics?.pose, { Seraphina: "Standing" });
});

test("buildMergedPromptMacroData prefers the latest owner array value over older history", () => {
  const context = makeContext();
  const olderUser = makeTracker(1000, {
    activeCharacters: [USER_TRACKER_KEY],
    customNonNumericStatistics: {
      clothes: { [USER_TRACKER_KEY]: ["t-shirt", "jeans"] },
    },
  });
  const newerUser = makeTracker(2000, {
    activeCharacters: [USER_TRACKER_KEY],
    customNonNumericStatistics: {
      clothes: { [USER_TRACKER_KEY]: ["jeans"] },
    },
  });

  saveTrackerSnapshot(context, olderUser, 1);
  saveTrackerSnapshot(context, newerUser, 3);

  const merged = buildMergedPromptMacroData(context, newerUser);
  assert.ok(merged);
  assert.deepEqual(merged?.customNonNumericStatistics?.clothes, { [USER_TRACKER_KEY]: ["jeans"] });
});

test("buildMergedPromptMacroData prefers a newer manual edit on an older message over a stale later snapshot", () => {
  const context = makeContext();
  context.chat.push(
    { mes: "User edited later", is_user: true, is_system: false, extra: {} },
    { mes: "AI snapshot became stale", name: "Seraphina", is_user: false, is_system: false, extra: {} },
  );
  const editedUserSnapshot = makeTracker(3000, {
    activeCharacters: [USER_TRACKER_KEY],
    customNonNumericStatistics: {
      clothes: { [USER_TRACKER_KEY]: ["jeans"] },
      pose: { [USER_TRACKER_KEY]: "Standing in place" },
    },
  });
  const staleLaterAiSnapshot = makeTracker(2000, {
    activeCharacters: ["Seraphina"],
    statistics: {
      affection: { Seraphina: 4 },
      trust: {},
      desire: {},
      connection: {},
      mood: { Seraphina: "Playful" },
      lastThought: {},
    },
    customNonNumericStatistics: {
      clothes: {
        [USER_TRACKER_KEY]: ["t-shirt", "jeans"],
        Seraphina: ["black sundress"],
      },
    },
  });

  saveTrackerSnapshot(context, editedUserSnapshot, 3);
  saveTrackerSnapshot(context, staleLaterAiSnapshot, 4);

  const merged = buildMergedPromptMacroData(context, staleLaterAiSnapshot);
  assert.ok(merged);
  assert.deepEqual(merged?.customNonNumericStatistics?.clothes, {
    [USER_TRACKER_KEY]: ["jeans"],
    Seraphina: ["black sundress"],
  });
});

test("buildMergedPromptMacroData preserves a newer explicit nude user clothes edit over a later stale AI snapshot", () => {
  const context = makeContext();
  context.chat.push(
    { mes: "User manual edit", is_user: true, is_system: false, extra: {} },
    { mes: "AI response with stale user state", name: "Seraphina", is_user: false, is_system: false, extra: {} },
  );
  const editedUserSnapshot = makeTracker(4000, {
    activeCharacters: [USER_TRACKER_KEY],
    customNonNumericStatistics: {
      clothes: { [USER_TRACKER_KEY]: ["nude"] },
    },
  });
  const staleLaterAiSnapshot = makeTracker(3000, {
    activeCharacters: ["Seraphina"],
    customNonNumericStatistics: {
      clothes: {
        [USER_TRACKER_KEY]: ["t-shirt", "jeans"],
        Seraphina: ["black sundress"],
      },
    },
  });

  saveTrackerSnapshot(context, editedUserSnapshot, 3);
  saveTrackerSnapshot(context, staleLaterAiSnapshot, 4);

  const merged = buildMergedPromptMacroData(context, staleLaterAiSnapshot);
  assert.ok(merged);
  assert.deepEqual(merged?.customNonNumericStatistics?.clothes, {
    [USER_TRACKER_KEY]: ["nude"],
    Seraphina: ["black sundress"],
  });
});

test("resolveLatestStoredTrackerData prefers latest safe message snapshot", () => {
  const context = makeContext();
  const chatStateTracker = makeTracker(1000);
  const messageTracker = makeTracker(2000);

  saveTrackerSnapshot(context, chatStateTracker, 0);
  writeTrackerDataToMessage(context, messageTracker, 2);

  const resolved = resolveLatestStoredTrackerData(context, 2);
  assert.equal(resolved.source, "message");
  assert.equal(resolved.messageIndex, 2);
  assert.deepEqual(resolved.data, messageTracker);
});

test("clearTrackerDataForCurrentChat removes persisted tracker data", () => {
  const context = makeContext();
  const tracker = makeTracker(1000);
  writeTrackerDataToMessage(context, tracker, 2);
  assert.equal(isTrackableMessage(context.chat[2]), true);
  clearTrackerDataForCurrentChat(context);
  assert.equal(getTrackerDataFromMessage(context.chat[2]), null);
  assert.deepEqual(getRecentTrackerHistoryEntries(context, 10), []);
});
