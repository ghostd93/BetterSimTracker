import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_TRACKER_KEY, USER_TRACKER_KEY } from "../src/constants";
import { __testables } from "../src/editStatsModal";
import type { TrackerData } from "../src/types";

function makeData(): TrackerData {
  return {
    timestamp: Date.now(),
    activeCharacters: [],
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

test("edit modal raw non-global lookup does not fall back to global owner value", () => {
  const data = makeData();
  data.customNonNumericStatistics = {
    clothes: {
      [GLOBAL_TRACKER_KEY]: ["black sundress", "white panties"],
      [USER_TRACKER_KEY]: ["t-shirt", "jeans"],
    },
  };
  const ownerKeys = __testables.uniqueOwnerKeys(USER_TRACKER_KEY, "User");
  const userValue = __testables.resolveEditNonNumericRawValue(data, "clothes", ownerKeys, false);
  assert.deepEqual(userValue, ["t-shirt", "jeans"]);

  const missingOwner = __testables.resolveEditNonNumericRawValue(
    data,
    "clothes",
    __testables.uniqueOwnerKeys("Some Other Owner", "Some Other Owner"),
    false,
  );
  assert.equal(missingOwner, undefined);
});

test("edit modal raw global lookup prefers global owner value", () => {
  const data = makeData();
  data.customNonNumericStatistics = {
    scene_date_time: {
      [GLOBAL_TRACKER_KEY]: "2026-03-04 20:30",
      [USER_TRACKER_KEY]: "2026-03-04 21:00",
    },
  };
  const value = __testables.resolveEditNonNumericRawValue(
    data,
    "scene_date_time",
    __testables.uniqueOwnerKeys(USER_TRACKER_KEY, "User"),
    true,
  );
  assert.equal(value, "2026-03-04 20:30");
});

