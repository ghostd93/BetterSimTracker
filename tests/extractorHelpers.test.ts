import test from "node:test";
import assert from "node:assert/strict";

import { defaultSettings } from "../src/settings";
import {
  applyConfidenceScaledDelta,
  enabledBuiltInAndTextStats,
  enabledCustomStats,
  groupCustomStatsForSequential,
  isManualExtractionReason,
  normalizeSequentialGroupId,
  resolveMoodWithConfidence,
  shouldBypassConfidenceControls,
} from "../src/extractorHelpers";
import type { BetterSimTrackerSettings, CustomStatDefinition } from "../src/types";

function makeSettings(overrides: Partial<BetterSimTrackerSettings> = {}): BetterSimTrackerSettings {
  return { ...defaultSettings, ...overrides };
}

function textStat(id: string, group = ""): CustomStatDefinition {
  return {
    id,
    label: id,
    kind: "text_short",
    defaultValue: "",
    track: true,
    includeInInjection: true,
    showOnCard: true,
    showInGraph: false,
    textMaxLength: 120,
    sequentialGroup: group,
  };
}

test("normalizeSequentialGroupId sanitizes, lowers and clamps group id", () => {
  assert.equal(normalizeSequentialGroupId("  Clothes + Pose  "), "clothes_pose");
  assert.equal(normalizeSequentialGroupId(""), "");
  assert.equal(normalizeSequentialGroupId("A".repeat(80)).length, 32);
});

test("enabledBuiltInAndTextStats returns enabled built-ins only", () => {
  const settings = makeSettings({
    trackAffection: true,
    trackTrust: false,
    trackDesire: true,
    trackConnection: false,
    trackMood: true,
    trackLastThought: false,
  });
  assert.deepEqual(enabledBuiltInAndTextStats(settings), ["affection", "desire", "mood"]);
});

test("enabledCustomStats returns tracked-only custom definitions", () => {
  const settings = makeSettings({
    customStats: [
      textStat("a"),
      { ...textStat("b"), track: false },
      textStat("c"),
    ],
  });
  assert.deepEqual(
    enabledCustomStats(settings).map(stat => stat.id),
    ["a", "c"],
  );
});

test("groupCustomStatsForSequential groups by sanitized group id when enabled", () => {
  const stats = [
    textStat("clothes", "appearance"),
    textStat("pose", " Appearance "),
    textStat("vitals", ""),
    textStat("goal", "goal@group"),
  ];
  const groups = groupCustomStatsForSequential(stats, true);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].map(stat => stat.id), ["clothes", "pose"]);
  assert.deepEqual(groups[1].map(stat => stat.id), ["goal"]);
  assert.deepEqual(groups[2].map(stat => stat.id), ["vitals"]);
});

test("groupCustomStatsForSequential keeps one-stat groups when disabled", () => {
  const stats = [textStat("clothes", "appearance"), textStat("pose", "appearance")];
  const groups = groupCustomStatsForSequential(stats, false);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map(stat => stat.id), ["clothes"]);
  assert.deepEqual(groups[1].map(stat => stat.id), ["pose"]);
});

test("isManualExtractionReason only allows manual refresh flows", () => {
  assert.equal(isManualExtractionReason("manual_refresh"), true);
  assert.equal(isManualExtractionReason("manual_refresh_retry"), true);
  assert.equal(isManualExtractionReason("GENERATION_ENDED"), false);
  assert.equal(isManualExtractionReason("USER_MESSAGE_RENDERED"), false);
});

test("shouldBypassConfidenceControls covers retrack and edited-message flows", () => {
  assert.equal(shouldBypassConfidenceControls("manual_refresh"), true);
  assert.equal(shouldBypassConfidenceControls("manual_refresh_retry"), true);
  assert.equal(shouldBypassConfidenceControls("USER_MESSAGE_EDITED"), true);
  assert.equal(shouldBypassConfidenceControls("MESSAGE_EDITED"), true);
  assert.equal(shouldBypassConfidenceControls("GENERATION_ENDED"), false);
});

test("applyConfidenceScaledDelta uses confidence scaling by default", () => {
  const next = applyConfidenceScaledDelta({
    previousValue: 50,
    delta: 10,
    confidence: 0.2,
    confidenceDampening: 1,
    maxDeltaPerTurn: 15,
  });
  assert.equal(next, 52);
});

test("applyConfidenceScaledDelta bypasses confidence scaling when requested", () => {
  const next = applyConfidenceScaledDelta({
    previousValue: 50,
    delta: 10,
    confidence: 0.2,
    confidenceDampening: 1,
    maxDeltaPerTurn: 15,
    bypassConfidenceControls: true,
  });
  assert.equal(next, 60);
});

test("resolveMoodWithConfidence keeps previous mood only when confidence controls are active", () => {
  assert.equal(
    resolveMoodWithConfidence({
      previousMood: "Neutral",
      nextMood: "Excited",
      confidence: 0.2,
      moodStickiness: 0.5,
    }),
    "Neutral",
  );
  assert.equal(
    resolveMoodWithConfidence({
      previousMood: "Neutral",
      nextMood: "Excited",
      confidence: 0.2,
      moodStickiness: 0.5,
      bypassConfidenceControls: true,
    }),
    "Excited",
  );
});
