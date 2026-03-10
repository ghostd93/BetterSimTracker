import test from "node:test";
import assert from "node:assert/strict";

import { buildStatSeries, hasNumericSnapshot, type GraphNumericStatDefinition } from "../src/graphTimeline";
import { GLOBAL_TRACKER_KEY, USER_TRACKER_KEY } from "../src/constants";
import type { TrackerData } from "../src/types";

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

test("hasNumericSnapshot detects built-in and global custom numeric entries", () => {
  const entry = makeTracker(1);
  entry.statistics.affection.Seraphina = 42;
  entry.customStatistics = {
    scene_score: {
      [GLOBAL_TRACKER_KEY]: 55,
    },
  };
  const defs: GraphNumericStatDefinition[] = [
    { key: "affection", defaultValue: 50, globalScope: false },
    { key: "scene_score", defaultValue: 50, globalScope: true },
  ];

  assert.equal(hasNumericSnapshot(entry, "Seraphina", defs), true);
  assert.equal(hasNumericSnapshot(entry, USER_TRACKER_KEY, [{ key: "scene_score", defaultValue: 50, globalScope: false }]), false);
  assert.equal(hasNumericSnapshot(entry, USER_TRACKER_KEY, [{ key: "missing_stat", defaultValue: 50, globalScope: false }]), false);
});

test("buildStatSeries carries previous value and clamps range", () => {
  const t1 = makeTracker(1);
  const t2 = makeTracker(2);
  const t3 = makeTracker(3);
  const t4 = makeTracker(4);
  const def: GraphNumericStatDefinition = {
    key: "trust",
    defaultValue: 50,
    globalScope: false,
  };

  t2.statistics.trust.Seraphina = 65;
  t4.statistics.trust.Seraphina = 150;

  const series = buildStatSeries([t1, t2, t3, t4], "Seraphina", def);
  assert.deepEqual(series, [50, 65, 65, 100]);
});
