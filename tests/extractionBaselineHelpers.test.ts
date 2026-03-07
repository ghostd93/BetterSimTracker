import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_TRACKER_KEY } from "../src/constants";
import {
  hasCharacterOwnedTrackedValueForCharacter,
  overlayLatestGlobalCustomStats,
} from "../src/extractionBaselineHelpers";
import { sanitizeSettings } from "../src/settings";
import type { TrackerData } from "../src/types";

function makeData(): TrackerData {
  return {
    timestamp: Date.now(),
    activeCharacters: ["Lilly"],
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

test("hasCharacterOwnedTrackedValueForCharacter ignores global-only custom values", () => {
  const settings = sanitizeSettings({
    customStats: [
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: true,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
  });
  const data = makeData();
  data.customNonNumericStatistics = {
    scene_date_time: {
      [GLOBAL_TRACKER_KEY]: "2026-03-05 09:00",
    },
  };
  assert.equal(hasCharacterOwnedTrackedValueForCharacter(data, "Lilly", settings), false);
});

test("hasCharacterOwnedTrackedValueForCharacter detects built-in and non-global custom owner values", () => {
  const settings = sanitizeSettings({
    customStats: [
      {
        id: "pose",
        kind: "text_short",
        label: "Pose",
        defaultValue: "",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
  });
  const data = makeData();
  data.statistics.affection.Lilly = 4;
  assert.equal(hasCharacterOwnedTrackedValueForCharacter(data, "Lilly", settings), true);

  const data2 = makeData();
  data2.customNonNumericStatistics = {
    pose: {
      Lilly: "Standing near the sink",
    },
  };
  assert.equal(hasCharacterOwnedTrackedValueForCharacter(data2, "Lilly", settings), true);
});

test("overlayLatestGlobalCustomStats overlays latest global values and preserves character-owned values", () => {
  const settings = sanitizeSettings({
    customStats: [
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: true,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
      {
        id: "pose",
        kind: "text_short",
        label: "Pose",
        defaultValue: "",
        track: true,
        trackCharacters: true,
        trackUser: true,
        globalScope: false,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
  });

  const base = makeData();
  base.customNonNumericStatistics = {
    scene_date_time: {
      [GLOBAL_TRACKER_KEY]: "2026-03-05 08:45",
    },
    pose: {
      Lilly: "Walking to bedroom",
    },
  };

  const latest = makeData();
  latest.customNonNumericStatistics = {
    scene_date_time: {
      [GLOBAL_TRACKER_KEY]: "2026-03-05 09:00",
    },
    pose: {
      Lilly: "User-side pose should not overwrite character baseline",
    },
  };

  const merged = overlayLatestGlobalCustomStats(base, latest, settings);
  assert.equal(merged.customNonNumericStatistics?.scene_date_time?.[GLOBAL_TRACKER_KEY], "2026-03-05 09:00");
  assert.equal(merged.customNonNumericStatistics?.pose?.Lilly, "Walking to bedroom");
});

