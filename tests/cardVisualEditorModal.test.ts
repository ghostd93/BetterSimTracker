import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultCardVisualEditorSettings } from "../src/cardVisualEditor";
import {
  applyPresetToDraft,
  buildAppliedEditorSettings,
  isLayerMovable,
  moveLayerByDirection,
  parsePresetTransferPayload,
  pushDraftHistory,
  reorderLayerIds,
  resolvePreviewViewportWidth,
  resolvePreviewLayerOrder,
  resolvePreviewLayerStyle,
  resolvePreviewRootStyle,
  toPresetId,
} from "../src/cardVisualEditorModal";

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

test("resolvePreviewLayerStyle exposes visibility defaults and overrides", () => {
  const draft = createDefaultCardVisualEditorSettings();
  const root = resolvePreviewLayerStyle(draft, "character", "root");
  assert.equal(root.visible, true);

  draft.character = {
    elements: {
      "mood.container": {
        visible: false,
      },
    },
  };
  const mood = resolvePreviewLayerStyle(draft, "character", "mood.container");
  assert.equal(mood.visible, false);
});

test("buildAppliedEditorSettings always enables editor styling on apply", () => {
  const draft = createDefaultCardVisualEditorSettings();
  draft.useEditorStyling = false;
  draft.base.root.backgroundColor = "#212131";

  const applied = buildAppliedEditorSettings(draft, {
    accentColor: "#8fb4ff",
    userCardColor: "#2c3f6d",
    sceneCardColor: "#1f3b4f",
    sceneCardValueColor: "#f5f8ff",
    cardOpacity: 0.92,
    borderRadius: 18,
    fontSize: 16,
    sceneCardLayout: "chips",
    sceneCardArrayCollapsedLimit: 4,
  });

  assert.equal(applied.useEditorStyling, true);
  assert.equal(applied.base.root.backgroundColor, "#212131");
});

test("resolvePreviewLayerOrder keeps override order and appends missing defaults", () => {
  const draft = createDefaultCardVisualEditorSettings();
  draft.character = {
    layerOrder: ["thought.panel", "stats.nonNumeric.row", "root", "header", "header"],
  };

  const order = resolvePreviewLayerOrder(draft, "character");
  assert.equal(order[0], "thought.panel");
  assert.equal(order[1], "stats.nonNumeric.row");
  assert.equal(order[2], "root");
  assert.equal(order[3], "header");
  assert.ok(order.includes("stats.numeric.row"));
  assert.ok(order.includes("mood.container"));
});

test("reorderLayerIds moves source before target", () => {
  const input = ["root", "header", "body", "footer"];
  const reordered = reorderLayerIds(input, "footer", "header");
  assert.deepEqual(reordered, ["root", "footer", "header", "body"]);
});

test("moveLayerByDirection moves layer up/down when possible", () => {
  const input = ["root", "header", "body", "footer"];
  const up = moveLayerByDirection(input, "body", "up");
  assert.deepEqual(up, ["root", "body", "header", "footer"]);
  const down = moveLayerByDirection(input, "header", "down");
  assert.deepEqual(down, ["root", "body", "header", "footer"]);
  const blocked = moveLayerByDirection(input, "root", "up");
  assert.deepEqual(blocked, input);
});

test("pushDraftHistory deduplicates adjacent snapshots and enforces max entries", () => {
  const a = createDefaultCardVisualEditorSettings();
  const b = createDefaultCardVisualEditorSettings();
  b.useEditorStyling = true;
  const c = createDefaultCardVisualEditorSettings();
  c.enabled = true;

  let history = pushDraftHistory([], a, 2);
  history = pushDraftHistory(history, a, 2);
  assert.equal(history.length, 1);

  history = pushDraftHistory(history, b, 2);
  history = pushDraftHistory(history, c, 2);
  assert.equal(history.length, 2);
  assert.equal(history[0].useEditorStyling, true);
  assert.equal(history[1].enabled, true);
});

test("resolvePreviewViewportWidth returns deterministic widths", () => {
  assert.equal(resolvePreviewViewportWidth("desktop"), 720);
  assert.equal(resolvePreviewViewportWidth("mobile"), 360);
});

test("toPresetId normalizes and clamps names", () => {
  assert.equal(toPresetId("  Neon Character Preset  "), "neon_character_preset");
  assert.equal(toPresetId("###"), "preset");
});

test("isLayerMovable locks root and structural containers, allows stat leaves", () => {
  assert.equal(isLayerMovable("root"), false);
  assert.equal(isLayerMovable("header"), false);
  assert.equal(isLayerMovable("body"), false);
  assert.equal(isLayerMovable("scene.stat.row"), false);
  assert.equal(isLayerMovable("stat.affection"), true);
  assert.equal(isLayerMovable("custom.pose"), true);
});

test("applyPresetToDraft replaces editor style payload from preset snapshot", () => {
  const draft = createDefaultCardVisualEditorSettings();
  draft.base.root.backgroundColor = "#111111";
  draft.character = { root: { borderRadius: 15 } };
  const next = applyPresetToDraft(draft, {
    id: "retro",
    name: "Retro",
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: 1,
    base: {
      root: {
        ...draft.base.root,
        backgroundColor: "#222222",
      },
    },
    character: {
      root: {
        borderRadius: 28,
      },
    },
    user: {},
    scene: {},
  });
  assert.equal(next.base.root.backgroundColor, "#222222");
  assert.equal(next.character.root?.borderRadius, 28);
  assert.equal(next.activePresetId, "retro");
});

test("parsePresetTransferPayload parses valid JSON payload and rejects invalid data", () => {
  const valid = parsePresetTransferPayload(JSON.stringify({
    id: "retro_pack",
    name: "Retro Pack",
    base: { root: { backgroundColor: "#121212" } },
  }));
  assert.ok(valid);
  assert.equal(valid?.id, "retro_pack");
  assert.equal(valid?.name, "Retro Pack");
  assert.equal(valid?.base?.root?.backgroundColor, "#121212");

  const invalid = parsePresetTransferPayload("{not json");
  assert.equal(invalid, null);

  const missingName = parsePresetTransferPayload(JSON.stringify({ base: {} }));
  assert.equal(missingName, null);
});
