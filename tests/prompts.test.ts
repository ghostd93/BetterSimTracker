import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBuiltInSequentialPromptGenerationPrompt,
  buildCustomStatBehaviorGuidanceGenerationPrompt,
  buildSequentialCustomNumericPrompt,
  buildSequentialCustomOverrideGenerationPrompt,
  buildSequentialCustomNonNumericPrompt,
  buildSequentialPrompt,
  buildTrackerSummaryGenerationPrompt,
  buildUnifiedAllStatsPrompt,
  buildUnifiedPrompt,
} from "../src/prompts";
import type { TrackerData } from "../src/types";

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

test("buildUnifiedPrompt includes current state, history, instruction, and protocol values", () => {
  const prompt = buildUnifiedPrompt(
    ["affection", "mood"],
    "User",
    ["Seraphina"],
    "Seraphina smiles.",
    {
      affection: { Seraphina: 61 },
      trust: {},
      desire: {},
      connection: {},
      mood: { Seraphina: "Hopeful" },
      lastThought: {},
    },
    [makeTracker(1, {
      statistics: {
        affection: { Seraphina: 58 },
        trust: {},
        desire: {},
        connection: {},
        mood: { Seraphina: "Content" },
        lastThought: {},
      },
    })],
    12,
  );

  assert.match(prompt, /<BST_CRUCIAL_BEHAVE_INSTRUCTION>/);
  assert.match(prompt, /<BST_ENVELOPE>/);
  assert.match(prompt, /<BST_CURRENT_STATE>/);
  assert.match(prompt, /<BST_RECENT_SNAPSHOTS>/);
  assert.match(prompt, /<BST_TASK>/);
  assert.match(prompt, /<BST_OUTPUT_PROTOCOL>/);
  assert.match(prompt, /affection=61/);
  assert.match(prompt, /mood=Hopeful/);
  assert.match(prompt, /Snapshot 1/);
  assert.match(prompt, /Use recent messages first/);
  assert.match(prompt, /Numeric stats to update \(affection\):/);
  assert.match(prompt, /Text stats to update \(mood\):/);
  assert.match(prompt, /-12\.\.12/);
});

test("buildUnifiedAllStatsPrompt includes custom numeric and non-numeric values", () => {
  const prompt = buildUnifiedAllStatsPrompt({
    stats: ["affection", "mood"],
    customStats: [
      {
        id: "satisfaction",
        kind: "numeric",
        label: "Satisfaction",
        defaultValue: 50,
        track: true,
        trackCharacters: true,
        trackUser: false,
        globalScope: false,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: true,
        includeInInjection: true,
      },
      {
        id: "clothes",
        kind: "array",
        label: "Clothes",
        defaultValue: [],
        textMaxLength: 80,
        track: true,
        trackCharacters: true,
        trackUser: false,
        globalScope: false,
        privateToOwner: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
    userName: "User",
    characters: ["Seraphina"],
    contextText: "Scene text",
    current: {
      affection: { Seraphina: 65 },
      trust: {},
      desire: {},
      connection: {},
      mood: { Seraphina: "Hopeful" },
      lastThought: {},
    },
    currentCustom: {
      satisfaction: { Seraphina: 72 },
    },
    currentCustomNonNumeric: {
      clothes: { Seraphina: ["black sundress", "sandals"] },
    },
    history: [],
    maxDeltaPerTurn: 8,
    includeCharacterCardsInPrompt: true,
    includeLorebookInExtraction: false,
  });

  assert.match(prompt, /satisfaction=72/);
  assert.match(prompt, /clothes=\["black sundress","sandals"\]/);
  assert.match(prompt, /<BST_CRUCIAL_BEHAVE_INSTRUCTION>/);
  assert.match(prompt, /<BST_OUTPUT_PROTOCOL>/);
  assert.match(prompt, /For custom numeric stats, use `delta\.<statId>`\./);
  assert.match(prompt, /For custom non-numeric stats, use `value\.<statId>`\./);
  assert.match(prompt, /Custom non-numeric stats to update \(clothes\):/);
});

test("buildUnifiedAllStatsPrompt does not leak global fallback into owner-scoped custom stats", () => {
  const prompt = buildUnifiedAllStatsPrompt({
    stats: [],
    customStats: [
      {
        id: "clothes",
        kind: "array",
        label: "Clothes",
        defaultValue: [],
        textMaxLength: 80,
        track: true,
        trackCharacters: true,
        trackUser: false,
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
    userName: "User",
    characters: ["Seraphina"],
    contextText: "Scene text",
    current: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    currentCustom: {},
    currentCustomNonNumeric: {
      clothes: { "__bst_global__": ["global robe"] },
      scene_date_time: { "__bst_global__": "2026-03-06 20:05" },
    },
    history: [],
    maxDeltaPerTurn: 8,
    includeCharacterCardsInPrompt: true,
    includeLorebookInExtraction: false,
  });

  assert.doesNotMatch(prompt, /clothes=\["global robe"\]/);
  assert.match(prompt, /scene_date_time="2026-03-06 20:05"/);
});

test("buildSequentialPrompt respects built-in tracking and source priority wording", () => {
  const prompt = buildSequentialPrompt(
    "trust",
    "User",
    ["Seraphina"],
    "Recent lines",
    {
      affection: { Seraphina: 55 },
      trust: { Seraphina: 42 },
      desire: {},
      connection: {},
      mood: { Seraphina: "Neutral" },
      lastThought: {},
    },
    [],
    7,
    undefined,
    undefined,
    undefined,
    false,
    true,
    {
      trackAffection: false,
      trackTrust: true,
      trackDesire: false,
      trackConnection: false,
      trackMood: false,
    },
  );

  assert.doesNotMatch(prompt, /affection=55/);
  assert.match(prompt, /<BST_CRUCIAL_BEHAVE_INSTRUCTION>/);
  assert.match(prompt, /<BST_OUTPUT_PROTOCOL>/);
  assert.match(prompt, /trust=42/);
  assert.match(prompt, /Use recent messages first; use lorebook only to disambiguate when context is unclear\./);
});

test("buildSequentialCustomNumericPrompt includes BST tagged extraction sections", () => {
  const prompt = buildSequentialCustomNumericPrompt({
    statId: "satisfaction",
    statLabel: "Satisfaction",
    statDescription: "General satisfaction.",
    statDefault: 50,
    maxDeltaPerTurn: 9,
    userName: "User",
    characters: ["Seraphina"],
    contextText: "Recent lines",
    current: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    currentCustom: {
      satisfaction: { Seraphina: 64 },
    },
    history: [],
    includeCharacterCardsInPrompt: true,
    includeLorebookInExtraction: true,
  });

  assert.match(prompt, /<BST_CRUCIAL_BEHAVE_INSTRUCTION>/);
  assert.match(prompt, /<BST_ENVELOPE>/);
  assert.match(prompt, /<BST_CURRENT_STATE>/);
  assert.match(prompt, /<BST_RECENT_SNAPSHOTS>/);
  assert.match(prompt, /<BST_TASK>/);
  assert.match(prompt, /<BST_OUTPUT_PROTOCOL>/);
  assert.match(prompt, /satisfaction=64/);
});

test("buildSequentialCustomNonNumericPrompt includes scoped values and mode-aware schema", () => {
  const prompt = buildSequentialCustomNonNumericPrompt({
    statId: "scene_date_time",
    statKind: "date_time",
    globalScope: true,
    statLabel: "Scene Date/Time",
    statDescription: "Tracks current scene time.",
    statDefault: "2026-03-06 20:00",
    dateTimeMode: "structured",
    userName: "User",
    characters: ["Seraphina"],
    contextText: "The evening continues.",
    current: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    currentCustomNonNumeric: {
      scene_date_time: { "__bst_global__": "2026-03-06 20:05" },
    },
    history: [],
    includeCharacterCardsInPrompt: true,
    includeLorebookInExtraction: true,
  });

  assert.match(prompt, /scene_date_time="2026-03-06 20:05"/);
  assert.match(prompt, /<BST_CRUCIAL_BEHAVE_INSTRUCTION>/);
  assert.match(prompt, /<BST_OUTPUT_PROTOCOL>/);
  assert.match(prompt, /structured datetime intent/);
  assert.match(prompt, /use character cards and lorebook only to disambiguate when context is unclear\./);
});

test("buildTrackerSummaryGenerationPrompt keeps tracked-dimension scope explicit", () => {
  const prompt = buildTrackerSummaryGenerationPrompt({
    userName: "User",
    activeCharacters: ["Seraphina"],
    characters: ["Seraphina", "Billie"],
    contextText: "Recent dialogue",
    trackerStateLines: "- Seraphina: hopeful, protective",
    trackedDimensions: ["mood", "connection", "clothes"],
  });

  assert.match(prompt, /Tracked dimensions \(only these\):/);
  assert.match(prompt, /mood, connection, clothes/);
  assert.match(prompt, /Do not use numerals or percentages\./);
});

test("buildSequentialCustomOverrideGenerationPrompt emphasizes continuity and disambiguation-only card usage", () => {
  const prompt = buildSequentialCustomOverrideGenerationPrompt({
    statId: "clothes",
    statLabel: "Clothes",
    statDescription: "Track currently worn clothing/accessory items as a live list.",
    statKind: "array",
    textMaxLength: 120,
  });

  assert.match(prompt, /Treat the previous Clothes tracker value as the current known state for continuity\./);
  assert.match(prompt, /Change clothes only when recent messages provide clear evidence of change; otherwise preserve the previous value\./);
  assert.match(prompt, /Use recent messages as the primary source of change and previous tracker state as the primary source of continuity\./);
  assert.match(prompt, /Use character cards, defaults, and lorebook only when clothes is empty, unknown, or genuinely unclear from the recent scene\./);
  assert.match(prompt, /Never overwrite a known current Clothes value only because background\/card text mentions a different baseline state\./);
});

test("buildBuiltInSequentialPromptGenerationPrompt reinforces continuity for built-ins", () => {
  const prompt = buildBuiltInSequentialPromptGenerationPrompt({
    stat: "trust",
    currentInstruction: "",
  });

  assert.match(prompt, /Prioritize recent messages for changes and previous tracker state for continuity; use character cards only for disambiguation\./);
  assert.match(prompt, /Require preserving the current Trust state unless recent messages clearly justify movement\./);
});

test("buildCustomStatBehaviorGuidanceGenerationPrompt asks for continuity-aware guidance", () => {
  const prompt = buildCustomStatBehaviorGuidanceGenerationPrompt({
    statId: "pose",
    statLabel: "Pose",
    statDescription: "Current posture, immediate action, and local position.",
    statKind: "text_short",
    textMaxLength: 120,
  });

  assert.match(prompt, /Keep the guidance anchored to the current Pose state instead of generic label synonyms\./);
  assert.match(prompt, /describe how the model should remain consistent with an already-established pose value across nearby turns/i);
});
