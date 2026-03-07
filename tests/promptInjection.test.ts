import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_TRACKER_KEY } from "../src/constants";
import { __testables } from "../src/promptInjection";
import { defaultSettings } from "../src/settings";
import type { BetterSimTrackerSettings, STContext, TrackerData } from "../src/types";

function makeContext(overrides: Partial<STContext> = {}): STContext {
  return {
    chat: [],
    name1: "User",
    name2: "Seraphina",
    characterId: 0,
    characters: [{ name: "Seraphina", avatar: "seraphina.png" }],
    ...overrides,
  };
}

function makeTracker(overrides: Partial<TrackerData> = {}): TrackerData {
  return {
    timestamp: Date.now(),
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
    ...overrides,
  };
}

function makeSettings(overrides: Partial<BetterSimTrackerSettings> = {}): BetterSimTrackerSettings {
  return {
    ...defaultSettings,
    trackAffection: false,
    trackTrust: false,
    trackDesire: false,
    trackConnection: false,
    trackMood: false,
    trackLastThought: false,
    includeUserTrackerInInjection: false,
    customStats: [],
    ...overrides,
  };
}

test("buildPrompt includes global custom stats in a dedicated Scene line", () => {
  const settings = makeSettings({
    customStats: [
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "2026-03-07 20:00",
        dateTimeMode: "timestamp",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: true,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
    characterDefaults: {
      Seraphina: {
        statEnabled: {
          scene_date_time: false,
        },
      },
    },
  });
  const data = makeTracker({
    customNonNumericStatistics: {
      scene_date_time: {
        [GLOBAL_TRACKER_KEY]: "2026-03-07 20:05",
      },
    },
  });

  const prompt = __testables.buildPrompt(data, settings, makeContext());
  assert.match(prompt, /<BST_STAT_SEMANTICS>/);
  assert.match(prompt, /<BST_BEHAVIOR_BANDS>/);
  assert.match(prompt, /<BST_REACT_RULES>/);
  assert.match(prompt, /<BST_PRIORITY_RULES>/);
  assert.match(prompt, /<BST_OWNER_STATE_LINES>/);
  assert.match(prompt, /<BST_SUMMARIZATION_NOTE>/);
  assert.match(prompt, /- Scene: scene_date_time "2026-03-07 20:05"/);
});

test("buildPrompt includes global custom stats even when there are no owner lines", () => {
  const settings = makeSettings({
    customStats: [
      {
        id: "scene_location",
        kind: "text_short",
        label: "Scene Location",
        defaultValue: "Unknown",
        textMaxLength: 200,
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: true,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
  });
  const data = makeTracker({
    activeCharacters: [],
    customNonNumericStatistics: {
      scene_location: {
        [GLOBAL_TRACKER_KEY]: "Forest cottage",
      },
    },
  });
  const context = makeContext({ name2: "", characterId: -1, characters: [] });

  const prompt = __testables.buildPrompt(data, settings, context);
  assert.match(prompt, /- Scene: scene_location "Forest cottage"/);
});

test("buildPrompt excludes global custom stats when includeInInjection is disabled", () => {
  const settings = makeSettings({
    customStats: [
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "2026-03-07 20:00",
        dateTimeMode: "timestamp",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: true,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: false,
      },
    ],
  });
  const data = makeTracker({
    customNonNumericStatistics: {
      scene_date_time: {
        [GLOBAL_TRACKER_KEY]: "2026-03-07 20:05",
      },
    },
  });

  const prompt = __testables.buildPrompt(data, settings, makeContext());
  assert.equal(prompt, "");
});
