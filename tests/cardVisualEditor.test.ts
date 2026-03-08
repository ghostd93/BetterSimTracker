import test from "node:test";
import assert from "node:assert/strict";

import {
  CARD_VISUAL_EDITOR_SCHEMA_VERSION,
  createDefaultCardVisualEditorSettings,
  migrateLegacyDisplayToCardVisualEditor,
  resolveCardStyle,
  sanitizeCardVisualEditorSettings,
} from "../src/cardVisualEditor";

test("sanitizeCardVisualEditorSettings applies clamps and fallback defaults", () => {
  const sanitized = sanitizeCardVisualEditorSettings(
    {
      enabled: true,
      useEditorStyling: true,
      base: {
        root: {
          borderWidth: 999,
          borderRadius: -20,
          backgroundOpacity: 9,
          fontSize: 2,
          chipStyle: "invalid",
          sceneValueStyle: "invalid",
        },
      },
    },
    {
      accentColor: "#ff5a6f",
      userCardColor: "",
      sceneCardColor: "",
      sceneCardValueColor: "",
      cardOpacity: 0.92,
      borderRadius: 14,
      fontSize: 14,
      sceneCardLayout: "chips",
      sceneCardArrayCollapsedLimit: 4,
    },
  );

  assert.equal(sanitized.schemaVersion, CARD_VISUAL_EDITOR_SCHEMA_VERSION);
  assert.equal(sanitized.enabled, true);
  assert.equal(sanitized.useEditorStyling, true);
  assert.equal(sanitized.base.root.borderWidth, 12);
  assert.equal(sanitized.base.root.borderRadius, 0);
  assert.equal(sanitized.base.root.backgroundOpacity, 1);
  assert.equal(sanitized.base.root.fontSize, 10);
  assert.equal(sanitized.base.root.chipStyle, "soft");
  assert.equal(sanitized.base.root.sceneValueStyle, "chip");
});

test("migrateLegacyDisplayToCardVisualEditor maps legacy display settings", () => {
  const migrated = migrateLegacyDisplayToCardVisualEditor(
    {},
    {
      accentColor: "#aa33ff",
      userCardColor: "#112233",
      sceneCardColor: "#223344",
      sceneCardValueColor: "#334455",
      cardOpacity: 0.75,
      borderRadius: 22,
      fontSize: 18,
      sceneCardLayout: "rows",
      sceneCardArrayCollapsedLimit: 9,
    },
  );

  assert.equal(migrated.base.root.accentColor, "#aa33ff");
  assert.equal(migrated.base.root.backgroundOpacity, 0.75);
  assert.equal(migrated.base.root.borderRadius, 22);
  assert.equal(migrated.base.root.fontSize, 18);
  assert.equal(migrated.user.root?.backgroundColor, "#112233");
  assert.equal(migrated.scene.root?.backgroundColor, "#223344");
  assert.equal(migrated.scene.root?.valueColor, "#334455");
  assert.equal(migrated.scene.root?.sceneValueStyle, "plain");
  assert.equal(migrated.scene.root?.arrayCollapsedLimit, 9);
});

test("migrateLegacyDisplayToCardVisualEditor is idempotent for sanitized payload", () => {
  const first = sanitizeCardVisualEditorSettings(
    {
      enabled: true,
      useEditorStyling: false,
      base: { root: { backgroundColor: "#101010", fontSize: 16 } },
      user: { root: { backgroundColor: "#203040" } },
      presets: [{ id: "p1", name: "Preset 1" }],
      activePresetId: "p1",
    },
    {
      accentColor: "#ff5a6f",
      userCardColor: "",
      sceneCardColor: "",
      sceneCardValueColor: "",
      cardOpacity: 0.92,
      borderRadius: 14,
      fontSize: 14,
      sceneCardLayout: "chips",
      sceneCardArrayCollapsedLimit: 4,
    },
  );

  const second = sanitizeCardVisualEditorSettings(first, {
    accentColor: "#ff5a6f",
    userCardColor: "",
    sceneCardColor: "",
    sceneCardValueColor: "",
    cardOpacity: 0.92,
    borderRadius: 14,
    fontSize: 14,
    sceneCardLayout: "chips",
    sceneCardArrayCollapsedLimit: 4,
  });

  assert.deepEqual(second, first);
});

test("resolveCardStyle returns null when editor styling is disabled", () => {
  const settings = createDefaultCardVisualEditorSettings();
  settings.enabled = true;
  settings.useEditorStyling = false;
  assert.equal(resolveCardStyle("character", settings), null);
});

test("resolveCardStyle merges base and card override when enabled", () => {
  const settings = createDefaultCardVisualEditorSettings();
  settings.useEditorStyling = true;
  settings.base.root.backgroundColor = "#111111";
  settings.character = { root: { backgroundColor: "#222222", borderRadius: 20 } };

  const resolved = resolveCardStyle("character", settings);
  assert.ok(resolved);
  assert.equal(resolved?.root.backgroundColor, "#222222");
  assert.equal(resolved?.root.borderRadius, 20);
  assert.equal(resolved?.root.fontSize, settings.base.root.fontSize);
});

