import test from "node:test";
import assert from "node:assert/strict";

import { resolveCharacterDefaultsEntry } from "../src/characterDefaults";
import { defaultSettings } from "../src/settings";

test("resolveCharacterDefaultsEntry prefers avatar-scoped defaults over name-scoped defaults", () => {
  const settings = {
    ...defaultSettings,
    characterDefaults: {
      Seraphina: { cardColor: "#111111" },
      "avatar:seraphina-a.png": { cardColor: "#222222" },
    },
  };

  const resolved = resolveCharacterDefaultsEntry(settings, {
    name: "Seraphina",
    avatar: "seraphina-a.png",
  });

  assert.equal((resolved as { cardColor?: string }).cardColor, "#222222");
});

test("resolveCharacterDefaultsEntry falls back to name when avatar-scoped defaults are absent", () => {
  const settings = {
    ...defaultSettings,
    characterDefaults: {
      Seraphina: { cardColor: "#111111" },
    },
  };

  const resolved = resolveCharacterDefaultsEntry(settings, {
    name: "Seraphina",
    avatar: "seraphina-a.png",
  });

  assert.equal((resolved as { cardColor?: string }).cardColor, "#111111");
});
