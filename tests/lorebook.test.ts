import test from "node:test";
import assert from "node:assert/strict";

import { readLorebookContext } from "../src/lorebook";

test("readLorebookContext ignores extension prompt WI blocks", () => {
  const text = readLorebookContext({
    chatMetadata: {},
    world_info: {},
    worldInfo: {},
    lorebook: {},
    extensionPrompts: {
      customDepthWI_0: {
        prompt: "Should not be included from extension prompt fallback",
      },
      customWIOutlet_1: {
        lorebookPrompt: "Also should not be included",
      },
    },
  } as any, 1200, 12000);

  assert.equal(text, "");
});

test("readLorebookContext keeps directly activated lorebook entries", () => {
  const text = readLorebookContext({
    chatMetadata: {
      lorebook: {
        activatedEntries: [
          { content: "Direct activated lorebook entry" },
        ],
      },
    },
    world_info: {},
    worldInfo: {},
    lorebook: {},
    extensionPrompts: {
      customDepthWI_0: {
        prompt: "Should not leak through extension prompts",
      },
    },
  } as any, 1200, 12000);

  assert.match(text, /Direct activated lorebook entry/);
  assert.doesNotMatch(text, /Should not leak through extension prompts/);
});
