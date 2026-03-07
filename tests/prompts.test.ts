import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSequentialCustomNumericPrompt,
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
