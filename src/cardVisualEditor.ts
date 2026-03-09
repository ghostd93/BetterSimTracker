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
  visible: true,
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
    layerOrder: Array.isArray(style.layerOrder) ? [...style.layerOrder] : undefined,
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
    visible: asBool(source.visible, fallback.visible),
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

function sanitizePartialStylePreset(input: unknown): Partial<CardVisualEditorStylePreset> {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const out: Partial<CardVisualEditorStylePreset> = {};
  if (source.visible !== undefined) out.visible = asBool(source.visible, DEFAULT_STYLE_PRESET.visible);
  if (source.backgroundColor !== undefined) out.backgroundColor = sanitizeColor(source.backgroundColor, "");
  if (source.textColor !== undefined) out.textColor = sanitizeColor(source.textColor, "");
  if (source.labelColor !== undefined) out.labelColor = sanitizeColor(source.labelColor, "");
  if (source.valueColor !== undefined) out.valueColor = sanitizeColor(source.valueColor, "");
  if (source.accentColor !== undefined) out.accentColor = sanitizeColor(source.accentColor, "");
  if (source.borderColor !== undefined) out.borderColor = sanitizeColor(source.borderColor, "");
  if (source.borderWidth !== undefined) out.borderWidth = clampNumber(source.borderWidth, DEFAULT_STYLE_PRESET.borderWidth, 0, 12);
  if (source.borderRadius !== undefined) out.borderRadius = clampNumber(source.borderRadius, DEFAULT_STYLE_PRESET.borderRadius, 0, 48);
  if (source.backgroundOpacity !== undefined) out.backgroundOpacity = clampNumber(source.backgroundOpacity, DEFAULT_STYLE_PRESET.backgroundOpacity, 0, 1);
  if (source.shadowEnabled !== undefined) out.shadowEnabled = asBool(source.shadowEnabled, DEFAULT_STYLE_PRESET.shadowEnabled);
  if (source.shadowColor !== undefined) out.shadowColor = sanitizeColor(source.shadowColor, "");
  if (source.shadowBlur !== undefined) out.shadowBlur = clampNumber(source.shadowBlur, DEFAULT_STYLE_PRESET.shadowBlur, 0, 80);
  if (source.shadowSpread !== undefined) out.shadowSpread = clampNumber(source.shadowSpread, DEFAULT_STYLE_PRESET.shadowSpread, -40, 80);
  if (source.padding !== undefined) out.padding = clampNumber(source.padding, DEFAULT_STYLE_PRESET.padding, 0, 64);
  if (source.rowGap !== undefined) out.rowGap = clampNumber(source.rowGap, DEFAULT_STYLE_PRESET.rowGap, 0, 64);
  if (source.sectionGap !== undefined) out.sectionGap = clampNumber(source.sectionGap, DEFAULT_STYLE_PRESET.sectionGap, 0, 64);
  if (source.fontFamily !== undefined) out.fontFamily = asText(source.fontFamily, "").slice(0, 80);
  if (source.fontSize !== undefined) out.fontSize = clampNumber(source.fontSize, DEFAULT_STYLE_PRESET.fontSize, 10, 32);
  if (source.titleFontSize !== undefined) out.titleFontSize = clampNumber(source.titleFontSize, DEFAULT_STYLE_PRESET.titleFontSize, 10, 48);
  if (source.labelFontSize !== undefined) out.labelFontSize = clampNumber(source.labelFontSize, DEFAULT_STYLE_PRESET.labelFontSize, 10, 40);
  if (source.valueFontSize !== undefined) out.valueFontSize = clampNumber(source.valueFontSize, DEFAULT_STYLE_PRESET.valueFontSize, 10, 40);
  if (source.secondaryFontSize !== undefined) out.secondaryFontSize = clampNumber(source.secondaryFontSize, DEFAULT_STYLE_PRESET.secondaryFontSize, 10, 32);
  if (source.lineHeight !== undefined) out.lineHeight = clampNumber(source.lineHeight, DEFAULT_STYLE_PRESET.lineHeight, 1, 2);
  if (source.letterSpacing !== undefined) out.letterSpacing = clampNumber(source.letterSpacing, DEFAULT_STYLE_PRESET.letterSpacing, -1, 4);
  if (source.barHeight !== undefined) out.barHeight = clampNumber(source.barHeight, DEFAULT_STYLE_PRESET.barHeight, 1, 24);
  if (source.chipRadius !== undefined) out.chipRadius = clampNumber(source.chipRadius, DEFAULT_STYLE_PRESET.chipRadius, 0, 999);
  if (source.chipStyle !== undefined) out.chipStyle = sanitizeChipStyle(source.chipStyle, DEFAULT_STYLE_PRESET.chipStyle);
  if (source.buttonRadius !== undefined) out.buttonRadius = clampNumber(source.buttonRadius, DEFAULT_STYLE_PRESET.buttonRadius, 0, 24);
  if (source.arrayCollapsedLimit !== undefined) out.arrayCollapsedLimit = clampInt(source.arrayCollapsedLimit, DEFAULT_STYLE_PRESET.arrayCollapsedLimit, 1, 30);
  if (source.sceneValueStyle !== undefined) out.sceneValueStyle = sanitizeSceneValueStyle(source.sceneValueStyle, DEFAULT_STYLE_PRESET.sceneValueStyle);
  return out;
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

function sanitizePartialElementOverrides(input: unknown): Record<string, Partial<CardVisualEditorStylePreset>> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, Partial<CardVisualEditorStylePreset>> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    const sanitized = sanitizePartialStylePreset(rawValue);
    if (Object.keys(sanitized).length) out[key] = sanitized;
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
    layerOrder: sanitizeLayerOrder(source.layerOrder),
  };
}

function sanitizeLayerOrder(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value.slice(0, 80));
    if (out.length >= 64) break;
  }
  return out.length ? out : undefined;
}

export function sanitizeCardStyleOverride(input: unknown): CardVisualEditorCardStyleOverride {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const out: CardVisualEditorCardStyleOverride = {};
  if (source.root !== undefined) {
    const root = sanitizePartialStylePreset(source.root);
    if (Object.keys(root).length) out.root = root;
  }
  if (source.motionEnabled !== undefined) out.motionEnabled = asBool(source.motionEnabled, true);
  if (source.motionIntensity !== undefined) out.motionIntensity = sanitizeMotionIntensity(source.motionIntensity, "medium");
  if (source.elements !== undefined) {
    const elements = sanitizePartialElementOverrides(source.elements);
    if (Object.keys(elements).length) out.elements = elements;
  }
  if (source.layerOrder !== undefined) out.layerOrder = sanitizeLayerOrder(source.layerOrder);
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

export function mergeCardStyleOverride(
  base: CardVisualEditorCardStyleOverride | undefined,
  override: CardVisualEditorCardStyleOverride | undefined,
): CardVisualEditorCardStyleOverride {
  const next: CardVisualEditorCardStyleOverride = {};
  if (base?.motionEnabled !== undefined || override?.motionEnabled !== undefined) {
    next.motionEnabled = override?.motionEnabled ?? base?.motionEnabled;
  }
  if (base?.motionIntensity !== undefined || override?.motionIntensity !== undefined) {
    next.motionIntensity = override?.motionIntensity ?? base?.motionIntensity;
  }
  if (base?.root || override?.root) {
    next.root = { ...(base?.root ?? {}), ...(override?.root ?? {}) };
  }
  if (base?.elements || override?.elements) {
    const mergedElements: Record<string, Partial<CardVisualEditorStylePreset>> = {};
    const keys = new Set<string>([
      ...Object.keys(base?.elements ?? {}),
      ...Object.keys(override?.elements ?? {}),
    ]);
    for (const key of keys) {
      mergedElements[key] = {
        ...((base?.elements?.[key]) ?? {}),
        ...((override?.elements?.[key]) ?? {}),
      };
    }
    if (Object.keys(mergedElements).length) next.elements = mergedElements;
  }
  if ((override?.layerOrder && override.layerOrder.length) || (base?.layerOrder && base.layerOrder.length)) {
    next.layerOrder = Array.isArray(override?.layerOrder) ? [...override.layerOrder] : [...(base?.layerOrder ?? [])];
  }
  return next;
}

export function deriveRelativeCardStyleOverride(
  resolved: CardVisualEditorCardStyleOverride | undefined,
  base: CardVisualEditorCardStyleOverride | undefined,
): CardVisualEditorCardStyleOverride {
  const next = sanitizeCardStyleOverride(resolved);
  const against = sanitizeCardStyleOverride(base);
  const out: CardVisualEditorCardStyleOverride = {};
  if (next.motionEnabled !== undefined && next.motionEnabled !== against.motionEnabled) out.motionEnabled = next.motionEnabled;
  if (next.motionIntensity !== undefined && next.motionIntensity !== against.motionIntensity) out.motionIntensity = next.motionIntensity;
  if (next.layerOrder && JSON.stringify(next.layerOrder) !== JSON.stringify(against.layerOrder ?? undefined)) {
    out.layerOrder = [...next.layerOrder];
  }
  if (next.root) {
    const rootDiff: Partial<CardVisualEditorStylePreset> = {};
    for (const [key, value] of Object.entries(next.root)) {
      if ((against.root?.[key as keyof CardVisualEditorStylePreset]) !== value) {
        rootDiff[key as keyof CardVisualEditorStylePreset] = value as never;
      }
    }
    if (Object.keys(rootDiff).length) out.root = rootDiff;
  }
  if (next.elements) {
    const elementDiff: Record<string, Partial<CardVisualEditorStylePreset>> = {};
    for (const [layerId, preset] of Object.entries(next.elements)) {
      const basePreset = against.elements?.[layerId];
      const diffPreset: Partial<CardVisualEditorStylePreset> = {};
      for (const [key, value] of Object.entries(preset)) {
        if ((basePreset?.[key as keyof CardVisualEditorStylePreset]) !== value) {
          diffPreset[key as keyof CardVisualEditorStylePreset] = value as never;
        }
      }
      if (Object.keys(diffPreset).length) elementDiff[layerId] = diffPreset;
    }
    if (Object.keys(elementDiff).length) out.elements = elementDiff;
  }
  return out;
}

export function resolveOrderedLayerIds(
  currentIds: string[],
  configuredOrder?: string[] | null,
): string[] {
  if (!Array.isArray(currentIds) || currentIds.length <= 1) return [...currentIds];
  const orderIndex = new Map<string, number>();
  (configuredOrder ?? []).forEach((id, index) => {
    const key = String(id ?? "").trim();
    if (!key || orderIndex.has(key)) return;
    orderIndex.set(key, index);
  });
  return [...currentIds].sort((a, b) => {
    const aRank = orderIndex.get(a);
    const bRank = orderIndex.get(b);
    if (aRank != null && bRank != null && aRank !== bRank) return aRank - bRank;
    if (aRank != null && bRank == null) return -1;
    if (aRank == null && bRank != null) return 1;
    return currentIds.indexOf(a) - currentIds.indexOf(b);
  });
}

export function resolveCardStyleWithOverride(
  cardType: "character" | "user" | "scene",
  editor: CardVisualEditorSettings,
  ownerOverride?: CardVisualEditorCardStyleOverride | null,
): CardVisualEditorCardStyle | null {
  const hasOwnerOverride = Boolean(
    ownerOverride
    && (
      ownerOverride.motionEnabled !== undefined
      || ownerOverride.motionIntensity !== undefined
      || (ownerOverride.root && Object.keys(ownerOverride.root).length > 0)
      || (ownerOverride.elements && Object.keys(ownerOverride.elements).length > 0)
      || (ownerOverride.layerOrder && ownerOverride.layerOrder.length > 0)
    ),
  );
  if (!editor.useEditorStyling && !hasOwnerOverride) return null;
  const base = mergeStyle(
    editor.base,
    cardType === "character"
      ? editor.character
      : cardType === "user"
        ? editor.user
        : editor.scene,
  );
  if (!hasOwnerOverride) return base;
  return mergeStyle(base, sanitizeCardStyleOverride(ownerOverride));
}
