import type {
  CardVisualEditorCardStyle,
  CardVisualEditorCardStyleOverride,
  CardVisualEditorPreset,
  CardVisualEditorSettings,
  CardVisualEditorStylePreset,
  CardVisualMotionIntensity,
  CardVisualTokenChipStyle,
} from "./types";

export const CARD_VISUAL_EDITOR_SCHEMA_VERSION = 1;
const MAX_PRESETS = 40;

type LegacyVisualInputs = {
  accentColor: string;
  userCardColor: string;
  sceneCardColor: string;
  sceneCardValueColor: string;
  cardOpacity: number;
  borderRadius: number;
  fontSize: number;
  sceneCardLayout: "chips" | "rows";
  sceneCardArrayCollapsedLimit: number;
};

const DEFAULT_STYLE_PRESET: CardVisualEditorStylePreset = {
  backgroundColor: "",
  textColor: "",
  labelColor: "",
  valueColor: "",
  accentColor: "",
  borderColor: "",
  borderWidth: 1,
  borderRadius: 14,
  backgroundOpacity: 0.92,
  shadowEnabled: true,
  shadowColor: "#00000066",
  shadowBlur: 16,
  shadowSpread: 0,
  padding: 10,
  rowGap: 8,
  sectionGap: 10,
  fontFamily: "",
  fontSize: 14,
  titleFontSize: 16,
  labelFontSize: 13,
  valueFontSize: 13,
  secondaryFontSize: 12,
  lineHeight: 1.35,
  letterSpacing: 0,
  barHeight: 8,
  chipRadius: 999,
  chipStyle: "soft",
  buttonRadius: 8,
  arrayCollapsedLimit: 4,
  sceneValueStyle: "chip",
};

const DEFAULT_CARD_STYLE: CardVisualEditorCardStyle = {
  motionEnabled: true,
  motionIntensity: "medium",
  root: { ...DEFAULT_STYLE_PRESET },
  elements: {},
};

export function createDefaultCardVisualEditorSettings(): CardVisualEditorSettings {
  return {
    schemaVersion: CARD_VISUAL_EDITOR_SCHEMA_VERSION,
    enabled: false,
    useEditorStyling: false,
    base: cloneCardStyle(DEFAULT_CARD_STYLE),
    character: {},
    user: {},
    scene: {},
    presets: [],
    activePresetId: null,
  };
}

export function cloneCardStyle(style: CardVisualEditorCardStyle): CardVisualEditorCardStyle {
  return {
    motionEnabled: style.motionEnabled,
    motionIntensity: style.motionIntensity,
    root: { ...style.root },
    elements: Object.fromEntries(
      Object.entries(style.elements ?? {}).map(([key, value]) => [key, { ...value }]),
    ),
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function sanitizeColor(value: unknown, fallback = ""): string {
  const raw = asText(value, fallback);
  if (!raw) return "";
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) return raw.toLowerCase();
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(raw)) return raw;
  return fallback ? sanitizeColor(fallback, "") : "";
}

function sanitizeChipStyle(value: unknown, fallback: CardVisualTokenChipStyle): CardVisualTokenChipStyle {
  return value === "filled" || value === "outline" || value === "soft" ? value : fallback;
}

function sanitizeMotionIntensity(value: unknown, fallback: CardVisualMotionIntensity): CardVisualMotionIntensity {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function sanitizeSceneValueStyle(value: unknown, fallback: "chip" | "plain"): "chip" | "plain" {
  return value === "chip" || value === "plain" ? value : fallback;
}

function sanitizeStylePreset(input: unknown, fallback: CardVisualEditorStylePreset): CardVisualEditorStylePreset {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    backgroundColor: sanitizeColor(source.backgroundColor, fallback.backgroundColor),
    textColor: sanitizeColor(source.textColor, fallback.textColor),
    labelColor: sanitizeColor(source.labelColor, fallback.labelColor),
    valueColor: sanitizeColor(source.valueColor, fallback.valueColor),
    accentColor: sanitizeColor(source.accentColor, fallback.accentColor),
    borderColor: sanitizeColor(source.borderColor, fallback.borderColor),
    borderWidth: clampNumber(source.borderWidth, fallback.borderWidth, 0, 12),
    borderRadius: clampNumber(source.borderRadius, fallback.borderRadius, 0, 48),
    backgroundOpacity: clampNumber(source.backgroundOpacity, fallback.backgroundOpacity, 0, 1),
    shadowEnabled: asBool(source.shadowEnabled, fallback.shadowEnabled),
    shadowColor: sanitizeColor(source.shadowColor, fallback.shadowColor),
    shadowBlur: clampNumber(source.shadowBlur, fallback.shadowBlur, 0, 80),
    shadowSpread: clampNumber(source.shadowSpread, fallback.shadowSpread, -40, 80),
    padding: clampNumber(source.padding, fallback.padding, 0, 64),
    rowGap: clampNumber(source.rowGap, fallback.rowGap, 0, 64),
    sectionGap: clampNumber(source.sectionGap, fallback.sectionGap, 0, 64),
    fontFamily: asText(source.fontFamily, fallback.fontFamily).slice(0, 80),
    fontSize: clampNumber(source.fontSize, fallback.fontSize, 10, 32),
    titleFontSize: clampNumber(source.titleFontSize, fallback.titleFontSize, 10, 48),
    labelFontSize: clampNumber(source.labelFontSize, fallback.labelFontSize, 10, 40),
    valueFontSize: clampNumber(source.valueFontSize, fallback.valueFontSize, 10, 40),
    secondaryFontSize: clampNumber(source.secondaryFontSize, fallback.secondaryFontSize, 10, 32),
    lineHeight: clampNumber(source.lineHeight, fallback.lineHeight, 1, 2),
    letterSpacing: clampNumber(source.letterSpacing, fallback.letterSpacing, -1, 4),
    barHeight: clampNumber(source.barHeight, fallback.barHeight, 1, 24),
    chipRadius: clampNumber(source.chipRadius, fallback.chipRadius, 0, 999),
    chipStyle: sanitizeChipStyle(source.chipStyle, fallback.chipStyle),
    buttonRadius: clampNumber(source.buttonRadius, fallback.buttonRadius, 0, 24),
    arrayCollapsedLimit: clampInt(source.arrayCollapsedLimit, fallback.arrayCollapsedLimit, 1, 30),
    sceneValueStyle: sanitizeSceneValueStyle(source.sceneValueStyle, fallback.sceneValueStyle),
  };
}

function sanitizeElementOverrides(input: unknown): Record<string, CardVisualEditorStylePreset> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, CardVisualEditorStylePreset> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    out[key] = sanitizeStylePreset(rawValue, DEFAULT_STYLE_PRESET);
  }
  return out;
}

function sanitizeCardStyle(input: unknown, fallback: CardVisualEditorCardStyle): CardVisualEditorCardStyle {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    motionEnabled: asBool(source.motionEnabled, fallback.motionEnabled),
    motionIntensity: sanitizeMotionIntensity(source.motionIntensity, fallback.motionIntensity),
    root: sanitizeStylePreset(source.root, fallback.root),
    elements: sanitizeElementOverrides(source.elements),
  };
}

function sanitizeCardStyleOverride(input: unknown): CardVisualEditorCardStyleOverride {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const out: CardVisualEditorCardStyleOverride = {};
  if (source.root !== undefined) out.root = sanitizeStylePreset(source.root, DEFAULT_STYLE_PRESET);
  if (source.motionEnabled !== undefined) out.motionEnabled = asBool(source.motionEnabled, true);
  if (source.motionIntensity !== undefined) out.motionIntensity = sanitizeMotionIntensity(source.motionIntensity, "medium");
  if (source.elements !== undefined) out.elements = sanitizeElementOverrides(source.elements);
  return out;
}

function sanitizePreset(input: unknown): CardVisualEditorPreset | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const id = asText(source.id).toLowerCase().replace(/[^a-z0-9_\-]/g, "_").slice(0, 64);
  const name = asText(source.name).slice(0, 80);
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAt: clampInt(source.createdAt, Date.now(), 0, 9_999_999_999_999),
    updatedAt: clampInt(source.updatedAt, Date.now(), 0, 9_999_999_999_999),
    schemaVersion: CARD_VISUAL_EDITOR_SCHEMA_VERSION,
    base: sanitizeCardStyleOverride(source.base),
    character: sanitizeCardStyleOverride(source.character),
    user: sanitizeCardStyleOverride(source.user),
    scene: sanitizeCardStyleOverride(source.scene),
  };
}

function mergeStyle(base: CardVisualEditorCardStyle, override: CardVisualEditorCardStyleOverride): CardVisualEditorCardStyle {
  const merged = cloneCardStyle(base);
  if (override.motionEnabled !== undefined) merged.motionEnabled = override.motionEnabled;
  if (override.motionIntensity !== undefined) merged.motionIntensity = override.motionIntensity;
  if (override.root) merged.root = { ...merged.root, ...override.root };
  if (override.elements) {
    for (const [key, value] of Object.entries(override.elements)) {
      merged.elements[key] = { ...(merged.elements[key] ?? DEFAULT_STYLE_PRESET), ...value };
    }
  }
  return merged;
}

function applyLegacyFallbacks(base: CardVisualEditorCardStyle, legacy: LegacyVisualInputs): CardVisualEditorCardStyle {
  const next = cloneCardStyle(base);
  next.root.accentColor = legacy.accentColor || next.root.accentColor;
  next.root.backgroundOpacity = legacy.cardOpacity;
  next.root.borderRadius = legacy.borderRadius;
  next.root.fontSize = legacy.fontSize;
  next.root.titleFontSize = Math.max(next.root.titleFontSize, legacy.fontSize + 2);
  next.root.labelFontSize = Math.max(10, legacy.fontSize - 1);
  next.root.valueFontSize = Math.max(10, legacy.fontSize - 1);
  next.root.secondaryFontSize = Math.max(10, legacy.fontSize - 2);
  next.root.sceneValueStyle = legacy.sceneCardLayout === "rows" ? "plain" : "chip";
  next.root.arrayCollapsedLimit = legacy.sceneCardArrayCollapsedLimit;
  return next;
}

export function migrateLegacyDisplayToCardVisualEditor(
  input: unknown,
  legacy: LegacyVisualInputs,
): CardVisualEditorSettings {
  const defaults = createDefaultCardVisualEditorSettings();
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const migratedBase = applyLegacyFallbacks(defaults.base, legacy);
  const migratedUser: CardVisualEditorCardStyleOverride = legacy.userCardColor
    ? { root: { backgroundColor: legacy.userCardColor } }
    : {};
  const migratedScene: CardVisualEditorCardStyleOverride = {
    root: {
      ...(legacy.sceneCardColor ? { backgroundColor: legacy.sceneCardColor } : {}),
      ...(legacy.sceneCardValueColor ? { valueColor: legacy.sceneCardValueColor } : {}),
      arrayCollapsedLimit: legacy.sceneCardArrayCollapsedLimit,
      sceneValueStyle: legacy.sceneCardLayout === "rows" ? "plain" : "chip",
    },
  };
  const migrated: CardVisualEditorSettings = {
    schemaVersion: CARD_VISUAL_EDITOR_SCHEMA_VERSION,
    enabled: asBool(source.enabled, defaults.enabled),
    useEditorStyling: asBool(source.useEditorStyling, defaults.useEditorStyling),
    base: sanitizeCardStyle(source.base, migratedBase),
    character: sanitizeCardStyleOverride(source.character),
    user: mergeStyle(DEFAULT_CARD_STYLE, sanitizeCardStyleOverride(source.user)).root.backgroundColor || migratedUser.root?.backgroundColor
      ? { ...migratedUser, ...sanitizeCardStyleOverride(source.user) }
      : sanitizeCardStyleOverride(source.user),
    scene: { ...migratedScene, ...sanitizeCardStyleOverride(source.scene) },
    presets: [],
    activePresetId: null,
  };
  const rawPresets = Array.isArray(source.presets) ? source.presets : [];
  const presets: CardVisualEditorPreset[] = [];
  const seen = new Set<string>();
  for (const item of rawPresets) {
    const preset = sanitizePreset(item);
    if (!preset) continue;
    if (seen.has(preset.id)) continue;
    presets.push(preset);
    seen.add(preset.id);
    if (presets.length >= MAX_PRESETS) break;
  }
  migrated.presets = presets;
  const activePresetId = asText(source.activePresetId);
  migrated.activePresetId = activePresetId && seen.has(activePresetId) ? activePresetId : null;
  return migrated;
}

export function sanitizeCardVisualEditorSettings(
  input: unknown,
  legacy: LegacyVisualInputs,
): CardVisualEditorSettings {
  const migrated = migrateLegacyDisplayToCardVisualEditor(input, legacy);
  return {
    schemaVersion: CARD_VISUAL_EDITOR_SCHEMA_VERSION,
    enabled: migrated.enabled,
    useEditorStyling: migrated.useEditorStyling,
    base: sanitizeCardStyle(migrated.base, DEFAULT_CARD_STYLE),
    character: sanitizeCardStyleOverride(migrated.character),
    user: sanitizeCardStyleOverride(migrated.user),
    scene: sanitizeCardStyleOverride(migrated.scene),
    presets: migrated.presets.slice(0, MAX_PRESETS).map(preset => ({
      ...preset,
      schemaVersion: CARD_VISUAL_EDITOR_SCHEMA_VERSION,
      base: sanitizeCardStyleOverride(preset.base),
      character: sanitizeCardStyleOverride(preset.character),
      user: sanitizeCardStyleOverride(preset.user),
      scene: sanitizeCardStyleOverride(preset.scene),
    })),
    activePresetId:
      migrated.activePresetId && migrated.presets.some(preset => preset.id === migrated.activePresetId)
        ? migrated.activePresetId
        : null,
  };
}

export function resolveCardStyle(
  cardType: "character" | "user" | "scene",
  editor: CardVisualEditorSettings,
): CardVisualEditorCardStyle | null {
  if (!editor.useEditorStyling) return null;
  const override =
    cardType === "character"
      ? editor.character
      : cardType === "user"
        ? editor.user
        : editor.scene;
  return mergeStyle(editor.base, override);
}

