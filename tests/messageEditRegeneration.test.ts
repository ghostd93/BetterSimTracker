import test from "node:test";
import assert from "node:assert/strict";

import type { ChatMessage } from "../src/types";
import { getTrackerDataFromMessage } from "../src/storage";

test("manual tracker edit marker persists on stored tracker payload", () => {
  const message: ChatMessage = {
    name: "Kuba",
    is_user: true,
    mes: "hello",
    extra: {
      bettersimtracker: {
        timestamp: 123,
        manualEditTimestamp: 456,
        activeCharacters: ["__bst_user__"],
        statistics: {
          affection: {},
          trust: {},
          desire: {},
          connection: {},
          mood: { "__bst_user__": "Neutral" },
          lastThought: {},
        },
      },
    },
  };

  const tracker = getTrackerDataFromMessage(message);
  assert.ok(tracker);
  assert.equal(tracker.manualEditTimestamp, 456);
});
