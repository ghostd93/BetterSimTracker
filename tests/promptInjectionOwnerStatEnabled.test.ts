import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../src/promptInjection";
import { USER_TRACKER_KEY } from "../src/constants";
import type { BetterSimTrackerSettings, STContext } from "../src/types";
import { defaultSettings } from "../src/settings";

const isOwnerStatEnabled = __testables.isOwnerStatEnabled;

function baseSettings(): BetterSimTrackerSettings {
  return {
    ...defaultSettings,
    characterDefaults: {},
  };
}

test("isOwnerStatEnabled reads character statEnabled map", () => {
  const settings = baseSettings();
  settings.characterDefaults = {
    "avatar:sera.png": {
      statEnabled: {
        affection: false,
      },
    },
  };
  const context = {
    characters: [{ name: "Seraphina", avatar: "sera.png" }],
  } as unknown as STContext;

  assert.equal(isOwnerStatEnabled(context, settings, "Seraphina", "affection"), false);
  assert.equal(isOwnerStatEnabled(context, settings, "Seraphina", "trust"), true);
});

test("isOwnerStatEnabled reads persona-scoped user statEnabled map", () => {
  const settings = baseSettings();
  settings.characterDefaults = {
    "avatar:persona:p1.png": {
      statEnabled: {
        mood: false,
      },
    },
  };
  const context = {
    name1: "User",
    user_avatar: "p1.png",
  } as unknown as STContext;

  assert.equal(isOwnerStatEnabled(context, settings, USER_TRACKER_KEY, "mood"), false);
  assert.equal(isOwnerStatEnabled(context, settings, USER_TRACKER_KEY, "lastThought"), true);
});
