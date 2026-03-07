import test from "node:test";
import assert from "node:assert/strict";

import { isCustomStatTrackableForOwnerToggle } from "../src/ownerStatToggles";
import type { CustomStatDefinition } from "../src/types";

function stat(partial: Partial<CustomStatDefinition>): CustomStatDefinition {
  return {
    id: "x",
    kind: "text_short",
    label: "X",
    description: "",
    defaultValue: "",
    track: true,
    trackCharacters: true,
    trackUser: true,
    showOnCard: true,
    showInGraph: false,
    includeInInjection: true,
    ...partial,
  };
}

test("owner toggles exclude global stats", () => {
  const def = stat({ globalScope: true, trackCharacters: true, trackUser: true });
  assert.equal(isCustomStatTrackableForOwnerToggle(def, "character"), false);
  assert.equal(isCustomStatTrackableForOwnerToggle(def, "user"), false);
});

test("owner toggles respect owner track flags for non-global stats", () => {
  const charOnly = stat({ trackUser: false });
  const userOnly = stat({ trackCharacters: false });
  const disabled = stat({ track: false, trackUser: true, trackCharacters: true });

  assert.equal(isCustomStatTrackableForOwnerToggle(charOnly, "character"), true);
  assert.equal(isCustomStatTrackableForOwnerToggle(charOnly, "user"), false);

  assert.equal(isCustomStatTrackableForOwnerToggle(userOnly, "character"), false);
  assert.equal(isCustomStatTrackableForOwnerToggle(userOnly, "user"), true);

  assert.equal(isCustomStatTrackableForOwnerToggle(disabled, "character"), false);
  assert.equal(isCustomStatTrackableForOwnerToggle(disabled, "user"), false);
});

