import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCustomDeltaResponse,
  parseCustomValueResponse,
  parseStatResponse,
  parseUnifiedDeltaResponse,
  parseUnifiedStatResponse,
  withDefaultsForMissingNumeric,
} from "../src/parse";

test("parseStatResponse parses numeric and mood/text maps", () => {
  assert.deepEqual(
    parseStatResponse("affection", "{\"Alice\": 52, \"Bob\": \"70\"}", ["Alice", "Bob"]),
    { Alice: 52, Bob: 70 },
  );
  assert.deepEqual(
    parseStatResponse("mood", "{\"Alice\": \"worried but hopeful\"}", ["Alice"]),
    { Alice: "Anxious" },
  );
  assert.deepEqual(
    parseStatResponse("lastThought", "{\"Alice\": \"  Keep moving.  \"}", ["Alice"]),
    { Alice: "Keep moving." },
  );
});

test("withDefaultsForMissingNumeric fills only missing characters", () => {
  assert.deepEqual(
    withDefaultsForMissingNumeric(
      "trust",
      { Alice: 80 },
      ["Alice", "Bob"],
      { affection: 50, trust: 40, desire: 50, connection: 50 },
    ),
    { Alice: 80, Bob: 40 },
  );
});

test("parseUnifiedStatResponse resolves aliases and enabled stats", () => {
  const raw = JSON.stringify({
    characters: [
      { name: "ally", affection: 55, mood: "relaxed" },
      { name: "Bob", trust: 62, lastThought: "Stay focused." },
    ],
  });
  const parsed = parseUnifiedStatResponse(
    raw,
    ["Alice", "Bob"],
    ["affection", "trust", "mood", "lastThought"],
    { ally: "Alice" },
  );
  assert.deepEqual(parsed.affection, { Alice: 55 });
  assert.deepEqual(parsed.trust, { Bob: 62 });
  assert.deepEqual(parsed.mood, { Alice: "Content" });
  assert.deepEqual(parsed.lastThought, { Bob: "Stay focused." });
});

test("parseUnifiedDeltaResponse clamps deltas and confidence", () => {
  const raw = JSON.stringify({
    characters: [
      {
        name: "Alice",
        confidence: 1.5,
        delta: { affection: 99, trust: -99 },
        mood: "glad",
        lastThought: "Stay here.",
      },
    ],
  });
  const parsed = parseUnifiedDeltaResponse(
    raw,
    ["Alice"],
    ["affection", "trust", "mood", "lastThought"],
    10,
  );
  assert.deepEqual(parsed.confidence, { Alice: 1 });
  assert.deepEqual(parsed.deltas.affection, { Alice: 10 });
  assert.deepEqual(parsed.deltas.trust, { Alice: -10 });
  assert.deepEqual(parsed.mood, { Alice: "Happy" });
  assert.deepEqual(parsed.lastThought, { Alice: "Stay here." });
});

test("parseCustomDeltaResponse resolves delta from nested or flat values", () => {
  const raw = JSON.stringify({
    characters: [
      { name: "Alice", confidence: 0.75, delta: { satisfaction: 4 } },
      { name: "Bob", confidence: 0.1, satisfaction: "-20" },
    ],
  });
  const parsed = parseCustomDeltaResponse(raw, ["Alice", "Bob"], "satisfaction", 7);
  assert.deepEqual(parsed.confidence, { Alice: 0.75, Bob: 0.1 });
  assert.deepEqual(parsed.delta, { Alice: 4, Bob: -7 });
});

test("parseCustomValueResponse handles enum, array, and date_time kinds", () => {
  const enumRaw = JSON.stringify({
    characters: [{ name: "Alice", confidence: 0.9, value: { stance: " medium " } }],
  });
  const enumParsed = parseCustomValueResponse(enumRaw, ["Alice"], "stance", "enum_single", {
    enumOptions: ["Low", "Medium", "High"],
  });
  assert.deepEqual(enumParsed.value, { Alice: "Medium" });

  const arrayRaw = JSON.stringify({
    characters: [{ name: "Alice", confidence: 0.8, value: { clothes: ["Hat", "Boots"] } }],
  });
  const arrayParsed = parseCustomValueResponse(arrayRaw, ["Alice"], "clothes", "array", {
    textMaxLength: 50,
  });
  assert.deepEqual(arrayParsed.value, { Alice: ["Hat", "Boots"] });

  const dtRaw = JSON.stringify({
    characters: [{ name: "Alice", confidence: 1, value: { scene_date_time: { value: "2026-03-06 21:30" } } }],
  });
  const dtParsed = parseCustomValueResponse(dtRaw, ["Alice"], "scene_date_time", "date_time");
  assert.deepEqual(dtParsed.value, { Alice: "2026-03-06 21:30" });
});
