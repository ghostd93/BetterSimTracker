import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_TRACKER_KEY } from "../src/constants";
import {
  behaviorGuidanceLines,
  customStatTracksAnyScope,
  customStatTracksScope,
  renderNonNumericValue,
  resolveScopedCustomNonNumericValue,
  resolveScopedCustomNumericValue,
} from "../src/promptInjectionHelpers";
import type { TrackerData } from "../src/types";

function makeData(): TrackerData {
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
  };
}

test("renderNonNumericValue formats booleans, arrays, and strings", () => {
  assert.equal(renderNonNumericValue(true), "true");
  assert.equal(renderNonNumericValue("  hello   world "), "\"hello world\"");
  assert.equal(renderNonNumericValue([" A ", "a", "B"]), "[\"A\", \"B\"]");
  assert.equal(renderNonNumericValue([]), null);
});

test("renderNonNumericValue truncates long text safely with ellipsis", () => {
  const long = "Curvy chubby build with voluptuous figure thick soft thighs humongous wide hips huge breasts soft rounded face with purple eyes and vibrant red hair";
  const rendered = renderNonNumericValue(long);
  assert.ok(rendered && rendered.startsWith("\"") && rendered.endsWith("\""));
  assert.match(String(rendered), /…\"$/);
  assert.doesNotMatch(String(rendered), /with \"$/);
});

test("behaviorGuidanceLines normalizes bullets and keeps bounded count", () => {
  const lines = behaviorGuidanceLines("- first\n* second\n \nthird");
  assert.deepEqual(lines, ["- first", "- second", "- third"]);
  assert.equal(behaviorGuidanceLines(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")).length, 8);
});

test("customStatTracksScope resolves track flags per owner scope", () => {
  assert.equal(customStatTracksScope({ track: true }, "character"), true);
  assert.equal(customStatTracksScope({ track: true, trackCharacters: false }, "character"), false);
  assert.equal(customStatTracksScope({ track: false, trackUser: true }, "user"), true);
  assert.equal(customStatTracksAnyScope({ track: false, trackUser: false, trackCharacters: false }), false);
});

test("resolveScopedCustomNumericValue uses owner/global/legacy fallbacks correctly", () => {
  const data = makeData();
  data.customStatistics = {
    score: {
      Seraphina: 71,
      [GLOBAL_TRACKER_KEY]: 55,
      LegacyChar: 44,
    },
  };
  assert.equal(resolveScopedCustomNumericValue(data, "score", "Seraphina", false), 71);
  assert.equal(resolveScopedCustomNumericValue(data, "score", "Unknown", false), 55);
  assert.equal(resolveScopedCustomNumericValue(data, "score", "Unknown", true), 55);

  delete data.customStatistics.score[GLOBAL_TRACKER_KEY];
  assert.equal(resolveScopedCustomNumericValue(data, "score", "Unknown", true), 71);
});

test("resolveScopedCustomNonNumericValue uses owner/global/legacy fallbacks correctly", () => {
  const data = makeData();
  data.customNonNumericStatistics = {
    clothes: {
      Seraphina: ["black sundress"],
      [GLOBAL_TRACKER_KEY]: ["global outfit"],
      LegacyChar: ["legacy outfit"],
    },
  };
  assert.deepEqual(resolveScopedCustomNonNumericValue(data, "clothes", "Seraphina", false), ["black sundress"]);
  assert.deepEqual(resolveScopedCustomNonNumericValue(data, "clothes", "Unknown", false), ["global outfit"]);
  assert.deepEqual(resolveScopedCustomNonNumericValue(data, "clothes", "Unknown", true), ["global outfit"]);

  delete data.customNonNumericStatistics.clothes[GLOBAL_TRACKER_KEY];
  assert.deepEqual(resolveScopedCustomNonNumericValue(data, "clothes", "Unknown", true), ["black sundress"]);
});
