import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultCardVisualEditorSettings } from "../src/cardVisualEditor";
import { resolvePreviewLayerStyle, resolvePreviewRootStyle, shouldLiveApply } from "../src/cardVisualEditorModal";

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

test("resolvePreviewLayerStyle inherits root and applies selected layer overrides", () => {
  const draft = createDefaultCardVisualEditorSettings();
  draft.base.root.backgroundColor = "#111111";
  draft.base.root.textColor = "#eeeeee";
  draft.character = {
    root: {
      backgroundColor: "#202020",
      borderRadius: 16,
    },
    elements: {
      "header": {
        textColor: "#88bbff",
        borderColor: "#335577",
      },
    },
  };

  const root = resolvePreviewLayerStyle(draft, "character", "root");
  const header = resolvePreviewLayerStyle(draft, "character", "header");

  assert.equal(root.backgroundColor, "#202020");
  assert.equal(header.backgroundColor, "#202020");
  assert.equal(header.textColor, "#88bbff");
  assert.equal(header.borderColor, "#335577");
  assert.equal(header.borderRadius, 16);
});

test("shouldLiveApply requires both live mode and editor styling", () => {
  assert.equal(shouldLiveApply(false, false), false);
  assert.equal(shouldLiveApply(true, false), false);
  assert.equal(shouldLiveApply(false, true), false);
  assert.equal(shouldLiveApply(true, true), true);
});
