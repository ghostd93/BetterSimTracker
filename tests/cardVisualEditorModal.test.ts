import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultCardVisualEditorSettings } from "../src/cardVisualEditor";
import { resolvePreviewRootStyle } from "../src/cardVisualEditorModal";

test("resolvePreviewRootStyle merges base root with card override root", () => {
  const draft = createDefaultCardVisualEditorSettings();
  draft.base.root.backgroundColor = "#111111";
  draft.base.root.borderRadius = 12;
  draft.user = {
    root: {
      backgroundColor: "#223344",
      borderRadius: 20,
    },
  };

  const result = resolvePreviewRootStyle(draft, "user");
  assert.equal(result.backgroundColor, "#223344");
  assert.equal(result.borderRadius, 20);
  assert.equal(result.fontSize, draft.base.root.fontSize);
});

