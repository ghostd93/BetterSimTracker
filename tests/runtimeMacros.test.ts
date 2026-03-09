import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { USER_TRACKER_KEY } from "../src/constants";
import { defaultSettings } from "../src/settings";
import { resetBstMacroStateForTests, syncBstMacros } from "../src/runtimeMacros";
import type { BetterSimTrackerSettings, STContext, TrackerData } from "../src/types";

function makeContext() {
  const registered = new Map<string, () => string>();
  const registeredNewEngine = new Map<string, () => string>();
  const unregistered: string[] = [];
  const context: STContext = {
    chat: [],
    characterId: 0,
    name1: "User",
    characters: [{ name: "Seraphina" }],
    registerMacro(name, value) {
      if (typeof value === "function") {
        registered.set(name, value);
      }
    },
    unregisterMacro(name) {
      unregistered.push(name);
      registered.delete(name);
    },
    macros: {
      register(name, definition) {
        const handler = typeof definition?.handler === "function"
          ? (definition.handler as () => string)
          : null;
        if (handler) {
          registeredNewEngine.set(name, handler);
        }
      },
      registry: {
        unregisterMacro(name) {
          registeredNewEngine.delete(name);
        },
      },
    },
  };
  return { context, registered, registeredNewEngine, unregistered };
}

function makeSettings(): BetterSimTrackerSettings {
  return {
    ...defaultSettings,
    trackAffection: true,
    trackTrust: true,
    trackDesire: true,
    trackConnection: true,
    trackMood: true,
    trackLastThought: true,
    enableUserTracking: true,
    userTrackMood: true,
    userTrackLastThought: true,
    customStats: [
      {
        id: "clothes",
        kind: "array",
        label: "Clothes",
        defaultValue: [],
        textMaxLength: 80,
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: false,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "2026-03-06 20:00",
        dateTimeMode: "structured",
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
  };
}

function makeTracker(): TrackerData {
  return {
    timestamp: 1,
    activeCharacters: ["Seraphina"],
    statistics: {
      affection: { Seraphina: 61 },
      trust: { Seraphina: 44 },
      desire: { Seraphina: 10 },
      connection: { Seraphina: 72 },
      mood: { Seraphina: "Hopeful", [USER_TRACKER_KEY]: "Neutral" },
      lastThought: { Seraphina: "Stay calm.", [USER_TRACKER_KEY]: "Need to rest." },
    },
    customStatistics: {},
    customNonNumericStatistics: {
      clothes: {
        Seraphina: ["black sundress", "sandals"],
        [USER_TRACKER_KEY]: ["hoodie"],
      },
      scene_date_time: {
        __bst_global__: "2026-03-06 20:05",
      },
    },
  };
}

afterEach(() => {
  resetBstMacroStateForTests();
});

test("syncBstMacros registers injection, user, scene, and character macros with resolved values", () => {
  const { context, registered, registeredNewEngine } = makeContext();
  syncBstMacros({
    context,
    settings: makeSettings(),
    allCharacterNames: ["Seraphina", USER_TRACKER_KEY],
    getLatestPromptMacroData: () => makeTracker(),
    getLastInjectedPrompt: () => "<bst_inject_block>demo</bst_inject_block>",
  });

  assert.equal(registered.get("bst_injection")?.(), "<bst_inject_block>demo</bst_inject_block>");
  assert.equal(registered.get("bst_stat_char_affection_seraphina")?.(), "61");
  assert.equal(registered.get("bst_stat_char_mood_seraphina")?.(), "Hopeful");
  assert.equal(registered.get("bst_stat_user_mood")?.(), "Neutral");
  assert.equal(registered.get("bst_stat_user_clothes")?.(), "hoodie");
  assert.equal(registered.get("bst_stat_scene_scene_date_time")?.(), "2026-03-06 20:05");
  assert.equal(registered.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
  assert.equal(registeredNewEngine.get("bst_stat_user_clothes")?.(), "hoodie");
  assert.equal(registeredNewEngine.get("bst_stat_scene_scene_date_time")?.(), "2026-03-06 20:05");
  assert.equal(registeredNewEngine.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
});

test("syncBstMacros unregisters previous macros when signature changes and skips re-registering identical signatures", () => {
  const { context, registered, unregistered } = makeContext();
  const settings = makeSettings();
  const tracker = makeTracker();

  syncBstMacros({
    context,
    settings,
    allCharacterNames: ["Seraphina"],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "first",
  });
  const countAfterFirst = registered.size;

  syncBstMacros({
    context,
    settings,
    allCharacterNames: ["Seraphina"],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "second",
  });
  assert.equal(registered.size, countAfterFirst);
  assert.deepEqual(unregistered, []);
  assert.equal(registered.get("bst_injection")?.(), "first");

  const changedSettings = {
    ...settings,
    customStats: settings.customStats.filter(stat => stat.id !== "clothes"),
  };
  syncBstMacros({
    context,
    settings: changedSettings,
    allCharacterNames: ["Seraphina"],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "third",
  });
  assert.ok(unregistered.length > 0);
  assert.equal(registered.get("bst_injection")?.(), "third");
  assert.equal(registered.has("bst_stat_user_clothes"), false);
});

test("syncBstMacros creates collision-safe character macros for duplicate names", () => {
  const { context, registered } = makeContext();
  context.characters = [
    { name: "Chloe", avatar: "chloe_a.png" } as any,
    { name: "Chloe", avatar: "chloe_b.png" } as any,
  ];
  const settings = makeSettings();
  const tracker = makeTracker();
  tracker.statistics.affection = { Chloe: 42 };
  tracker.activeCharacters = ["Chloe"];

  syncBstMacros({
    context,
    settings,
    allCharacterNames: ["Chloe"],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "demo",
  });

  assert.equal(registered.has("bst_stat_char_affection_chloe_a"), true);
  assert.equal(registered.has("bst_stat_char_affection_chloe_b"), true);
  assert.equal(registered.get("bst_stat_char_affection_chloe_a")?.(), "42");
  assert.equal(registered.get("bst_stat_char_affection_chloe_b")?.(), "42");
  assert.equal(registered.has("bst_stat_char_affection_chloe"), false);
});

test("syncBstMacros stat getters read fresh tracker data even when registration signature is unchanged", () => {
  const { context, registered, registeredNewEngine } = makeContext();
  const settings = makeSettings();
  let tracker: TrackerData | null = null;

  syncBstMacros({
    context,
    settings,
    allCharacterNames: ["Seraphina", USER_TRACKER_KEY],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "",
  });

  assert.equal(registered.get("bst_stat_user_clothes")?.(), "");
  assert.equal(registeredNewEngine.get("bst_stat_user_clothes")?.(), "");

  tracker = makeTracker();

  syncBstMacros({
    context,
    settings,
    allCharacterNames: ["Seraphina", USER_TRACKER_KEY],
    getLatestPromptMacroData: () => tracker,
    getLastInjectedPrompt: () => "",
  });

  assert.equal(registered.get("bst_stat_user_clothes")?.(), "hoodie");
  assert.equal(registered.get("bst_stat_scene_scene_date_time")?.(), "2026-03-06 20:05");
  assert.equal(registered.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
  assert.equal(registeredNewEngine.get("bst_stat_user_clothes")?.(), "hoodie");
  assert.equal(registeredNewEngine.get("bst_stat_scene_scene_date_time")?.(), "2026-03-06 20:05");
  assert.equal(registeredNewEngine.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
});

test("syncBstMacros registers macros in the new ST macro engine even when legacy registerMacro exists", () => {
  const { context, registeredNewEngine } = makeContext();

  syncBstMacros({
    context,
    settings: makeSettings(),
    allCharacterNames: ["Seraphina", USER_TRACKER_KEY],
    getLatestPromptMacroData: () => makeTracker(),
    getLastInjectedPrompt: () => "<bst_inject_block>demo</bst_inject_block>",
  });

  assert.equal(registeredNewEngine.get("bst_injection")?.(), "<bst_inject_block>demo</bst_inject_block>");
  assert.equal(registeredNewEngine.get("bst_stat_user_clothes")?.(), "hoodie");
  assert.equal(registeredNewEngine.get("bst_stat_scene_scene_date_time")?.(), "2026-03-06 20:05");
  assert.equal(registeredNewEngine.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
});

test("syncBstMacros exposes a legacy name-slug alias for unique characters when avatar slug differs", () => {
  const { context, registered, registeredNewEngine } = makeContext();
  context.characters = [
    { name: "Seraphina", avatar: "cards/sera_alt.png" } as any,
  ];

  syncBstMacros({
    context,
    settings: makeSettings(),
    allCharacterNames: ["Seraphina", USER_TRACKER_KEY],
    getLatestPromptMacroData: () => makeTracker(),
    getLastInjectedPrompt: () => "",
  });

  assert.equal(registered.get("bst_stat_char_clothes_sera_alt")?.(), "black sundress, sandals");
  assert.equal(registered.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
  assert.equal(registeredNewEngine.get("bst_stat_char_clothes_sera_alt")?.(), "black sundress, sandals");
  assert.equal(registeredNewEngine.get("bst_stat_char_clothes_seraphina")?.(), "black sundress, sandals");
});
