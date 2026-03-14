import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_TRACKER_KEY, USER_TRACKER_KEY } from "../src/constants";
import { getNumericRawValue, resolveNonNumericValue } from "../src/ui";
import type { TrackerData } from "../src/types";

type TestNonNumericDef = {
  id: string;
  label: string;
  kind: "array" | "date_time";
  track: boolean;
  trackCharacters: boolean;
  trackUser: boolean;
  globalScope: boolean;
  showOnCard: boolean;
  showInGraph: boolean;
  includeInInjection: boolean;
  enumOptions: string[];
  booleanTrueLabel: string;
  booleanFalseLabel: string;
  textMaxLength: number;
  dateTimeMode: "timestamp";
  defaultValue: string | string[];
};

function makeTracker(): TrackerData {
  return {
    timestamp: 1,
    activeCharacters: ["Seraphina", USER_TRACKER_KEY],
    statistics: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customStatistics: {
      shared_score: {
        [GLOBAL_TRACKER_KEY]: 88,
      },
      owner_score: {
        [GLOBAL_TRACKER_KEY]: 66,
        Seraphina: 42,
      },
    },
    customNonNumericStatistics: {
      scene_date_time: {
        [GLOBAL_TRACKER_KEY]: "2026-03-10 12:00",
      },
      clothes: {
        [GLOBAL_TRACKER_KEY]: ["global robe"],
        [USER_TRACKER_KEY]: ["t-shirt", "jeans"],
      },
    },
  };
}

test("owner-scoped numeric UI lookup does not fall back to global value", () => {
  const data = makeTracker();
  assert.equal(getNumericRawValue(data, "owner_score", USER_TRACKER_KEY, false), undefined);
  assert.equal(getNumericRawValue(data, "owner_score", "Seraphina", false), 42);
  assert.equal(getNumericRawValue(data, "shared_score", USER_TRACKER_KEY, true), 88);
});

test("owner-scoped numeric UI lookup respects explicit clears", () => {
  const data = makeTracker();
  data.clearedCustomStatistics = {
    owner_score: {
      Seraphina: true,
    },
  };
  assert.equal(getNumericRawValue(data, "owner_score", "Seraphina", false), undefined);
});

test("owner-scoped non-numeric UI lookup does not fall back to global value", () => {
  const data = makeTracker();
  const ownerDef: TestNonNumericDef = {
    id: "clothes",
    label: "Clothes",
    kind: "array" as const,
    track: true,
    trackCharacters: true,
    trackUser: true,
    globalScope: false,
    showOnCard: true,
    showInGraph: false,
    includeInInjection: true,
    enumOptions: [] as string[],
    booleanTrueLabel: "On",
    booleanFalseLabel: "Off",
    textMaxLength: 100,
    dateTimeMode: "timestamp" as const,
    defaultValue: [],
  };
  const globalDef: TestNonNumericDef = {
    ...ownerDef,
    id: "scene_date_time",
    label: "Scene Date/Time",
    kind: "date_time" as const,
    globalScope: true,
    defaultValue: "",
  };
  assert.deepEqual(resolveNonNumericValue(data, ownerDef as never, USER_TRACKER_KEY), ["t-shirt", "jeans"]);
  assert.deepEqual(resolveNonNumericValue(data, ownerDef as never, "Seraphina"), []);
  assert.equal(resolveNonNumericValue(data, globalDef as never, USER_TRACKER_KEY), "2026-03-10 12:00");
});
