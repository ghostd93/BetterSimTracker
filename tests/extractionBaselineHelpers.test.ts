import test from "node:test";
import assert from "node:assert/strict";

import { USER_TRACKER_KEY } from "../src/constants";
import { selectLatestRelevantHistoryEntry } from "../src/extractionBaselineHelpers";
import type { TrackerData } from "../src/types";

function makeTracker(timestamp: number, clothes: string[]): TrackerData {
  return {
    timestamp,
    activeCharacters: [USER_TRACKER_KEY],
    statistics: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customStatistics: {},
    customNonNumericStatistics: {
      clothes: {
        [USER_TRACKER_KEY]: clothes,
      },
    },
  };
}

test("selectLatestRelevantHistoryEntry prefers later message chronology over newer edit timestamp", () => {
  const olderEditedMessage = {
    data: makeTracker(4000, []),
    messageIndex: 1,
    timestamp: 4000,
  };
  const laterNarrativeMessage = {
    data: makeTracker(3000, ["nude"]),
    messageIndex: 3,
    timestamp: 3000,
  };

  const selected = selectLatestRelevantHistoryEntry(
    [olderEditedMessage, laterNarrativeMessage],
    5,
    data => data.customNonNumericStatistics?.clothes?.[USER_TRACKER_KEY] !== undefined,
  );

  assert.ok(selected);
  assert.equal(selected?.messageIndex, 3);
  assert.deepEqual(selected?.data.customNonNumericStatistics?.clothes?.[USER_TRACKER_KEY], ["nude"]);
});

test("selectLatestRelevantHistoryEntry can restrict continuity source to user-message indexes", () => {
  const userContinuity = {
    data: makeTracker(3000, ["nude"]),
    messageIndex: 5,
    timestamp: 3000,
  };
  const laterAiCarryForward = {
    data: makeTracker(4000, ["t-shirt", "jeans"]),
    messageIndex: 6,
    timestamp: 4000,
  };

  const selected = selectLatestRelevantHistoryEntry(
    [userContinuity, laterAiCarryForward],
    7,
    data => data.customNonNumericStatistics?.clothes?.[USER_TRACKER_KEY] !== undefined,
    messageIndex => messageIndex === 5,
  );

  assert.ok(selected);
  assert.equal(selected?.messageIndex, 5);
  assert.deepEqual(selected?.data.customNonNumericStatistics?.clothes?.[USER_TRACKER_KEY], ["nude"]);
});
