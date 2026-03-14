import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { EXTENSION_KEY } from "../src/constants";
import {
  defaultSettings,
  discoverConnectionProfiles,
  getSettingsProvenance,
  hasExplicitConnectionProfileValue,
  loadSettings,
  resolveConnectionProfileId,
  sanitizeSettings,
} from "../src/settings";
import type { STContext } from "../src/types";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const localStorageMock = new MemoryStorage();
function bindLocalStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

bindLocalStorage();

beforeEach(() => {
  bindLocalStorage();
});

afterEach(() => {
  localStorageMock.clear();
});

function makeContext(extensionSettings?: Record<string, unknown>): STContext {
  return {
    chat: [],
    characterId: 1,
    extensionSettings,
    chatCompletionSettings: {},
    chatMetadata: {},
  };
}

test("sanitizeSettings normalizes custom stats, defaults, and scene card display settings", () => {
  const sanitized = sanitizeSettings({
    sceneCardLayout: "rows",
    injectionPromptMaxChars: 200000,
    customStats: [
      {
        id: "Clothes",
        kind: "array",
        label: "Clothes",
        defaultValue: ["hat", "boots"],
        textMaxLength: 500,
        globalScope: false,
        track: true,
        trackCharacters: true,
        trackUser: false,
        showOnCard: true,
        showInGraph: true,
        includeInInjection: true,
      },
      {
        id: "scene_date_time",
        kind: "date_time",
        label: "Scene Date/Time",
        defaultValue: "2026-03-06 21:30",
        dateTimeMode: "structured",
        globalScope: true,
        privateToOwner: true,
        track: true,
        trackCharacters: false,
        trackUser: false,
        showOnCard: true,
        showInGraph: true,
        includeInInjection: true,
      },
    ],
    sceneCardStatDisplay: {
      scene_date_time: {
        visible: true,
        showLabel: true,
        hideWhenEmpty: false,
        labelOverride: "Time",
        colorOverride: "#ABC",
        layoutOverride: "chips",
        valueStyle: "chip",
        textMaxLength: 999,
        arrayCollapsedLimit: 999,
        dateTimePartOrder: ["phase", "date", "phase", "weekday"],
      },
    } as never,
  });

  assert.equal(sanitized.sceneCardLayout, "rows");
  assert.equal(sanitized.customStats.length, 2);
  assert.equal(sanitized.customStats[0].id, "clothes");
  assert.equal(sanitized.customStats[0].textMaxLength, 200);
  assert.deepEqual(sanitized.customStats[0].defaultValue, ["hat", "boots"]);
  assert.equal(sanitized.customStats[1].globalScope, true);
  assert.equal(sanitized.customStats[1].trackCharacters, true);
  assert.equal(sanitized.customStats[1].trackUser, true);
  assert.equal(sanitized.customStats[1].privateToOwner, false);
  assert.equal(sanitized.customStats[1].dateTimeMode, "structured");
  assert.equal(sanitized.injectionPromptMaxChars, 100000);
  assert.equal(sanitized.sceneCardStatDisplay.scene_date_time.colorOverride, "#aabbcc");
  assert.equal(sanitized.sceneCardStatDisplay.scene_date_time.textMaxLength, 400);
  assert.equal(sanitized.sceneCardStatDisplay.scene_date_time.arrayCollapsedLimit, 30);
  assert.deepEqual(
    sanitized.sceneCardStatDisplay.scene_date_time.dateTimePartOrder,
    ["phase", "date", "weekday", "time"],
  );
});

test("loadSettings keeps enabled true when context is partial but accepts explicit context override", () => {
  localStorageMock.setItem(
    `extension-settings:${EXTENSION_KEY}`,
    JSON.stringify({ enabled: false, fontSize: 22 }),
  );

  const partialContext = makeContext({
    [EXTENSION_KEY]: { fontSize: 18 },
  });
  const partialLoaded = loadSettings(partialContext);
  assert.equal(partialLoaded.enabled, true);
  assert.equal(partialLoaded.fontSize, 18);

  const explicitContext = makeContext({
    [EXTENSION_KEY]: { enabled: false, fontSize: 16 },
  });
  const explicitLoaded = loadSettings(explicitContext);
  assert.equal(explicitLoaded.enabled, false);
  assert.equal(explicitLoaded.fontSize, 16);
});

test("loadSettings accepts local enabled fallback only when context has no BST settings at all", () => {
  localStorageMock.setItem(
    `extension-settings:${EXTENSION_KEY}`,
    JSON.stringify({ enabled: false, cardOpacity: 0.5 }),
  );
  const context = makeContext();
  const loaded = loadSettings(context);
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.cardOpacity, 0.5);
});

test("getSettingsProvenance distinguishes context, local, and default values", () => {
  localStorageMock.setItem(
    `extension-settings:${EXTENSION_KEY}`,
    JSON.stringify({ fontSize: 18 }),
  );
  const context = makeContext({
    [EXTENSION_KEY]: { cardOpacity: 0.5 },
  });
  const provenance = getSettingsProvenance(context);
  assert.equal(provenance.cardOpacity, "context");
  assert.equal(provenance.fontSize, "local");
  assert.equal(provenance.borderRadius, "default");
});

test("discoverConnectionProfiles and resolveConnectionProfileId use discovered and selected values", () => {
  const context: STContext = {
    chat: [],
    characterId: 1,
    extensionSettings: {
      connectionManager: {
        selectedProfile: "b",
        profiles: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      },
      [EXTENSION_KEY]: {},
    },
    chatCompletionSettings: {},
    chatMetadata: {},
  };
  const discovered = discoverConnectionProfiles(context);
  assert.deepEqual(discovered, [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ]);

  const resolved = resolveConnectionProfileId(
    { ...defaultSettings, connectionProfile: "" },
    context,
  );
  assert.equal(resolved, "b");
  assert.equal(hasExplicitConnectionProfileValue("active"), false);
  assert.equal(hasExplicitConnectionProfileValue("profile-x"), true);
});

test("sanitizeSettings supports collapseCardsByDefault and trackerEnabled in character defaults", () => {
  const sanitized = sanitizeSettings({
    collapseCardsByDefault: true,
    customStats: [
      {
        id: "pose",
        kind: "text_short",
        label: "Pose",
        defaultValue: "",
        track: true,
        trackCharacters: true,
        trackUser: true,
        showOnCard: true,
        showInGraph: false,
        includeInInjection: true,
      },
    ],
    characterDefaults: {
      Seraphina: {
        trackerEnabled: false,
        statEnabled: { affection: false, pose: false },
        customNonNumericStatDefaults: {
          pose: "Standing by the bed",
        },
      },
    },
  });

  assert.equal(sanitized.collapseCardsByDefault, true);
  assert.equal(sanitized.characterDefaults.Seraphina?.trackerEnabled, false);
  assert.equal(sanitized.characterDefaults.Seraphina?.statEnabled?.affection, false);
  assert.equal(sanitized.characterDefaults.Seraphina?.statEnabled?.pose, false);
  assert.equal(
    sanitized.characterDefaults.Seraphina?.customNonNumericStatDefaults?.pose,
    "Standing by the bed",
  );
});

test("sanitizeSettings clamps sceneCardArrayCollapsedLimit to MAX_CUSTOM_ARRAY_ITEMS", () => {
  const sanitized = sanitizeSettings({
    sceneCardArrayCollapsedLimit: 999,
  });

  assert.equal(sanitized.sceneCardArrayCollapsedLimit, 30);
});

test("sanitizeSettings keeps autoGenerateTracker toggle", () => {
  const disabled = sanitizeSettings({ autoGenerateTracker: false });
  const enabled = sanitizeSettings({ autoGenerateTracker: true });

  assert.equal(disabled.autoGenerateTracker, false);
  assert.equal(enabled.autoGenerateTracker, true);
});

test("sanitizeSettings defaults lorebook scan fallback to enabled and accepts explicit override", () => {
  const defaults = sanitizeSettings({});
  assert.equal(defaults.useInternalLorebookScanFallback, true);

  const disabled = sanitizeSettings({
    includeLorebookInExtraction: true,
    useInternalLorebookScanFallback: false,
  });
  assert.equal(disabled.includeLorebookInExtraction, true);
  assert.equal(disabled.useInternalLorebookScanFallback, false);
});
