import { CUSTOM_STAT_ID_REGEX, MAX_CUSTOM_STATS, RESERVED_CUSTOM_STAT_IDS, STYLE_ID, USER_TRACKER_KEY } from "./constants";
import { resolveCharacterDefaultsEntry } from "./characterDefaults";
import { generateJson } from "./generator";
import { logDebug } from "./settings";
import type {
  BetterSimTrackerSettings,
  BuiltInNumericStatUiSettings,
  ConnectionProfileOption,
  CustomNonNumericValue,
  CustomStatKind,
  CustomStatDefinition,
  DeltaDebugRecord,
  MoodLabel,
  MoodSource,
  StExpressionImageOptions,
  StatValue,
  TrackerData,
} from "./types";
import {
  DEFAULT_INJECTION_PROMPT_TEMPLATE,
  DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
  DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
  DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
  DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
  DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
  DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
  DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
  DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
  DEFAULT_PROTOCOL_UNIFIED,
  DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
  DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
  buildBuiltInSequentialPromptGenerationPrompt,
  buildCustomStatBehaviorGuidanceGenerationPrompt,
  buildCustomStatDescriptionGenerationPrompt,
  buildSequentialCustomOverrideGenerationPrompt,
  moodOptions,
} from "./prompts";
import {
  closeStExpressionFrameEditor,
  formatStExpressionFrameSummary,
  openStExpressionFrameEditor,
  sanitizeStExpressionFrame,
} from "./stExpressionFrameEditor";
import { fetchFirstExpressionSprite } from "./stExpressionSprites";
import { getAllNumericStatDefinitions } from "./statRegistry";

type UiNumericStatDefinition = {
  key: string;
  label: string;
  short: string;
  color: string;
  defaultValue: number;
  showOnCard: boolean;
  showInGraph: boolean;
};

type UiNonNumericStatDefinition = {
  id: string;
  label: string;
  kind: Exclude<CustomStatKind, "numeric">;
  defaultValue: string | boolean;
  enumOptions: string[];
  booleanTrueLabel: string;
  booleanFalseLabel: string;
  textMaxLength: number;
  showOnCard: boolean;
  includeInInjection: boolean;
  color: string;
};

const BUILT_IN_NUMERIC_STAT_KEYS = new Set(["affection", "trust", "desire", "connection"]);

const MOOD_LABELS = moodOptions;
const MOOD_LABEL_LOOKUP = new Map(MOOD_LABELS.map(label => [label.toLowerCase(), label]));
const MOOD_LABELS_BY_LENGTH = [...MOOD_LABELS].sort((a, b) => b.length - a.length);
const DEFAULT_MOOD_EXPRESSION_MAP: Record<MoodLabel, string> = {
  "Happy": "joy",
  "Sad": "sadness",
  "Angry": "anger",
  "Excited": "excitement",
  "Confused": "confusion",
  "In Love": "love",
  "Shy": "nervousness",
  "Playful": "amusement",
  "Serious": "neutral",
  "Lonely": "grief",
  "Hopeful": "optimism",
  "Anxious": "nervousness",
  "Content": "relief",
  "Frustrated": "annoyance",
  "Neutral": "neutral",
};

type SpriteEntry = { label?: string; path?: string };
type CachedExpressionSprites = {
  fetchedAt: number;
  byLabel: Record<string, string[]>;
};

const ST_EXPRESSION_CACHE_TTL_MS = 60_000;
const stExpressionCache = new Map<string, CachedExpressionSprites>();
const stExpressionFetchInFlight = new Set<string>();
const CUSTOM_STAT_DESCRIPTION_MAX_LENGTH = 300;
const DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS: StExpressionImageOptions = {
  zoom: 1.2,
  positionX: 50,
  positionY: 20,
};

function shortLabelFrom(label: string): string {
  const cleaned = label.trim().toUpperCase();
  if (!cleaned) return "?";
  if (cleaned.length <= 2) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`;
  }
  return cleaned.slice(0, 2);
}

function normalizeCustomStatKind(value: unknown): CustomStatKind {
  if (value === "enum_single" || value === "boolean" || value === "text_short") return value;
  return "numeric";
}

function normalizeNonNumericTextValue(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, Math.max(20, Math.min(200, maxLength)));
}

function normalizeCustomEnumOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item ?? "");
    if (!text.length || hasScriptLikeContent(text) || seen.has(text)) continue;
    seen.add(text);
    options.push(text);
    if (options.length >= 12) break;
  }
  return options;
}

function resolveEnumOption(options: string[], candidate: unknown): string | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  if (typeof candidate !== "string") return null;
  if (options.includes(candidate)) return candidate;
  const trimmed = candidate.trim();
  if (trimmed && options.includes(trimmed)) return trimmed;
  const lowered = candidate.toLowerCase();
  const lowerMatch = options.find(option => option.toLowerCase() === lowered);
  if (lowerMatch) return lowerMatch;
  if (trimmed) {
    const trimmedLower = trimmed.toLowerCase();
    const trimmedMatch = options.find(option => option.trim().toLowerCase() === trimmedLower);
    if (trimmedMatch) return trimmedMatch;
  }
  return null;
}

function hasScriptLikeContent(value: string): boolean {
  return /<\s*\/?\s*script\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i.test(value);
}

function getNonNumericStatDefinitions(settings: BetterSimTrackerSettings): UiNonNumericStatDefinition[] {
  const defs = Array.isArray(settings.customStats) ? settings.customStats : [];
  return defs
    .filter(def => normalizeCustomStatKind(def.kind) !== "numeric" && def.track)
    .map(def => {
      const kind = normalizeCustomStatKind(def.kind) as Exclude<CustomStatKind, "numeric">;
      const enumOptions = normalizeCustomEnumOptions(def.enumOptions);
      const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(def.textMaxLength) || 120)));
      const booleanTrueLabel = String(def.booleanTrueLabel ?? "enabled").trim().slice(0, 40) || "enabled";
      const booleanFalseLabel = String(def.booleanFalseLabel ?? "disabled").trim().slice(0, 40) || "disabled";
      let defaultValue: string | boolean;
      if (kind === "boolean") {
        defaultValue = typeof def.defaultValue === "boolean" ? def.defaultValue : false;
      } else {
        if (kind === "enum_single" && enumOptions.length > 0) {
          const matched = resolveEnumOption(enumOptions, def.defaultValue);
          defaultValue = matched ?? enumOptions[0];
        } else {
          const text = normalizeNonNumericTextValue(def.defaultValue, textMaxLength);
          defaultValue = text;
        }
      }
      return {
        id: String(def.id ?? "").trim().toLowerCase(),
        label: String(def.label ?? "").trim() || String(def.id ?? "").trim(),
        kind,
        defaultValue,
        enumOptions,
        booleanTrueLabel,
        booleanFalseLabel,
        textMaxLength,
        showOnCard: Boolean(def.showOnCard),
        includeInInjection: Boolean(def.includeInInjection),
        color: String(def.color ?? "").trim(),
      };
    })
    .filter(def => Boolean(def.id));
}

function getNumericStatDefinitions(settings: BetterSimTrackerSettings): UiNumericStatDefinition[] {
  return getAllNumericStatDefinitions(settings).map(def => ({
    key: def.id,
    label: def.label,
    short: shortLabelFrom(def.label),
    color: def.color || "#9cff8f",
    defaultValue: Math.max(0, Math.min(100, Math.round(Number(def.defaultValue) || 50))),
    showOnCard: def.showOnCard,
    showInGraph: def.showInGraph,
  }));
}

function getNumericRawValue(entry: TrackerData, key: string, name: string): number | undefined {
  if (BUILT_IN_NUMERIC_STAT_KEYS.has(key)) {
    const raw = entry.statistics[key as "affection" | "trust" | "desire" | "connection"]?.[name];
    if (raw === undefined) return undefined;
    return Number(raw);
  }
  const customRaw = entry.customStatistics?.[key]?.[name];
  if (customRaw === undefined) return undefined;
  return Number(customRaw);
}

function getNonNumericRawValue(
  entry: TrackerData,
  statId: string,
  name: string,
): CustomNonNumericValue | undefined {
  return entry.customNonNumericStatistics?.[statId]?.[name];
}

function hasNumericValue(entry: TrackerData, key: string, name: string): boolean {
  const raw = getNumericRawValue(entry, key, name);
  return raw !== undefined && !Number.isNaN(raw);
}

function getNumericStatsForCharacter(
  entry: TrackerData,
  name: string,
  settings: BetterSimTrackerSettings,
): UiNumericStatDefinition[] {
  return getNumericStatDefinitions(settings).filter(def => def.showOnCard);
}

function getNumericStatsForHistory(
  history: TrackerData[],
  name: string,
  settings: BetterSimTrackerSettings,
): UiNumericStatDefinition[] {
  return getNumericStatDefinitions(settings).filter(def => def.showInGraph);
}

function resolveNonNumericValue(
  entry: TrackerData,
  def: UiNonNumericStatDefinition,
  characterName: string,
): string | boolean | null {
  const raw = getNonNumericRawValue(entry, def.id, characterName);
  if (def.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    return typeof def.defaultValue === "boolean" ? def.defaultValue : false;
  }

  if (def.kind === "enum_single") {
    const matched = resolveEnumOption(def.enumOptions, raw ?? def.defaultValue);
    if (matched != null) return matched;
    return def.enumOptions[0] ?? null;
  }
  const maxLength = def.textMaxLength;
  const text = normalizeNonNumericTextValue(raw ?? def.defaultValue, maxLength);
  if (!text) return null;
  return text;
}

function hasNonNumericValue(
  entry: TrackerData,
  def: UiNonNumericStatDefinition,
  characterName: string,
): boolean {
  const raw = getNonNumericRawValue(entry, def.id, characterName);
  if (raw === undefined) return false;
  if (def.kind === "boolean") return typeof raw === "boolean";
  if (def.kind === "enum_single") return resolveEnumOption(def.enumOptions, raw) != null;
  if (typeof raw !== "string") return false;
  const text = normalizeNonNumericTextValue(raw, def.textMaxLength);
  if (!text) return false;
  return true;
}

function formatNonNumericForDisplay(def: UiNonNumericStatDefinition, value: string | boolean): string {
  if (def.kind === "boolean") {
    return value ? def.booleanTrueLabel : def.booleanFalseLabel;
  }
  return String(value);
}

export type TrackerUiState = {
  phase: "idle" | "generating" | "extracting";
  done: number;
  total: number;
  messageIndex: number | null;
  stepLabel?: string | null;
};

type RenderEntry = {
  messageIndex: number;
  data: TrackerData | null;
};

const ROOT_CLASS = "bst-root";
const collapsedTrackerMessages = new Set<number>();
const expandedThoughtKeys = new Set<string>();
const renderedCardKeys = new Set<string>();
const MOOD_PREVIEW_BACKDROP_CLASS = "bst-mood-preview-backdrop";
const MOOD_PREVIEW_MODAL_CLASS = "bst-mood-preview-modal";
const MOOD_PREVIEW_DIALOG_CLASS = "bst-mood-preview-dialog";
const MOOD_PREVIEW_BODY_CLASS = "bst-mood-preview-open";
const EDIT_STATS_BACKDROP_CLASS = "bst-edit-backdrop";
const EDIT_STATS_MODAL_CLASS = "bst-edit-modal";
const MAX_EDIT_LAST_THOUGHT_CHARS = 600;
let moodPreviewKeyListener: ((event: KeyboardEvent) => void) | null = null;
let moodPreviewOpenedAt = 0;
type AutoCardColorAssignment = {
  hue: number;
  color: string;
  seenAt: number;
};
const autoCardColorAssignments = new Map<string, AutoCardColorAssignment>();
const AUTO_CARD_COLOR_CACHE_LIMIT = 300;
const AUTO_CARD_MIN_HUE_DISTANCE = 24;

function toPercent(value: StatValue): number {
  if (typeof value === "number") return Math.max(0, Math.min(100, value));
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function moodToEmojiEntity(moodRaw: string): string {
  const mood = moodRaw.toLowerCase();
  if (mood.includes("happy") || mood.includes("excited")) return "&#x1F604;";
  if (mood.includes("content")) return "&#x1F642;";
  if (mood.includes("hopeful")) return "&#x1F91E;";
  if (mood.includes("playful")) return "&#x1F60F;";
  if (mood.includes("serious")) return "&#x1F610;";
  if (mood.includes("shy")) return "&#x1F60A;";
  if (mood.includes("in love")) return "&#x1F60D;";
  if (mood.includes("anxious")) return "&#x1F61F;";
  if (mood.includes("confused")) return "&#x1F615;";
  if (mood.includes("angry")) return "&#x1F620;";
  if (mood.includes("frustrated")) return "&#x1F624;";
  if (mood.includes("sad") || mood.includes("lonely")) return "&#x1F614;";
  return "&#x1F636;";
}

function normalizeHexColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return null;
  const normalized = value.length === 3
    ? value.split("").map(char => char + char).join("")
    : value;
  return `#${normalized.toLowerCase()}`;
}

function hexToRgb(raw: string | null): { r: number; g: number; b: number } | null {
  if (!raw) return null;
  const normalized = normalizeHexColor(raw);
  if (!normalized) return null;
  const hex = normalized.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(value => Number.isNaN(value))) return null;
  return { r, g, b };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toHex = (value: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function mixRgb(base: { r: number; g: number; b: number }, target: { r: number; g: number; b: number }, amount: number): { r: number; g: number; b: number } {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: base.r + (target.r - base.r) * t,
    g: base.g + (target.g - base.g) * t,
    b: base.b + (target.b - base.b) * t,
  };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const toLinear = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildActionPalette(cardHex: string): {
  bg: string;
  border: string;
  text: string;
  hoverBg: string;
  hoverBorder: string;
  focus: string;
} {
  const base = hexToRgb(cardHex) ?? { r: 31, g: 32, b: 40 };
  const neutralDark = { r: 18, g: 21, b: 28 };
  const neutralLight = { r: 238, g: 242, b: 250 };
  const setAlpha = (hex: string, alpha: number): string => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
  };
  const lum = relativeLuminance(base);
  if (lum < 0.45) {
    const bg = mixRgb(base, neutralDark, 0.86);
    const hoverBg = mixRgb(base, neutralDark, 0.74);
    const border = mixRgb(base, neutralLight, 0.42);
    const hoverBorder = mixRgb(base, neutralLight, 0.58);
    const focus = mixRgb(base, neutralLight, 0.66);
    return {
      bg: setAlpha(rgbToHex(bg), 0.7),
      border: rgbToHex(border),
      text: "#f7f9ff",
      hoverBg: setAlpha(rgbToHex(hoverBg), 0.82),
      hoverBorder: rgbToHex(hoverBorder),
      focus: rgbToHex(focus),
    };
  }
  const bg = mixRgb(base, neutralLight, 0.84);
  const hoverBg = mixRgb(base, neutralLight, 0.92);
  const border = mixRgb(base, neutralDark, 0.36);
  const hoverBorder = mixRgb(base, neutralDark, 0.52);
  const focus = mixRgb(base, neutralDark, 0.68);
  return {
    bg: setAlpha(rgbToHex(bg), 0.78),
    border: rgbToHex(border),
    text: "#0f1523",
    hoverBg: setAlpha(rgbToHex(hoverBg), 0.9),
    hoverBorder: rgbToHex(hoverBorder),
    focus: rgbToHex(focus),
  };
}

function moodBadgeColor(moodRaw: string): string {
  const mood = moodRaw.toLowerCase();
  if (mood.includes("happy") || mood.includes("excited") || mood.includes("in love")) return "rgba(87, 214, 138, 0.25)";
  if (mood.includes("content") || mood.includes("hopeful") || mood.includes("playful")) return "rgba(89, 185, 255, 0.24)";
  if (mood.includes("frustrated") || mood.includes("angry") || mood.includes("sad") || mood.includes("lonely")) return "rgba(255, 120, 136, 0.25)";
  return "rgba(255,255,255,0.12)";
}

function normalizeMoodLabel(moodRaw: string): string | null {
  const cleaned = moodRaw.trim().toLowerCase();
  if (!cleaned) return null;
  const exact = MOOD_LABEL_LOOKUP.get(cleaned);
  if (exact) return exact;
  for (const label of MOOD_LABELS_BY_LENGTH) {
    const needle = label.toLowerCase();
    if (cleaned.includes(needle)) return label;
  }
  return null;
}

function normalizeMoodSource(raw: unknown): MoodSource {
  return raw === "st_expressions" ? "st_expressions" : "bst_images";
}

function getResolvedMoodSource(settings: BetterSimTrackerSettings, characterName: string, characterAvatar?: string): MoodSource {
  const fallback = normalizeMoodSource(settings.moodSource);
  const entry = resolveCharacterDefaultsEntry(settings, { name: characterName, avatar: characterAvatar });
  if (!Object.keys(entry).length) return fallback;
  const override = normalizeMoodSource(entry.moodSource);
  if (entry.moodSource === "bst_images" || entry.moodSource === "st_expressions") return override;
  return fallback;
}

function getResolvedCardColor(settings: BetterSimTrackerSettings, characterName: string, characterAvatar?: string): string | null {
  const entry = resolveCharacterDefaultsEntry(settings, { name: characterName, avatar: characterAvatar });
  if (!entry || typeof entry !== "object") return null;
  return normalizeHexColor((entry as Record<string, unknown>).cardColor);
}

function thoughtKey(messageIndex: number, characterName: string): string {
  return `${messageIndex}:${normalizeName(characterName)}`;
}

function shouldEnableThoughtExpand(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return normalized.length > 120 || normalized.includes("\n");
}

function renderThoughtMarkup(text: string, key: string, variant: "bubble" | "panel"): string {
  const expanded = expandedThoughtKeys.has(key);
  const expandable = shouldEnableThoughtExpand(text);
  const containerClass = variant === "bubble" ? "bst-mood-bubble" : "bst-thought";
  const textClass = variant === "bubble" ? "bst-mood-bubble-text" : "bst-thought-text";
  return `
    <div class="${containerClass}${expanded ? " bst-thought-expanded" : ""}" data-bst-thought-container="1" data-bst-thought-key="${escapeHtml(key)}">
      <span class="${textClass}">${escapeHtml(text)}</span>
      ${expandable ? `<button class="bst-thought-toggle" data-bst-action="toggle-thought" data-bst-thought-key="${escapeHtml(key)}" aria-expanded="${String(expanded)}">${expanded ? "Less" : "More"}</button>` : ""}
    </div>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeZoomPanOffset(position: number, zoom: number): number {
  return Math.round((50 - position) * (zoom - 1) * 100) / 100;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeStExpressionImageOptions(raw: unknown, fallback: StExpressionImageOptions): StExpressionImageOptions {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const zoom = toNumber(obj.zoom);
  const positionX = toNumber(obj.positionX);
  const positionY = toNumber(obj.positionY);
  return {
    zoom: clamp(zoom ?? fallback.zoom, 0.5, 3),
    positionX: clamp(positionX ?? fallback.positionX, 0, 100),
    positionY: clamp(positionY ?? fallback.positionY, 0, 100),
  };
}

function cloneCustomStatDefinition(definition: CustomStatDefinition): CustomStatDefinition {
  const kind = normalizeCustomStatKind(definition.kind);
  const enumOptions = normalizeCustomEnumOptions(definition.enumOptions);
  const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(definition.textMaxLength) || 120)));
  const booleanTrueLabel = String(definition.booleanTrueLabel ?? "enabled").trim().slice(0, 40) || "enabled";
  const booleanFalseLabel = String(definition.booleanFalseLabel ?? "disabled").trim().slice(0, 40) || "disabled";
  const resolveDefaultValue = (): number | string | boolean => {
    if (kind === "numeric") {
      return Math.max(0, Math.min(100, Math.round(Number(definition.defaultValue) || 50)));
    }
    if (kind === "boolean") {
      return typeof definition.defaultValue === "boolean" ? definition.defaultValue : false;
    }
    if (kind === "enum_single" && enumOptions.length > 0) {
      return resolveEnumOption(enumOptions, definition.defaultValue) ?? enumOptions[0];
    }
    const text = normalizeNonNumericTextValue(definition.defaultValue, textMaxLength);
    return text;
  };

  return {
    id: String(definition.id ?? "").trim().toLowerCase(),
    kind,
    label: String(definition.label ?? "").trim(),
    description: typeof definition.description === "string" ? definition.description : undefined,
    behaviorGuidance: typeof definition.behaviorGuidance === "string" ? definition.behaviorGuidance : undefined,
    defaultValue: resolveDefaultValue(),
    maxDeltaPerTurn: kind === "numeric"
      ? (definition.maxDeltaPerTurn === undefined ? undefined : Number(definition.maxDeltaPerTurn))
      : undefined,
    enumOptions: kind === "enum_single" ? enumOptions : undefined,
    booleanTrueLabel: kind === "boolean" ? booleanTrueLabel : undefined,
    booleanFalseLabel: kind === "boolean" ? booleanFalseLabel : undefined,
    textMaxLength: kind === "text_short" ? textMaxLength : undefined,
    track: Boolean(definition.track),
    showOnCard: Boolean(definition.showOnCard),
    showInGraph: kind === "numeric" && Boolean(definition.showInGraph),
    includeInInjection: Boolean(definition.includeInInjection),
    color: typeof definition.color === "string" ? definition.color : undefined,
    sequentialPromptTemplate: typeof definition.sequentialPromptTemplate === "string" ? definition.sequentialPromptTemplate : undefined,
  };
}

const DEFAULT_BUILT_IN_NUMERIC_STAT_UI: BuiltInNumericStatUiSettings = {
  affection: { showOnCard: true, showInGraph: true, includeInInjection: true },
  trust: { showOnCard: true, showInGraph: true, includeInInjection: true },
  desire: { showOnCard: true, showInGraph: true, includeInInjection: true },
  connection: { showOnCard: true, showInGraph: true, includeInInjection: true },
};

function cloneBuiltInNumericStatUi(settings: Partial<BuiltInNumericStatUiSettings> | null | undefined): BuiltInNumericStatUiSettings {
  const row = (key: keyof BuiltInNumericStatUiSettings): BuiltInNumericStatUiSettings[typeof key] => {
    const fallback = DEFAULT_BUILT_IN_NUMERIC_STAT_UI[key];
    const raw = settings?.[key];
    return {
      showOnCard: Boolean(raw?.showOnCard ?? fallback.showOnCard),
      showInGraph: Boolean(raw?.showInGraph ?? fallback.showInGraph),
      includeInInjection: Boolean(raw?.includeInInjection ?? fallback.includeInInjection),
    };
  };
  return {
    affection: row("affection"),
    trust: row("trust"),
    desire: row("desire"),
    connection: row("connection"),
  };
}

const BUILT_IN_STAT_LABELS: Record<"affection" | "trust" | "desire" | "connection" | "mood" | "lastThought", string> = {
  affection: "Affection",
  trust: "Trust",
  desire: "Desire",
  connection: "Connection",
  mood: "Mood",
  lastThought: "Last Thought",
};
const BUILT_IN_NUMERIC_STAT_KEY_LIST = ["affection", "trust", "desire", "connection"] as const;
const BUILT_IN_TRACKABLE_STAT_KEY_LIST = ["affection", "trust", "desire", "connection", "mood", "lastThought"] as const;

function toCustomStatSlug(label: string): string {
  const normalized = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!normalized) return "stat";
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `s_${normalized}`;
  return prefixed.slice(0, 32).replace(/_+$/g, "");
}

function suggestUniqueCustomStatId(base: string, existing: Set<string>): string {
  const root = (toCustomStatSlug(base) || "stat").slice(0, 32);
  if (!existing.has(root) && CUSTOM_STAT_ID_REGEX.test(root) && !RESERVED_CUSTOM_STAT_IDS.has(root)) {
    return root;
  }
  for (let i = 2; i < 10_000; i += 1) {
    const suffix = `_${i}`;
    const maxBaseLength = Math.max(1, 32 - suffix.length);
    const candidateRoot = root.slice(0, maxBaseLength).replace(/_+$/g, "") || "stat";
    const candidate = `${candidateRoot}${suffix}`;
    if (existing.has(candidate)) continue;
    if (!CUSTOM_STAT_ID_REGEX.test(candidate)) continue;
    if (RESERVED_CUSTOM_STAT_IDS.has(candidate)) continue;
    return candidate;
  }
  return `stat_${Date.now().toString().slice(-4)}`;
}

function stripHiddenReasoningBlocks(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<\s*(think|analysis|reasoning)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(think|analysis|reasoning)[^>]*>/gi, "")
    .trim();
}

function sanitizeGeneratedSequentialTemplate(raw: string): string {
  let text = stripHiddenReasoningBlocks(raw);
  if (!text) return "";

  const fenceMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim();
  }

  text = text
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/^sequential\s+prompt\s+override\s*:?\s*/i, "")
    .trim();

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1).trim();
  }

  // Prefer the generated bullet block when extra chatter appears.
  const bulletLines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("- "));
  if (bulletLines.length >= 3) {
    text = bulletLines.slice(0, 6).join("\n");
  }

  return text.slice(0, 20_000);
}

function sanitizeGeneratedCustomDescription(raw: string): string {
  let text = stripHiddenReasoningBlocks(raw);
  if (!text) return "";

  const fenceMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim();
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text) as { description?: unknown };
      if (typeof parsed.description === "string" && parsed.description.trim()) {
        text = parsed.description.trim();
      }
    } catch {
      // Ignore malformed JSON and continue with raw text cleanup.
    }
  }

  text = text
    .replace(/^description\s*[:\-]\s*/i, "")
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim();

  if (text.startsWith("- ")) {
    text = text.slice(2).trim();
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.slice(0, CUSTOM_STAT_DESCRIPTION_MAX_LENGTH).trim();
}

function sanitizeGeneratedBehaviorGuidance(raw: string): string {
  let text = stripHiddenReasoningBlocks(raw);
  if (!text) return "";

  const fenceMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim();
  }

  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map(line => `- ${line}`);

  if (lines.length) {
    return lines.join("\n").slice(0, 2000);
  }

  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return `- ${compact}`.slice(0, 2000);
}

function getGlobalStExpressionImageOptions(settings: BetterSimTrackerSettings): StExpressionImageOptions {
  return sanitizeStExpressionImageOptions(
    {
      zoom: settings.stExpressionImageZoom,
      positionX: settings.stExpressionImagePositionX,
      positionY: settings.stExpressionImagePositionY,
    },
    DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS,
  );
}

function getResolvedStExpressionImageOptions(
  settings: BetterSimTrackerSettings,
  characterName: string,
  characterAvatar?: string,
): StExpressionImageOptions {
  const globalOptions = getGlobalStExpressionImageOptions(settings);
  const entry = resolveCharacterDefaultsEntry(settings, { name: characterName, avatar: characterAvatar });
  const override = entry?.stExpressionImageOptions;
  if (!override || typeof override !== "object") return globalOptions;
  return sanitizeStExpressionImageOptions(override, globalOptions);
}

function toSpriteList(data: unknown): SpriteEntry[] {
  if (Array.isArray(data)) return data as SpriteEntry[];
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.sprites)) return record.sprites as SpriteEntry[];
    if (Array.isArray(record.data)) return record.data as SpriteEntry[];
  }
  return [];
}

function sanitizeExpressionLabel(value: string): string {
  return value.trim().toLowerCase();
}

function buildExpressionSpriteCache(list: SpriteEntry[]): CachedExpressionSprites {
  const byLabel: Record<string, string[]> = {};
  for (const item of list) {
    const label = sanitizeExpressionLabel(String(item.label ?? ""));
    const path = String(item.path ?? "").trim();
    if (!label || !path) continue;
    if (!Array.isArray(byLabel[label])) byLabel[label] = [];
    byLabel[label].push(path);
  }
  return { fetchedAt: Date.now(), byLabel };
}

function cacheKeyForCharacter(name: string): string {
  return name.trim().toLowerCase();
}

function getCachedExpressionSpriteUrl(characterName: string, expressionLabel: string): string | null {
  const cache = stExpressionCache.get(cacheKeyForCharacter(characterName));
  if (!cache) return null;
  const list = cache.byLabel[sanitizeExpressionLabel(expressionLabel)];
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  return first && first.trim() ? first.trim() : null;
}

function isExpressionCacheStale(characterName: string): boolean {
  const cache = stExpressionCache.get(cacheKeyForCharacter(characterName));
  if (!cache) return true;
  return Date.now() - cache.fetchedAt > ST_EXPRESSION_CACHE_TTL_MS;
}

function scheduleExpressionSpriteFetch(
  characterName: string,
  settings: BetterSimTrackerSettings,
  onRerender?: () => void,
): void {
  const key = cacheKeyForCharacter(characterName);
  if (!key || stExpressionFetchInFlight.has(key)) return;
  stExpressionFetchInFlight.add(key);
  fetch(`/api/sprites/get?name=${encodeURIComponent(characterName)}`, { method: "GET" })
    .then(response => {
      if (!response.ok) throw new Error(`status_${response.status}`);
      return response.json();
    })
    .then(data => {
      const list = toSpriteList(data);
      stExpressionCache.set(key, buildExpressionSpriteCache(list));
      logDebug(settings, "moodImages", "st.expressions.cache.update", { characterName, count: list.length });
      onRerender?.();
    })
    .catch(error => {
      logDebug(settings, "moodImages", "st.expressions.cache.error", {
        characterName,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      stExpressionFetchInFlight.delete(key);
    });
}

function getMappedExpressionLabel(
  settings: BetterSimTrackerSettings,
  characterName: string,
  moodLabel: MoodLabel,
  characterAvatar?: string,
): string {
  const entry = resolveCharacterDefaultsEntry(settings, { name: characterName, avatar: characterAvatar });
  const rawCharacterMap = entry?.moodExpressionMap as Record<string, unknown> | undefined;
  const readMappedValue = (map: Record<string, unknown> | undefined): string => {
    if (!map) return "";
    const direct = map[moodLabel];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const normalized = normalizeMoodLabel(key);
      if (normalized === moodLabel) return value.trim();
    }
    return "";
  };
  const characterOverride = readMappedValue(rawCharacterMap);
  if (characterOverride) return characterOverride;
  const rawGlobalMap = settings.moodExpressionMap as Record<string, unknown> | undefined;
  const globalOverride = readMappedValue(rawGlobalMap);
  if (globalOverride) return globalOverride;
  return DEFAULT_MOOD_EXPRESSION_MAP[moodLabel] ?? "neutral";
}

function getMoodImageUrl(
  settings: BetterSimTrackerSettings,
  characterName: string,
  moodRaw: string,
  characterAvatar: string | undefined,
  onRerender?: () => void,
): string | null {
  const entry = resolveCharacterDefaultsEntry(settings, { name: characterName, avatar: characterAvatar });
  const normalizedMood = (normalizeMoodLabel(moodRaw) ?? "Neutral") as MoodLabel;
  const source = getResolvedMoodSource(settings, characterName, characterAvatar);

  if (source === "bst_images") {
    const moodImages = entry?.moodImages as Record<string, string> | undefined;
    const url = moodImages?.[normalizedMood];
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }

  const expression = getMappedExpressionLabel(settings, characterName, normalizedMood, characterAvatar);
  const cachedUrl = getCachedExpressionSpriteUrl(characterName, expression);
  if (cachedUrl) return cachedUrl;
  if (isExpressionCacheStale(characterName)) {
    scheduleExpressionSpriteFetch(characterName, settings, onRerender);
  }
  logDebug(settings, "moodImages", "st.expressions.missing", { characterName, mood: normalizedMood, expression });
  return null;
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
}

function colorFromName(name: string): string {
  const seed = hslFromName(name);
  return hslToHex(seed.h, seed.s, seed.l);
}

function hslFromName(name: string): { h: number; s: number; l: number } {
  const hash = hashName(name);
  return {
    h: hash % 360,
    s: 46 + (hash % 22),
    l: 24 + ((hash >> 5) % 10),
  };
}

function hashName(name: string): number {
  let hash = 0;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s / 100, 0, 1);
  const light = clamp(l / 100, 0, 1);
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hPrime = hue / 60;
  const x = chroma * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime >= 0 && hPrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (hPrime >= 2 && hPrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (hPrime >= 4 && hPrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }
  const match = light - chroma / 2;
  return rgbToHex({
    r: (r1 + match) * 255,
    g: (g1 + match) * 255,
    b: (b1 + match) * 255,
  });
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function trimAutoCardColorAssignments(): void {
  const overflow = autoCardColorAssignments.size - AUTO_CARD_COLOR_CACHE_LIMIT;
  if (overflow <= 0) return;
  const toDrop = [...autoCardColorAssignments.entries()]
    .sort((a, b) => a[1].seenAt - b[1].seenAt)
    .slice(0, overflow);
  for (const [key] of toDrop) {
    autoCardColorAssignments.delete(key);
  }
}

function pickDistinctAutoHue(baseHue: number, takenHues: number[]): number {
  if (!takenHues.length) return baseHue;
  let bestHue = baseHue;
  let bestScore = -1;
  for (let i = 0; i < 360; i += 1) {
    const candidate = (baseHue + i * 137) % 360;
    const minDist = Math.min(...takenHues.map(hue => hueDistance(hue, candidate)));
    if (minDist > bestScore) {
      bestScore = minDist;
      bestHue = candidate;
    }
    if (minDist >= AUTO_CARD_MIN_HUE_DISTANCE) {
      return candidate;
    }
  }
  return bestHue;
}

function getStableAutoCardColor(name: string): string {
  const key = normalizeName(name);
  if (!key) return colorFromName(name);
  const now = Date.now();
  const existing = autoCardColorAssignments.get(key);
  if (existing) {
    existing.seenAt = now;
    return existing.color;
  }

  const hash = hashName(key);
  const baseHue = hash % 360;
  const saturation = 52 + ((hash >> 9) % 14); // 52..65
  const lightness = 24 + ((hash >> 13) % 10); // 24..33
  const takenHues = [...autoCardColorAssignments.values()].map(assignment => assignment.hue);
  const hue = pickDistinctAutoHue(baseHue, takenHues);
  const color = hslToHex(hue, saturation, lightness);
  autoCardColorAssignments.set(key, { hue, color, seenAt: now });
  trimAutoCardColorAssignments();
  return color;
}

function allocateCharacterColors(names: string[]): Record<string, string> {
  const unique = Array.from(new Set(names.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (!unique.length) return {};
  const out: Record<string, string> = {};

  for (const name of unique) {
    out[name] = getStableAutoCardColor(name);
  }
  return out;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.${ROOT_CLASS} {
  margin-top: 10px;
  display: grid;
  gap: 8px;
  pointer-events: auto;
}
.bst-loading {
  border: 1px solid rgba(255,255,255,0.16);
  background: linear-gradient(165deg, color-mix(in srgb, var(--bst-card) 86%, #ffffff 14%), color-mix(in srgb, var(--bst-card) 70%, #000 30%));
  border-radius: 12px;
  color: #f3f5f9;
  padding: 10px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.04) inset;
}
.bst-loading-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}
.bst-loading-sub {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.82;
}
.bst-loading-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.bst-loading-stop {
  min-width: 120px;
  padding: 8px 16px;
  font-weight: 600;
}
.bst-btn-danger {
  border-color: rgba(255,99,99,0.45);
  background: rgba(255,72,72,0.18);
  color: #fff;
}
.bst-btn-danger:hover {
  border-color: rgba(255,120,120,0.7);
  background: rgba(255,72,72,0.3);
}
.bst-loading-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.18);
  overflow: hidden;
}
.bst-loading-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--bst-accent), #ffd38f);
  transition: width 0.25s ease;
  min-width: 2px;
}
.bst-loading-track-indeterminate .bst-loading-fill {
  width: 42%;
  animation: bst-indeterminate-slide 1.1s ease-in-out infinite;
}
@keyframes bst-indeterminate-slide {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(30%); }
  100% { transform: translateX(230%); }
}
.bst-root-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.bst-root-actions .bst-root-action-main {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  padding: 5px 13px;
  border: 1px solid color-mix(in srgb, var(--bst-accent) 50%, rgba(255,255,255,0.30) 50%);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--bst-accent) 30%, transparent 70%), transparent 55%),
    linear-gradient(145deg, rgba(16,22,34,0.95), rgba(9,13,22,0.92));
  box-shadow:
    0 10px 20px rgba(0,0,0,0.30),
    0 0 0 1px rgba(255,255,255,0.05) inset,
    0 1px 0 rgba(255,255,255,0.08) inset;
  color: #f1f7ff;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.2px;
  text-shadow: 0 1px 0 rgba(0,0,0,0.45);
}
.bst-root-actions .bst-root-action-main:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 76%, rgba(255,255,255,0.24) 24%);
  filter: brightness(1.06);
  transform: translateY(-1px);
}
.bst-root-actions .bst-root-action-main:active {
  transform: translateY(1px);
}
.bst-root-actions .bst-root-action-icon {
  width: 14px;
  min-width: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  opacity: 0.95;
}
.bst-root-actions .bst-root-action-label {
  white-space: nowrap;
}
.bst-root-actions .bst-root-action-retrack {
  width: 32px;
  min-width: 32px;
  height: 32px;
  border-radius: 999px;
  padding: 0;
  font-size: 15px;
  line-height: 1;
  border: 1px solid color-mix(in srgb, var(--bst-accent) 72%, #ffffff 28%);
  background:
    radial-gradient(85% 85% at 28% 24%, rgba(255,255,255,0.28), transparent 48%),
    radial-gradient(circle at 70% 76%, color-mix(in srgb, var(--bst-accent) 32%, #0f1523 68%), #0f1523);
  box-shadow:
    0 10px 20px rgba(0,0,0,0.33),
    0 0 0 1px rgba(255,255,255,0.07) inset;
}
.bst-root-actions .bst-root-action-summary {
  width: 32px;
  min-width: 32px;
  height: 32px;
  border-radius: 999px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  border: 1px solid color-mix(in srgb, var(--bst-accent) 55%, #ffffff 45%);
  background:
    radial-gradient(86% 86% at 28% 24%, rgba(255,255,255,0.24), transparent 50%),
    linear-gradient(145deg, rgba(14,20,31,0.96), rgba(10,14,24,0.94));
  box-shadow:
    0 8px 18px rgba(0,0,0,0.30),
    0 0 0 1px rgba(255,255,255,0.06) inset;
}
.bst-root-actions .bst-root-action-summary:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 76%, #ffffff 24%);
  filter: brightness(1.07);
  transform: translateY(-1px);
}
.bst-root-actions .bst-root-action-summary:active {
  transform: translateY(1px);
}
.bst-root-actions .bst-root-action-summary.is-loading {
  cursor: progress;
  opacity: 0.86;
  filter: saturate(0.9);
  transform: none;
}
.bst-root-actions .bst-root-action-summary.is-loading:hover,
.bst-root-actions .bst-root-action-summary.is-loading:active {
  transform: none;
  filter: saturate(0.9);
}
.bst-root-actions .bst-root-action-summary.is-loading span {
  display: inline-block;
  animation: bst-summary-spin 1s linear infinite;
}
@keyframes bst-summary-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.bst-root-actions .bst-root-action-retrack:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 88%, #ffffff 12%);
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.bst-root-actions .bst-root-action-retrack:active {
  transform: translateY(1px);
}
.bst-root-actions .bst-root-action-retrack span {
  display: inline-block;
  transition: transform .18s ease;
}
.bst-root-actions .bst-root-action-retrack:hover span {
  transform: rotate(-38deg);
}
.bst-root-actions .bst-root-action-retrack:focus-visible,
.bst-root-actions .bst-root-action-summary:focus-visible,
.bst-root-actions .bst-root-action-main:focus-visible {
  outline: 2px solid rgba(125, 211, 252, 0.88);
  outline-offset: 1px;
}
.bst-card {
  position: relative;
  overflow: hidden;
  background: linear-gradient(165deg, color-mix(in srgb, var(--bst-card-local, var(--bst-card)) 88%, #ffffff 12%), color-mix(in srgb, var(--bst-card-local, var(--bst-card)) 72%, #000 28%));
  border: 1px solid color-mix(in srgb, var(--bst-card-local, var(--bst-accent)) 46%, #ffffff 54%);
  border-radius: var(--bst-radius);
  color: #fff;
  box-shadow: 0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.06) inset;
  padding: 11px 12px;
  transition: box-shadow .15s ease, transform .15s ease, border-color .2s ease;
}
.bst-card.bst-card-new {
  animation: bst-card-enter .26s ease-out;
}
@keyframes bst-card-enter {
  0% { opacity: 0; transform: translateY(6px) scale(0.985); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.bst-card-inactive {
  border-color: rgba(255,255,255,0.12);
  box-shadow: 0 4px 12px rgba(0,0,0,0.30), 0 0 0 1px rgba(255,255,255,0.03) inset;
}
.bst-card-inactive::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(5, 7, 12, 0.30);
  pointer-events: none;
}
.bst-card-inactive .bst-state {
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.9);
}
.bst-inactive-icon {
  margin-left: 6px;
  font-size: 12px;
  opacity: 0.8;
  display: inline-flex;
  align-items: center;
  transform: translateY(1px);
}
.bst-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
}
.bst-name {
  font-weight: 700;
  letter-spacing: 0.2px;
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bst-state {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  flex-shrink: 0;
}
.bst-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.bst-actions .bst-mini-btn {
  border-color: var(--bst-action-border, rgba(255,255,255,0.42));
  background: var(--bst-action-bg, linear-gradient(180deg, rgba(14, 18, 30, 0.92), rgba(10, 14, 24, 0.92)));
  color: var(--bst-action-text, #f6f8ff);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), 0 1px 0 rgba(255,255,255,0.04);
}
.bst-actions .bst-mini-btn:hover {
  border-color: var(--bst-action-border-hover, rgba(255,255,255,0.6));
  background: var(--bst-action-bg-hover, linear-gradient(180deg, rgba(18, 24, 38, 0.95), rgba(12, 16, 28, 0.95)));
  color: var(--bst-action-text-hover, var(--bst-action-text, #ffffff));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16), 0 2px 8px rgba(0,0,0,0.18);
}
.bst-actions .bst-mini-btn:focus-visible {
  outline: 2px solid var(--bst-action-focus, rgba(255,255,255,0.7));
  outline-offset: 2px;
}
.bst-mini-btn {
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 7px;
  padding: 2px 6px;
  background: rgba(16,21,32,0.8);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, transform .1s ease;
}
.bst-mini-btn:hover {
  border-color: rgba(255,255,255,0.42);
  background: rgba(22,28,42,0.92);
}
.bst-mini-btn:active {
  transform: translateY(1px);
}
.bst-mini-btn-icon {
  width: 24px;
  min-width: 24px;
  height: 24px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  text-align: center;
}
.bst-mini-btn-accent {
  border-color: color-mix(in srgb, var(--bst-accent) 55%, #ffffff 45%);
  background: color-mix(in srgb, var(--bst-accent) 22%, #131a28 78%);
}
.bst-mini-btn-accent:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 78%, #ffffff 22%);
  background: color-mix(in srgb, var(--bst-accent) 33%, #131a28 67%);
}
.bst-row { margin: 5px 0; }
.bst-row.bst-row-non-numeric {
  margin-top: 7px;
}
.bst-row.bst-row-non-numeric .bst-label {
  align-items: flex-start;
  gap: 8px;
}
.bst-row.bst-row-non-numeric .bst-label > span:first-child {
  min-width: 0;
}
.bst-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 2px;
  opacity: 0.93;
}
.bst-non-numeric-chip {
  display: inline-block;
  max-width: min(70%, 340px);
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--bst-stat-color, var(--bst-accent)) 60%, #ffffff 40%);
  background: color-mix(in srgb, var(--bst-stat-color, var(--bst-accent)) 18%, rgba(13, 18, 30, 0.9) 82%);
  color: #f5f9ff;
  font-size: 11px;
  line-height: 1.2;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
}
.bst-track {
  background: rgba(255,255,255,0.14);
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
}
.bst-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--bst-stat-color, var(--bst-accent)), color-mix(in srgb, var(--bst-stat-color, var(--bst-accent)) 65%, #ffd38f 35%));
  box-shadow: 0 0 10px color-mix(in srgb, var(--bst-stat-color, var(--bst-accent)) 70%, #ffffff 30%);
  transition: width 0.5s ease;
}
.bst-row.bst-row-changed .bst-track {
  animation: bst-stat-track-pulse .45s ease;
}
@keyframes bst-stat-track-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
  35% { box-shadow: 0 0 0 2px rgba(255,255,255,0.22); }
  100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
}
.bst-mood { margin-top: 10px; }
.bst-mood-emoji { font-size: 18px; line-height: 1; }
.bst-mood-wrap {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.bst-mood-wrap--image {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 14px;
  width: 100%;
  justify-content: center;
}
.bst-mood-image-frame {
  display: block;
  width: clamp(64px, 11vw, 84px);
  height: clamp(64px, 11vw, 84px);
  border-radius: clamp(12px, 3vw, 16px);
  justify-self: center;
  overflow: hidden;
  border: 2px solid color-mix(in srgb, var(--bst-card-local, var(--bst-accent)) 55%, #ffffff 45%);
  box-shadow: 0 12px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.25);
}
.bst-mood-image-trigger {
  display: inline-block !important;
  width: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: 100%;
  border: none !important;
  margin: 0;
  padding: 0 !important;
  background: transparent !important;
  color: inherit !important;
  line-height: 0;
  appearance: none;
  touch-action: manipulation;
  cursor: zoom-in !important;
  border-radius: clamp(12px, 3vw, 16px);
}
.bst-mood-image-trigger:focus-visible {
  outline: 2px solid rgba(125, 211, 252, 0.85);
  outline-offset: 2px;
}
.bst-mood-image-trigger .bst-mood-image-frame {
  display: block;
}
.bst-mood-image-frame--st-expression {
  --bst-st-expression-zoom: 1.2;
  --bst-st-expression-pos-x: 50%;
  --bst-st-expression-pos-y: 20%;
}
.bst-mood-image {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  object-fit: cover;
  object-position: center center;
  display: block;
  cursor: zoom-in;
}
.bst-mood-image--st-expression {
  object-position: center center;
  transform-origin: center center;
}
.bst-mood-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.10);
}
.bst-mood-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bst-card-local, var(--bst-accent)) 16%, rgba(255,255,255,0.12) 84%);
  border: 1px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2), 0 6px 16px rgba(0,0,0,0.28);
}
.bst-mood-bubble {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 56px;
  padding: 10px 16px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.28);
  background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), 0 10px 20px rgba(0,0,0,0.26);
  font-size: 13px;
  max-width: 520px;
  color: rgba(255,255,255,0.9);
  text-align: left;
}
.bst-mood-bubble-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bst-thought.bst-thought-expanded .bst-thought-text,
.bst-mood-bubble.bst-thought-expanded .bst-mood-bubble-text {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
.bst-thought-toggle {
  margin-top: 8px;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px;
  background: rgba(10, 15, 24, 0.72);
  color: #ffffff;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  cursor: pointer;
}
.bst-thought-toggle:hover {
  border-color: rgba(255,255,255,0.5);
}
@media (max-width: 560px) {
  .bst-mood-wrap--image {
    grid-template-columns: 1fr;
    justify-items: center;
    gap: 10px;
  }
  .bst-mood-image-frame {
    width: clamp(78px, 26vw, 110px);
    height: clamp(78px, 26vw, 110px);
  }
  .bst-mood-bubble {
    text-align: center;
    min-height: 52px;
    max-width: 100%;
    align-items: center;
  }
}
.bst-delta {
  font-size: 10px;
  margin-left: 6px;
  opacity: 0.9;
}
.bst-delta-up { color: #94f7a8; }
.bst-delta-down { color: #ff9ea8; }
.bst-delta-flat { color: #d4d9e8; }
.bst-delta-up::before { content: "▲ "; }
.bst-delta-down::before { content: "▼ "; }
.bst-delta-flat::before { content: "• "; }
.bst-thought {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.3;
  padding: 8px;
  border-radius: 10px;
  background: rgba(0,0,0,0.18);
  font-style: italic;
  color: rgba(243,245,249,0.78);
  display: flex;
  flex-direction: column;
}
.bst-thought-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bst-empty {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 11px;
  color: rgba(243,245,249,0.68);
  background: rgba(0,0,0,0.16);
  border: 1px dashed rgba(255,255,255,0.18);
}
.bst-root-collapsed .bst-body {
  display: none;
}
.bst-collapsed-summary {
  display: none;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.92;
  align-items: center;
  gap: 8px;
}
.bst-root-collapsed .bst-collapsed-summary {
  display: flex;
}
.bst-collapsed-mood {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  font-size: 14px;
}
.bst-settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.46);
  z-index: 2147483000;
  pointer-events: auto;
}
.bst-settings {
  position: fixed;
  z-index: 2147483001;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(820px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  background:
    radial-gradient(1300px 460px at 0% 0%, rgba(255, 98, 123, 0.14), transparent 62%),
    radial-gradient(980px 360px at 100% 0%, rgba(86, 189, 255, 0.14), transparent 58%),
    #121621;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  color: #fff;
  padding: 16px 16px 18px;
  pointer-events: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable both-edges;
  font-family: "Segoe UI", "Trebuchet MS", sans-serif;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.bst-settings h3 { margin: 0 0 4px 0; font-size: 20px; letter-spacing: 0.2px; }
.bst-settings-top {
  position: sticky;
  top: -16px;
  z-index: 5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin: -16px -16px 12px;
  padding: 12px 16px;
  background: linear-gradient(180deg, rgba(18, 24, 38, 0.96), rgba(18, 24, 38, 0.86));
  border-bottom: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(6px);
}
.bst-settings-top-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.bst-settings-subtitle { margin: 0; opacity: 0.84; font-size: 12px; color: rgba(220, 235, 255, 0.88); }
.bst-settings-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bst-settings-grid-compact { gap: 8px; }
.bst-settings-grid-single { grid-template-columns: minmax(0, 1fr); }
.bst-settings-grid .bst-check-grid {
  grid-column: 1 / -1;
}
.bst-settings-grid .bst-toggle-help {
  grid-column: 1 / -1;
  margin-top: -4px;
}
.bst-check-grid {
  display: grid;
  column-gap: 22px;
  row-gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.bst-toggle-block {
  margin-top: 8px;
}
.bst-check-grid-single { grid-template-columns: minmax(0, 1fr); }
.bst-mood-advanced-settings { margin-top: 8px; }
.bst-st-expression-control {
  display: grid;
  gap: 8px;
}
.bst-st-expression-summary {
  margin: 0;
  opacity: 0.82;
}
.bst-check-grid .bst-check {
  margin: 0;
  align-items: center;
  min-height: 30px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(11, 16, 27, 0.58);
  border-radius: 10px;
  padding: 6px 10px;
}
.bst-check-grid .bst-check:hover {
  border-color: rgba(168, 203, 245, 0.32);
  background: rgba(14, 20, 33, 0.72);
}
.bst-settings label,
.bst-custom-wizard label { font-size: 12px; display: flex; flex-direction: column; gap: 6px; color: rgba(241, 246, 255, 0.94); }
.bst-check { flex-direction: row !important; align-items: center; gap: 10px !important; }
.bst-check input[type="checkbox"] {
  appearance: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 19px;
  width: 19px;
  height: 19px;
  min-width: 19px;
  margin: 0;
  border-radius: 999px;
  border: 1px solid rgba(188, 212, 242, 0.55);
  background: linear-gradient(180deg, rgba(16, 27, 44, 0.88), rgba(10, 17, 30, 0.92));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 0 rgba(88, 173, 248, 0.0);
  position: relative;
  transition: border-color .16s ease, background-color .16s ease, box-shadow .16s ease, transform .12s ease;
  cursor: pointer;
}
.bst-check input[type="checkbox"]::before {
  content: "";
  display: block;
  width: 5px;
  height: 9px;
  border-right: 2px solid #0b1020;
  border-bottom: 2px solid #0b1020;
  transform: translate(-0.5px, -1px) rotate(45deg) scale(0);
  transform-origin: center;
  opacity: 0;
  transition: transform .14s ease, opacity .14s ease;
}
.bst-check input[type="checkbox"]:hover {
  border-color: rgba(206, 225, 249, 0.75);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 0 2px rgba(86, 180, 255, 0.18);
}
.bst-check input[type="checkbox"]:focus-visible {
  outline: 2px solid rgba(120, 214, 255, 0.56);
  outline-offset: 2px;
}
.bst-check input[type="checkbox"]:checked {
  border-color: color-mix(in srgb, var(--bst-accent) 66%, #d7edff 34%);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bst-accent) 62%, #9fd8ff 38%),
    color-mix(in srgb, var(--bst-accent) 78%, #4eaef0 22%)
  );
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 0 2px rgba(86, 180, 255, 0.22);
}
.bst-check input[type="checkbox"]:checked::before {
  opacity: 1;
  transform: translate(-0.5px, -1px) rotate(45deg) scale(1);
}
.bst-check input[type="checkbox"]:active {
  transform: scale(0.94);
}
.bst-settings input:not([type="checkbox"]), .bst-settings select, .bst-settings textarea,
.bst-custom-wizard input:not([type="checkbox"]), .bst-custom-wizard select, .bst-custom-wizard textarea {
  background: #0d1220 !important;
  color: #f3f5f9 !important;
  border: 1px solid rgba(255,255,255,0.20) !important;
  border-radius: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease;
}
.bst-settings input:not([type="checkbox"]),
.bst-settings select,
.bst-custom-wizard input:not([type="checkbox"]),
.bst-custom-wizard select {
  min-height: 36px;
}
.bst-settings input:not([type="checkbox"]):hover,
.bst-settings select:hover,
.bst-settings textarea:hover,
.bst-custom-wizard input:not([type="checkbox"]):hover,
.bst-custom-wizard select:hover,
.bst-custom-wizard textarea:hover {
  border-color: rgba(168, 203, 245, 0.48) !important;
  background: #101728 !important;
}
.bst-settings input:not([type="checkbox"]):focus-visible,
.bst-settings select:focus-visible,
.bst-settings textarea:focus-visible,
.bst-custom-wizard input:not([type="checkbox"]):focus-visible,
.bst-custom-wizard select:focus-visible,
.bst-custom-wizard textarea:focus-visible {
  outline: none;
  border-color: rgba(56,189,248,0.9) !important;
  box-shadow: 0 0 0 2px rgba(56,189,248,0.25);
}
.bst-settings label:focus-within,
.bst-custom-wizard label:focus-within {
  color: #e6f6ff;
}
.bst-settings textarea,
.bst-custom-wizard textarea {
  resize: vertical;
  min-height: 120px;
  font-family: Consolas, "Courier New", monospace;
  line-height: 1.35;
}
.bst-settings input::placeholder,
.bst-settings textarea::placeholder,
.bst-custom-wizard input::placeholder,
.bst-custom-wizard textarea::placeholder { color: rgba(243,245,249,0.6); }
.bst-settings-section {
  margin: 10px 0;
  padding: 12px 12px 13px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.12);
  background: linear-gradient(180deg, rgba(11, 15, 25, 0.62), rgba(8, 11, 19, 0.56));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease;
}
.bst-settings-section:hover {
  border-color: rgba(148, 189, 235, 0.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 24px rgba(2, 6, 12, 0.28);
}
.bst-color-inputs {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  gap: 8px;
  width: 100%;
}
.bst-color-inputs input[type="color"] {
  width: 42px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(10,14,22,0.9);
}
.bst-color-inputs input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.bst-color-inputs input[type="color"]::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
.bst-color-inputs input[type="color"]::-moz-color-swatch {
  border: none;
  border-radius: 4px;
}
.bst-color-inputs input[type="text"] {
  flex: 1 1 auto;
  min-width: 120px;
}
.bst-quick-help {
  background: linear-gradient(135deg, rgba(10, 18, 32, 0.75), rgba(8, 12, 22, 0.75));
  border-color: rgba(56,189,248,0.25);
  box-shadow: inset 0 0 0 1px rgba(56,189,248,0.12);
}
.bst-quick-help .bst-help-line,
.bst-quick-help .bst-help-list {
  opacity: 0.95;
}
.bst-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(18, 24, 36, 0.6), rgba(10, 14, 22, 0.6));
  border: 1px solid rgba(255,255,255,0.08);
  position: relative;
  padding-left: 16px;
}
.bst-section-head::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(56,189,248,0.85), rgba(14,116,144,0.8));
  box-shadow: 0 0 8px rgba(56,189,248,0.25);
}
.bst-section-head:hover {
  background: linear-gradient(135deg, rgba(22, 30, 44, 0.75), rgba(12, 18, 28, 0.75));
  border-color: rgba(255,255,255,0.16);
}
.bst-section-head[aria-expanded="true"] {
  border-color: rgba(148, 189, 235, 0.32);
}
.bst-section-head:focus-visible {
  outline: 2px solid rgba(125, 211, 252, 0.6);
  outline-offset: 2px;
}
.bst-settings-section h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  opacity: 0.9;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.bst-header-icon {
  font-size: 12px;
  opacity: 0.85;
}
.bst-section-toggle {
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  background: rgba(14,18,28,0.8);
  color: #fff;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.bst-section-toggle:hover {
  border-color: rgba(255,255,255,0.4);
  background: rgba(20,26,38,0.9);
}
.bst-section-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  line-height: 1;
  font-size: 18px;
  transition: transform .16s ease, color .16s ease;
  color: rgba(243,245,249,0.9);
  transform: rotate(0deg);
}
.bst-section-head:hover .bst-section-icon {
  color: #ffffff;
}
.bst-section-collapsed .bst-section-icon {
  transform: rotate(-90deg);
}
.bst-section-collapsed .bst-section-body {
  display: none;
}
.bst-section-body {
  margin-top: 10px;
}
.bst-section-divider {
  position: relative;
  margin: 10px 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.35px;
  opacity: 0.8;
  display: flex;
  align-items: center;
  gap: 10px;
  grid-column: 1 / -1;
}
.bst-section-divider::before,
.bst-section-divider::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.2), rgba(255,255,255,0.06));
}
.bst-minmax {
  display: inline-block;
  margin-left: 8px;
  font-size: 11px;
  opacity: 0.65;
}
.bst-validation {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #fbbf24;
  opacity: 0.95;
}
.bst-help-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  opacity: 0.92;
}
.bst-help-line {
  font-size: 12px;
  opacity: 0.9;
}
.bst-help-details {
  margin: 6px 0 10px;
}
.bst-help-details summary {
  cursor: pointer;
  font-size: 12px;
  opacity: 0.85;
}
.bst-prompts-stack {
  margin-top: 8px;
}
.bst-prompt-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}
.bst-prompt-caption {
  font-size: 12px;
  opacity: 0.8;
}
.bst-prompt-protocol {
  margin: 0;
  white-space: pre-wrap;
  background: #0b1020;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  padding: 8px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(243,245,249,0.75);
}
.bst-protocol-editable-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bst-protocol-editable-wrap .bst-prompt-reset {
  align-self: flex-start;
}
.bst-prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(12,16,26,0.45);
  border: 1px solid rgba(255,255,255,0.08);
}
.bst-prompt-body {
  margin-top: 6px;
}
.bst-prompt-title {
  font-weight: 600;
  letter-spacing: 0.2px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bst-prompt-icon {
  font-size: 12px;
  opacity: 0.85;
}
.bst-prompt-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 18px;
  line-height: 1;
  margin-left: auto;
  color: rgba(243,245,249,0.9);
  transition: transform .16s ease, color .16s ease;
  transform: rotate(0deg);
}
.bst-prompt-head:hover .bst-prompt-toggle {
  color: #ffffff;
}
.bst-prompt-group.collapsed .bst-prompt-toggle {
  transform: rotate(-90deg);
}
.bst-prompt-group.collapsed .bst-prompt-body {
  display: none;
}
.bst-prompt-reset {
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  background: rgba(14,18,28,0.8);
  color: #fff;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.bst-prompt-reset:hover {
  border-color: rgba(255,255,255,0.45);
  background: rgba(20,26,38,0.9);
}
.bst-prompt-generate {
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  background: rgba(14,18,28,0.8);
  color: #fff;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, opacity .16s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.bst-prompt-generate:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 68%, #ffffff 32%);
  background: color-mix(in srgb, var(--bst-accent) 20%, rgba(20,26,38,0.9) 80%);
}
.bst-prompt-generate[data-loading="true"] {
  cursor: wait;
}
.bst-prompt-generate[data-loading="true"] .fa-solid {
  animation: bst-spin 0.9s linear infinite;
}
.bst-prompt-generate:disabled {
  opacity: 0.82;
}
.bst-prompt-ai-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bst-prompt-ai-status {
  font-size: 11px;
  opacity: 0.8;
  line-height: 1.35;
}
.bst-prompt-ai-status[data-state="loading"] {
  opacity: 1;
  color: #d4ecff;
}
.bst-prompt-ai-status[data-state="success"] {
  opacity: 1;
  color: #c4ffd4;
}
.bst-prompt-ai-status[data-state="error"] {
  opacity: 1;
  color: #ffcaca;
}
.bst-injection-prompt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  grid-column: 1 / -1;
}
.bst-prompt-inline .bst-prompt-head {
  border-radius: 14px 14px 0 0;
}
.bst-prompt-inline .bst-prompt-body {
  border-radius: 0 0 14px 14px;
}
.bst-btn .bst-btn-icon-left {
  margin-right: 6px;
}
.bst-open-settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.bst-btn {
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 7px 10px;
  color: #fff;
  background: #23293a;
  cursor: pointer;
}
.bst-close-btn {
  min-width: 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
}
.bst-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  min-width: 34px;
  height: 34px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
}
.bst-btn-soft {
  border-color: color-mix(in srgb, var(--bst-accent) 45%, #ffffff 55%);
  background: color-mix(in srgb, var(--bst-accent) 16%, #1e2738 84%);
}
.bst-btn-danger {
  border-color: #d06a6a;
  color: #ffd2d2;
  background: #3a2020;
}
.bst-debug-actions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.bst-settings-footer {
  position: sticky;
  bottom: -18px;
  z-index: 5;
  margin: 12px -16px -18px;
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: linear-gradient(180deg, rgba(18, 24, 38, 0.72), rgba(18, 24, 38, 0.96));
  border-top: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(6px);
}
.bst-debug-box {
  margin-top: 8px;
  background: #0b1020;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  font-family: Consolas, "Courier New", monospace;
  font-size: 11px;
  white-space: pre-wrap;
}
.bst-custom-stats-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.bst-custom-stats-top-centered {
  justify-content: center;
}
.bst-custom-stats-list {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}
.bst-custom-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(11, 16, 27, 0.58);
}
.bst-custom-stat-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.bst-custom-stat-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.bst-custom-stat-id {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.08);
  font-size: 11px;
  font-family: Consolas, "Courier New", monospace;
  opacity: 0.9;
}
.bst-custom-stat-meta {
  font-size: 11px;
  opacity: 0.85;
}
.bst-custom-stat-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bst-custom-stat-flag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.08);
  font-size: 11px;
  opacity: 0.9;
}
.bst-custom-stat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bst-custom-stat-empty {
  border: 1px dashed rgba(255,255,255,0.2);
  border-radius: 10px;
  padding: 10px;
  text-align: center;
  font-size: 12px;
  opacity: 0.82;
  background: rgba(6, 10, 18, 0.44);
}
.bst-custom-wizard-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 2147483250;
}
.bst-custom-wizard {
  position: fixed;
  z-index: 2147483251;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(760px, calc(100vw - 20px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.18);
  background: linear-gradient(180deg, rgba(13, 19, 31, 0.98), rgba(9, 14, 24, 0.98));
  box-shadow: 0 20px 54px rgba(0,0,0,0.5);
  color: #f3f5f9;
  padding: 12px 12px 14px;
}
.bst-custom-wizard-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.bst-custom-wizard-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.bst-custom-wizard-step {
  font-size: 12px;
  opacity: 0.84;
}
.bst-custom-wizard-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.bst-custom-wizard-grid-single {
  grid-template-columns: minmax(0, 1fr);
}
.bst-custom-wizard-panel {
  display: none;
  margin-top: 8px;
}
.bst-custom-wizard-panel.is-active {
  display: block;
}
.bst-custom-wizard-error {
  display: none;
  margin-top: 8px;
  padding: 8px 9px;
  border-radius: 8px;
  border: 1px solid rgba(255,127,127,0.45);
  background: rgba(88, 19, 19, 0.5);
  color: #ffd6d6;
  font-size: 12px;
  white-space: pre-wrap;
}
.bst-custom-wizard-review {
  margin: 0;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(7, 11, 19, 0.7);
  font-family: Consolas, "Courier New", monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
}
.bst-custom-wizard-actions {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.bst-custom-wizard-actions .bst-btn {
  min-width: 96px;
}
.bst-custom-ai-row {
  margin-top: 8px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bst-custom-ai-btn {
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--bst-accent) 62%, #ffffff 38%);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--bst-accent) 26%, #182338 74%),
    color-mix(in srgb, var(--bst-accent) 14%, #111b2b 86%)
  );
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.10),
    0 6px 16px rgba(0,0,0,0.28);
  font-weight: 600;
  letter-spacing: 0.2px;
  padding-inline: 12px;
  transition: transform .14s ease, box-shadow .16s ease, border-color .16s ease, filter .16s ease;
}
.bst-custom-ai-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--bst-accent) 74%, #ffffff 26%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.14),
    0 9px 20px rgba(0,0,0,0.34),
    0 0 0 1px color-mix(in srgb, var(--bst-accent) 36%, transparent);
  filter: brightness(1.03);
}
.bst-custom-ai-btn:active:not(:disabled) {
  filter: brightness(0.98);
}
.bst-custom-ai-btn[data-loading="true"] {
  cursor: wait;
}
.bst-custom-ai-btn:disabled {
  opacity: 0.86;
}
.bst-custom-ai-btn .bst-custom-ai-btn-icon {
  margin-right: 6px;
  font-size: 12px;
  opacity: 0.95;
}
.bst-custom-ai-btn[data-loading="true"] .bst-custom-ai-btn-icon {
  animation: bst-spin 0.9s linear infinite;
}
@keyframes bst-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.bst-custom-ai-status {
  font-size: 12px;
  opacity: 0.84;
  line-height: 1.35;
}
.bst-custom-ai-status[data-state="loading"] {
  opacity: 1;
  color: #d4ecff;
}
.bst-custom-ai-status[data-state="success"] {
  opacity: 1;
  color: #c4ffd4;
}
.bst-custom-ai-status[data-state="error"] {
  opacity: 1;
  color: #ffcaca;
}
.bst-custom-char-counter {
  margin-top: 4px;
  text-align: right;
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.72;
  color: rgba(241, 246, 255, 0.88);
}
.bst-custom-char-counter[data-state="warn"] {
  opacity: 1;
  color: #ffe08a;
}
.bst-custom-char-counter[data-state="limit"] {
  opacity: 1;
  color: #ffb3b3;
}
.bst-edit-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 10, 18, 0.72);
  z-index: 2147483008;
  display: grid;
  place-items: center;
  padding: 12px;
}
.bst-edit-modal {
  width: min(760px, calc(100vw - 20px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  background: linear-gradient(160deg, rgba(18, 23, 34, 0.98), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  padding: 16px;
  color: #f3f5f9;
  box-shadow: 0 18px 44px rgba(0,0,0,0.45);
}
.bst-edit-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.bst-edit-title {
  font-size: 16px;
  font-weight: 700;
}
.bst-edit-sub {
  font-size: 12px;
  opacity: 0.78;
  margin-bottom: 12px;
}
.bst-edit-grid {
  display: grid;
  gap: 10px;
}
.bst-edit-grid.bst-edit-grid-two {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.bst-edit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: rgba(241, 246, 255, 0.94);
}
.bst-edit-field input,
.bst-edit-field select,
.bst-edit-field textarea {
  width: 100%;
}
.bst-edit-modal input,
.bst-edit-modal select,
.bst-edit-modal textarea {
  background: #0d1220;
  color: #f3f5f9;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  box-sizing: border-box;
  padding: 8px 10px;
  transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease;
}
.bst-edit-modal input:hover,
.bst-edit-modal select:hover,
.bst-edit-modal textarea:hover {
  border-color: rgba(168, 203, 245, 0.48);
  background: #101728;
}
.bst-edit-modal input:focus-visible,
.bst-edit-modal select:focus-visible,
.bst-edit-modal textarea:focus-visible {
  outline: none;
  border-color: rgba(56,189,248,0.9);
  box-shadow: 0 0 0 2px rgba(56,189,248,0.25);
}
.bst-edit-modal input::placeholder,
.bst-edit-modal textarea::placeholder {
  color: rgba(243,245,249,0.6);
}
.bst-edit-divider {
  margin: 10px 0;
  height: 1px;
  background: rgba(255,255,255,0.12);
}
.bst-edit-actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.bst-graph-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2147483010;
}
.bst-graph-modal {
  position: fixed;
  z-index: 2147483011;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(860px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  overflow: auto;
  background: #121621;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  padding: 14px;
  color: #fff;
}
.bst-mood-preview-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(0,0,0,0.72);
  z-index: 2147483646;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  opacity: 1;
  animation: bst-fade-in .16s ease forwards;
}
.bst-mood-preview-dialog {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  width: 100vw;
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  padding: 12px;
  border: 0;
  background: transparent;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  z-index: 2147483647;
  animation: bst-fade-in .16s ease forwards;
}
.bst-mood-preview-dialog::backdrop {
  background: rgba(0,0,0,0.72);
}
.bst-mood-preview-modal {
  position: relative;
  z-index: 2147483647;
  isolation: isolate;
  width: min(960px, 94vw);
  max-height: calc(100dvh - 24px);
  display: grid;
  grid-template-rows: auto auto;
  place-items: center;
  gap: 10px;
  transform: none;
  animation: bst-modal-in .16s ease forwards;
}
.bst-mood-preview-image {
  max-width: 100%;
  max-height: calc(100dvh - 24px);
  object-fit: contain;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.2);
  box-shadow: 0 20px 64px rgba(0,0,0,0.56);
  cursor: zoom-out;
}
.bst-mood-preview-close {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 6px;
  width: 38px;
  height: 38px;
  min-width: 38px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.38);
  background: rgba(10,12,16,0.68);
  color: #fff;
  font-size: 22px;
  line-height: 1;
  touch-action: manipulation;
  cursor: pointer;
}
.bst-mood-preview-caption {
  font-size: 12px;
  color: rgba(244, 247, 255, 0.92);
  background: rgba(10,12,16,0.52);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 999px;
  padding: 6px 12px;
}
.bst-mood-preview-backdrop.is-closing {
  animation: bst-fade-out .14s ease forwards;
}
.bst-mood-preview-backdrop.is-closing .bst-mood-preview-modal {
  animation: bst-modal-out .14s ease forwards;
}
.bst-mood-preview-open {
  overflow: hidden !important;
}
@keyframes bst-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes bst-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes bst-modal-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes bst-modal-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(8px) scale(0.985); }
}
.bst-graph-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.bst-graph-title {
  font-size: 15px;
  font-weight: 700;
}
.bst-graph-controls {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 8px;
}
.bst-graph-window-select {
  background: #0d1220;
  color: #f3f5f9;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 8px;
  padding: 4px 6px;
}
.bst-graph-window-select.active {
  border-color: color-mix(in srgb, var(--bst-accent) 70%, #ffffff 30%);
  box-shadow: 0 0 0 2px rgba(56,189,248,0.2);
}
.bst-graph-canvas {
  position: relative;
}
.bst-graph-svg {
  width: 100%;
  height: 320px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  background: #0d1220;
}
.bst-graph-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(8, 12, 20, 0.95);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 11px;
  color: #f3f5f9;
  box-shadow: 0 6px 16px rgba(0,0,0,0.25);
  opacity: 0;
  transition: opacity .12s ease;
}
.bst-graph-tooltip.visible {
  opacity: 1;
}
.bst-graph-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.92;
  user-select: none;
}
.bst-graph-toggle input {
  display: none;
}
.bst-graph-toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.32);
  transition: background .18s ease, border-color .18s ease;
}
.bst-graph-toggle-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  transition: transform .18s ease;
}
.bst-graph-toggle input:checked + .bst-graph-toggle-switch {
  background: color-mix(in srgb, var(--bst-accent) 60%, #22314d 40%);
  border-color: color-mix(in srgb, var(--bst-accent) 72%, #ffffff 28%);
}
.bst-graph-toggle input:checked + .bst-graph-toggle-switch::after {
  transform: translateX(16px);
}
.bst-graph-legend {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  font-size: 11px;
  flex-wrap: wrap;
}
.bst-graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.bst-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  display: inline-block;
}
.bst-character-panel {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: linear-gradient(155deg, rgba(19,24,36,0.78), rgba(14,18,28,0.95));
  color: #f1f3f8;
  display: grid;
  gap: 10px;
}
.bst-character-title {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.2px;
}
.bst-character-sub {
  font-size: 12px;
  opacity: 0.8;
}
.bst-character-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.bst-character-grid-three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.bst-character-grid label {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bst-character-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.bst-character-st-tools {
  display: grid;
  gap: 8px;
}
.bst-character-panel input[type="text"],
.bst-character-panel input[type="number"],
.bst-character-panel select {
  background: rgba(16,20,30,0.7);
  border: 1px solid rgba(255,255,255,0.18);
  color: #f4f7ff;
  border-radius: 8px;
  padding: 6px 8px;
}
.bst-character-panel input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bst-accent) 70%, #ffffff 30%);
  outline-offset: 1px;
}
.bst-character-wide {
  grid-column: 1 / -1;
}
.bst-character-divider {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
  padding-top: 4px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.bst-character-help {
  font-size: 11px;
  opacity: 0.75;
}
.bst-character-help-compact {
  margin: 0;
}
.bst-character-map {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.bst-character-map-row {
  font-size: 11px;
  display: grid;
  gap: 4px;
}
.bst-character-warning {
  font-size: 11px;
  color: #ffb3bd;
}
.bst-character-moods {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}
.bst-mood-slot {
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 8px;
  background: rgba(12,16,24,0.7);
  display: grid;
  gap: 6px;
}
.bst-mood-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  overflow: hidden;
}
.bst-mood-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bst-mood-label {
  font-size: 11px;
  font-weight: 600;
}
.bst-mood-actions {
  display: grid;
  gap: 6px;
}
.bst-mood-actions .bst-btn {
  padding: 4px 8px;
  font-size: 11px;
}
.bst-mood-input {
  display: none;
}
.bst-character-actions {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 820px) {
  .bst-mini-btn {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 12px;
  }
  .bst-card {
    padding: 9px 10px;
  }
  .bst-head {
    gap: 6px;
    margin-bottom: 4px;
  }
  .bst-name {
    font-size: 13px;
  }
  .bst-state {
    font-size: 11px;
    padding: 1px 6px;
  }
  .bst-row {
    margin: 4px 0;
  }
  .bst-label {
    font-size: 11px;
  }
  .bst-row.bst-row-non-numeric .bst-label {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .bst-non-numeric-chip {
    max-width: 100%;
    margin-left: 0;
  }
  .bst-track {
    height: 7px;
  }
  .bst-actions {
    gap: 4px;
  }
  .bst-actions .bst-mini-btn {
    min-height: 28px;
    padding: 2px 6px;
    font-size: 11px;
  }
  .bst-actions .bst-graph-label {
    display: none;
  }
  .bst-root-action-main {
    padding: 3px 9px;
    font-size: 10px;
  }
  .bst-root-action-retrack {
    width: 28px;
    min-width: 28px;
    height: 28px;
  }
  .bst-root-action-summary {
    width: 28px;
    min-width: 28px;
    height: 28px;
  }
  .bst-mood-preview-backdrop {
    padding: calc(env(safe-area-inset-top, 0px) + 6px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
  }
  .bst-mood-preview-dialog {
    padding: calc(env(safe-area-inset-top, 0px) + 6px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
  }
  .bst-mood-preview-modal {
    width: min(100%, calc(100vw - 16px));
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 14px);
    gap: 8px;
  }
  .bst-mood-preview-image {
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 78px);
    border-radius: 10px;
  }
  .bst-mood-preview-close {
    top: calc(env(safe-area-inset-top, 0px) + 2px);
    right: 2px;
  }
  .bst-mood-preview-caption {
    font-size: 11px;
    padding: 5px 10px;
  }
  .bst-settings {
    left: 0;
    top: 0;
    transform: none;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 12px 10px 18px;
  }
  .bst-settings-top {
    top: -12px;
    margin: -12px -10px 12px;
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 10px 10px;
  }
  .bst-settings-top-actions {
    gap: 6px;
  }
  .bst-settings h3 {
    font-size: 18px;
  }
  .bst-close-btn {
    min-width: 40px;
    width: 40px;
    height: 40px;
    font-size: 20px;
  }
  .bst-settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .bst-character-grid-three {
    grid-template-columns: minmax(0, 1fr);
  }
  .bst-check-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .bst-settings label {
    font-size: 13px;
  }
  .bst-help-list,
  .bst-help-line {
    font-size: 13px;
  }
  .bst-settings input,
  .bst-settings select {
    font-size: 16px;
    padding: 9px 10px;
  }
  .bst-btn {
    min-height: 40px;
    font-size: 13px;
  }
  .bst-btn-icon {
    min-height: 40px;
    width: 40px;
    min-width: 40px;
  }
  .bst-debug-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .bst-settings-footer {
    bottom: -18px;
    margin: 12px -10px -18px;
    padding: 10px;
    justify-content: stretch;
  }
  .bst-settings-footer .bst-btn {
    flex: 1 1 0;
  }
  .bst-custom-stat-row {
    flex-direction: column;
  }
  .bst-custom-stat-actions {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bst-custom-wizard {
    left: 0;
    top: 0;
    transform: none;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 12px 10px 14px;
  }
  .bst-custom-wizard-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .bst-custom-wizard-actions {
    flex-wrap: wrap;
  }
  .bst-custom-wizard-actions .bst-btn {
    flex: 1 1 0;
  }
  .bst-graph-modal {
    left: 0;
    top: 0;
    transform: none;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 10px;
  }
  .bst-graph-top {
    align-items: center;
    gap: 8px;
  }
  .bst-graph-title {
    font-size: 14px;
  }
  .bst-graph-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .bst-graph-window-select {
    font-size: 16px;
    padding: 6px 8px;
  }
  .bst-graph-svg {
    height: 250px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bst-loading-track-indeterminate .bst-loading-fill,
  .bst-row.bst-row-changed .bst-track,
  .bst-card.bst-card-new,
  .bst-mood-preview-dialog,
  .bst-mood-preview-backdrop,
  .bst-mood-preview-modal,
  .bst-mood-preview-backdrop.is-closing,
  .bst-mood-preview-backdrop.is-closing .bst-mood-preview-modal {
    animation: none !important;
  }
  .bst-fill,
  .bst-card,
  .bst-mini-btn {
    transition: none !important;
  }
}
`;
  document.head.appendChild(style);
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

function findMessageContainer(messageIndex: number | null): HTMLElement | null {
  if (messageIndex == null) return null;
  const selectors = [
    `.mes[mesid="${messageIndex}"]`,
    `.mes[data-mesid="${messageIndex}"]`,
    `[mesid="${messageIndex}"]`,
    `[data-mesid="${messageIndex}"]`
  ];
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found instanceof HTMLElement) return found;
  }
  return null;
}

function getRoot(messageIndex: number | null): HTMLDivElement | null {
  const anchor = findMessageContainer(messageIndex);
  if (!anchor) return null;

  const indexKey = String(messageIndex);
  let root = document.querySelector(`.${ROOT_CLASS}[data-message-index="${indexKey}"]`) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement("div");
    root.className = ROOT_CLASS;
    root.dataset.messageIndex = indexKey;
  }

  const preferredMount =
    (anchor.querySelector(".mes_block") as HTMLElement | null) ??
    (anchor.querySelector(".mes_text") as HTMLElement | null) ??
    anchor;

  if (root.parentElement !== preferredMount) {
    preferredMount.appendChild(root);
  }
  return root;
}

export function renderTracker(
  entries: RenderEntry[],
  settings: BetterSimTrackerSettings,
  allCharacters: string[],
  isGroupChat: boolean,
  uiState: TrackerUiState,
  latestAiIndex: number | null,
  summaryBusyMessageIndices: Set<number> | undefined,
  resolveCharacterAvatar?: (characterName: string) => string | null,
  onOpenGraph?: (characterName: string) => void,
  onRetrackMessage?: (messageIndex: number) => void,
  onSendSummaryMessage?: (messageIndex: number) => void,
  onCancelExtraction?: () => void,
  onEditStats?: (payload: EditStatsPayload) => void,
  onRequestRerender?: () => void,
): void {
  ensureStyles();
  const palette = allocateCharacterColors(allCharacters);
  const sortedEntries = [...entries].sort((a, b) => a.messageIndex - b.messageIndex);
  const entryByIndex = new Map<number, TrackerData>();
  for (const entry of entries) {
    if (entry.data) {
      entryByIndex.set(entry.messageIndex, entry.data);
    }
  }
  const latestTrackedMessageIndex = [...sortedEntries].reverse().find(item => item.data)?.messageIndex ?? null;
  const findPreviousData = (messageIndex: number): TrackerData | null => {
    for (let i = sortedEntries.length - 1; i >= 0; i -= 1) {
      const candidate = sortedEntries[i];
      if (candidate.messageIndex >= messageIndex) continue;
      if (candidate.data) return candidate.data;
    }
    return null;
  };
  const wanted = new Set(entries.map(entry => String(entry.messageIndex)));

  document.querySelectorAll(`.${ROOT_CLASS}`).forEach(node => {
    const el = node as HTMLElement;
    const idx = String(el.dataset.messageIndex ?? "");
    if (!wanted.has(idx)) {
      el.remove();
    }
  });

  if (!settings.enabled) {
    return;
  }

  for (const entry of entries) {
    const root = getRoot(entry.messageIndex);
    if (!root) continue;

    root.style.setProperty("--bst-card", "#1f2028");
    root.style.setProperty("--bst-accent", settings.accentColor);
    root.style.setProperty("--bst-radius", `${settings.borderRadius}px`);
    root.style.opacity = `${settings.cardOpacity}`;
    root.style.fontSize = `${settings.fontSize}px`;
    root.style.display = "grid";

    if (!root.dataset.bstBound) {
      root.dataset.bstBound = "1";
      const openPreviewFromTarget = (target: EventTarget | null): boolean => {
        const node = target as HTMLElement | null;
        const preview = node?.closest('[data-bst-action="open-mood-preview"]') as HTMLElement | null;
        if (!preview) return false;
        const src = String(preview.getAttribute("data-bst-image-src") ?? "").trim();
        const alt = String(preview.getAttribute("data-bst-image-alt") ?? "").trim() || "Mood image";
        const character = String(preview.getAttribute("data-bst-image-character") ?? "").trim();
        const mood = String(preview.getAttribute("data-bst-image-mood") ?? "").trim();
        if (src) {
          openMoodImageModal(src, alt, character, mood);
        }
        return true;
      };
      root.addEventListener("click", event => {
        const target = event.target as HTMLElement | null;
        if (openPreviewFromTarget(target)) {
          return;
        }
        const thoughtToggle = target?.closest('[data-bst-action="toggle-thought"]') as HTMLElement | null;
        if (thoughtToggle) {
          const key = String(thoughtToggle.getAttribute("data-bst-thought-key") ?? "").trim();
          if (!key) return;
          const expanded = expandedThoughtKeys.has(key);
          if (expanded) {
            expandedThoughtKeys.delete(key);
          } else {
            expandedThoughtKeys.add(key);
          }
          root.dataset.bstRenderSignature = "";
          if (onRequestRerender) {
            onRequestRerender();
          } else {
            const container = root.querySelector(`[data-bst-thought-container="1"][data-bst-thought-key="${CSS.escape(key)}"]`) as HTMLElement | null;
            if (container) {
              container.classList.toggle("bst-thought-expanded", !expanded);
            }
            thoughtToggle.setAttribute("aria-expanded", String(!expanded));
            thoughtToggle.textContent = expanded ? "More" : "Less";
          }
          return;
        }
        const button = target?.closest('[data-bst-action="graph"]') as HTMLElement | null;
        if (button) {
          const name = String(button.getAttribute("data-character") ?? "").trim();
          if (!name) return;
          onOpenGraph?.(name);
          return;
        }
        const edit = target?.closest('[data-bst-action="edit-stats"]') as HTMLElement | null;
        if (edit) {
          const idx = Number(edit.getAttribute("data-bst-edit-message") ?? root.dataset.messageIndex);
          const character = String(edit.getAttribute("data-bst-edit-character") ?? "").trim();
          const data = Number.isNaN(idx) ? null : entryByIndex.get(idx) ?? null;
          if (!data || !character) return;
          openEditStatsModal({
            messageIndex: idx,
            character,
            data,
            settings,
            onSave: onEditStats,
          });
          return;
        }
        const retrack = target?.closest('[data-bst-action="retrack"]') as HTMLElement | null;
        if (retrack) {
          const idx = Number(root.dataset.messageIndex);
          if (!Number.isNaN(idx)) {
            onRetrackMessage?.(idx);
          }
          return;
        }
        const sendSummary = target?.closest('[data-bst-action="send-summary"]') as HTMLButtonElement | null;
        if (sendSummary) {
          if (sendSummary.disabled || sendSummary.dataset.loading === "true") {
            return;
          }
          const idx = Number(root.dataset.messageIndex);
          if (!Number.isNaN(idx)) {
            onSendSummaryMessage?.(idx);
          }
          return;
        }
        const collapse = target?.closest('[data-bst-action="toggle-all-collapse"]') as HTMLElement | null;
        if (collapse) {
          const idx = Number(root.dataset.messageIndex);
          if (Number.isNaN(idx)) return;
          const nextCollapsed = !root.classList.contains("bst-root-collapsed");
          root.classList.toggle("bst-root-collapsed", nextCollapsed);
          if (nextCollapsed) {
            collapsedTrackerMessages.add(idx);
          } else {
            collapsedTrackerMessages.delete(idx);
          }
          collapse.setAttribute("aria-expanded", String(!nextCollapsed));
          collapse.setAttribute("title", nextCollapsed ? "Expand cards" : "Collapse cards");
          collapse.innerHTML = nextCollapsed
            ? `<span class="bst-root-action-icon" aria-hidden="true">&#9656;</span><span class="bst-root-action-label">Expand cards</span>`
            : `<span class="bst-root-action-icon" aria-hidden="true">&#9662;</span><span class="bst-root-action-label">Collapse cards</span>`;
          root.dataset.bstRenderSignature = "";
          onRequestRerender?.();
          return;
        }
        const cancel = target?.closest('[data-bst-action="cancel-extraction"]') as HTMLElement | null;
        if (cancel) {
          onCancelExtraction?.();
          return;
        }
      });
      root.addEventListener("pointerup", event => {
        const pointer = event as PointerEvent;
        if (pointer.pointerType !== "touch") return;
        if (openPreviewFromTarget(event.target)) {
          event.preventDefault();
        }
      }, { passive: false });
    }
    root.classList.toggle("bst-root-collapsed", collapsedTrackerMessages.has(entry.messageIndex));

    if (uiState.phase === "generating" && uiState.messageIndex === entry.messageIndex) {
      root.dataset.bstRenderPhase = "generating";
      root.dataset.bstRenderSignature = "";
      root.innerHTML = "";
      const loadingBox = document.createElement("div");
      loadingBox.className = "bst-loading";
      loadingBox.innerHTML = `
        <div class="bst-loading-row">
          <span>AI message is generating</span>
          <span>running</span>
        </div>
        <div class="bst-loading-track bst-loading-track-indeterminate"><div class="bst-loading-fill"></div></div>
        <div class="bst-loading-sub">Tracker will run after generation finishes.</div>
      `;
      root.appendChild(loadingBox);
      continue;
    }

    if (uiState.phase === "extracting" && uiState.messageIndex === entry.messageIndex) {
      root.dataset.bstRenderPhase = "extracting";
      root.dataset.bstRenderSignature = "";
      root.innerHTML = "";
      const total = Math.max(1, uiState.total);
      const done = Math.max(0, Math.min(total, uiState.done));
      const ratio = Math.max(0, Math.min(1, done / total));
      const percent = Math.round(ratio * 100);
      const left = `stage ${Math.min(done + 1, total)}/${total}`;
      let title = uiState.stepLabel ?? "Preparing tracker context";
      let subtitle = "Collecting recent messages and active characters.";
      if (done === 1) {
        title = uiState.stepLabel ?? "Requesting relationship analysis";
        subtitle = "Sending extraction prompt to backend/profile.";
      } else if (done >= 2) {
        title = uiState.stepLabel ?? "Parsing and applying tracker update";
        subtitle = "Validating AI delta output and updating relationship state.";
      }
      if (uiState.stepLabel && uiState.stepLabel !== title) {
        subtitle = uiState.stepLabel;
      }
      const loadingBox = document.createElement("div");
      loadingBox.className = "bst-loading";
      loadingBox.innerHTML = `
        <div class="bst-loading-row">
          <span>${title}</span>
          <span>${left} (${percent}%)</span>
        </div>
        <div class="bst-loading-track"><div class="bst-loading-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
        <div class="bst-loading-sub">${subtitle}</div>
        <div class="bst-loading-actions">
          <button class="bst-btn bst-btn-danger bst-loading-stop" data-bst-action="cancel-extraction">Stop</button>
        </div>
      `;
      root.appendChild(loadingBox);
      continue;
    }

    const data = entry.data;
    if (!data) {
      root.style.display = "none";
      root.dataset.bstRenderPhase = "idle";
      root.dataset.bstRenderSignature = "";
      continue;
    }

    const showRetrack = latestAiIndex != null && entry.messageIndex === latestAiIndex;
    const summaryBusy = Boolean(showRetrack && summaryBusyMessageIndices?.has(entry.messageIndex));
    const collapsed = root.classList.contains("bst-root-collapsed");
    const activeSet = new Set(data.activeCharacters.map(normalizeName));
    const allNumericDefs = getNumericStatDefinitions(settings);
    const cardNumericDefs = allNumericDefs.filter(def => def.showOnCard);
    const allNonNumericDefs = getNonNumericStatDefinitions(settings);
    const cardNonNumericDefs = allNonNumericDefs.filter(def => def.showOnCard);
    const hasAnyStatFor = (name: string): boolean =>
      cardNumericDefs.some(def => hasNumericValue(data, def.key, name)) ||
      cardNonNumericDefs.some(def => hasNonNumericValue(data, def, name)) ||
      data.statistics.mood?.[name] !== undefined ||
      data.statistics.lastThought?.[name] !== undefined;
    const forceAllInGroup = isGroupChat;
    const displayPool =
      (forceAllInGroup || settings.showInactive) && allCharacters.length > 0
        ? allCharacters
        : data.activeCharacters;
    const displayOrder = new Map(displayPool.map((name, index) => [normalizeName(name), index]));
    const targets = Array.from(new Set(
      displayPool.filter(name => hasAnyStatFor(name) || activeSet.has(normalizeName(name)))
    ))
      .sort((a, b) => {
        const aActive = activeSet.has(normalizeName(a));
        const bActive = activeSet.has(normalizeName(b));
        if (aActive !== bActive) return aActive ? -1 : 1;
        const aOrder = displayOrder.get(normalizeName(a)) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = displayOrder.get(normalizeName(b)) ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.localeCompare(b);
      });

    const previousData = findPreviousData(entry.messageIndex);
    const cardHtmlByName: Array<{ name: string; html: string; isActive: boolean; isNew: boolean; cardColor: string }> = [];
    const signatureParts: string[] = [
      `msg:${entry.messageIndex}`,
      `collapsed:${collapsed ? "1" : "0"}`,
      `retrack:${showRetrack ? "1" : "0"}`,
      `summarybusy:${summaryBusy ? "1" : "0"}`,
      `inactive:${settings.showInactive ? "1" : "0"}`,
      `thought:${settings.showLastThought ? "1" : "0"}`,
      `inactivelabel:${settings.inactiveLabel}`,
      `scale:${settings.fontSize}|${settings.cardOpacity}`
    ];

    for (const name of targets) {
      const isActive = activeSet.has(normalizeName(name));
      if (!isActive && !settings.showInactive) continue;
      const displayName = name === USER_TRACKER_KEY ? "User" : name;
      const characterAvatar = resolveCharacterAvatar?.(name) ?? undefined;
      const enabledNumeric = getNumericStatsForCharacter(data, name, settings);
      const enabledNonNumeric = cardNonNumericDefs;
      const moodText = data.statistics.mood?.[name] !== undefined ? String(data.statistics.mood?.[name]) : "";
      const prevMood = previousData?.statistics.mood?.[name] !== undefined ? String(previousData.statistics.mood?.[name]) : moodText;
      const moodTrend = prevMood === moodText ? "stable" : "shifted";
      const canEdit = latestTrackedMessageIndex != null && entry.messageIndex === latestTrackedMessageIndex;
      const moodSource = moodText ? getResolvedMoodSource(settings, name, characterAvatar) : "bst_images";
      const stExpressionImageOptions = moodSource === "st_expressions"
        ? getResolvedStExpressionImageOptions(settings, name, characterAvatar)
        : null;
      const moodImage = moodText ? getMoodImageUrl(settings, name, moodText, characterAvatar, onRequestRerender) : null;
      const lastThoughtText = settings.showLastThought && data.statistics.lastThought?.[name] !== undefined
        ? String(data.statistics.lastThought?.[name] ?? "")
        : "";
      const thoughtUiKey = thoughtKey(entry.messageIndex, name);
      const stExpressionImageStyle = (() => {
        if (!stExpressionImageOptions) return "";
        const panX = computeZoomPanOffset(stExpressionImageOptions.positionX, stExpressionImageOptions.zoom);
        const panY = computeZoomPanOffset(stExpressionImageOptions.positionY, stExpressionImageOptions.zoom);
        return ` style="object-position:${stExpressionImageOptions.positionX.toFixed(2)}% ${stExpressionImageOptions.positionY.toFixed(2)}% !important;transform:translate(${panX.toFixed(2)}%, ${panY.toFixed(2)}%) scale(${stExpressionImageOptions.zoom.toFixed(2)}) !important;transform-origin:center center !important;"`;
      })();
      const collapsedSummary = enabledNumeric.map(def => {
        const value = toPercent(getNumericRawValue(data, def.key, name) ?? def.defaultValue);
        return `<span>${def.short} ${value}%</span>`;
      }).join("");
      const collapsedNonNumeric = enabledNonNumeric.map(def => {
        const value = resolveNonNumericValue(data, def, name);
        if (value == null) return "";
        const text = formatNonNumericForDisplay(def, value);
        return `<span>${escapeHtml(shortLabelFrom(def.label))} ${escapeHtml(text)}</span>`;
      }).filter(Boolean).join("");
      const showCollapsedMood = moodText !== "";
      const cardColor = getResolvedCardColor(settings, name, characterAvatar) ?? palette[name] ?? getStableAutoCardColor(name);
      const cardKey = `${entry.messageIndex}:${normalizeName(name)}`;
      const isNew = !renderedCardKeys.has(cardKey);
      renderedCardKeys.add(cardKey);
      const cardHtml = `
        <div class="bst-head">
          <div class="bst-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="bst-actions">
            <button class="bst-mini-btn" data-bst-action="graph" data-character="${name}" title="Open relationship graph"><span aria-hidden="true">&#128200;</span> <span class="bst-graph-label">Graph</span></button>
            ${canEdit ? `<button class="bst-mini-btn bst-mini-btn-icon" data-bst-action="edit-stats" data-bst-edit-message="${entry.messageIndex}" data-bst-edit-character="${escapeHtml(name)}" title="Edit last tracker stats for ${escapeHtml(displayName)}" aria-label="Edit last tracker stats for ${escapeHtml(displayName)}"><span aria-hidden="true">&#9998;</span></button>` : ""}
            <div class="bst-state" title="${isActive ? "Active" : settings.inactiveLabel}">${isActive ? "Active" : `${settings.inactiveLabel} <span class="fa-solid fa-ghost bst-inactive-icon" aria-hidden="true"></span>`}</div>
          </div>
        </div>
        ${enabledNumeric.length || enabledNonNumeric.length || showCollapsedMood ? `
        <div class="bst-collapsed-summary" title="Tracked stats">
          ${collapsedSummary || ""}
          ${collapsedNonNumeric || ""}
          ${showCollapsedMood ? `<span class="bst-collapsed-mood" title="${moodText}">${moodToEmojiEntity(moodText)}</span>` : ""}
        </div>` : ""}
        <div class="bst-body">
        ${enabledNumeric.map(({ key, label, color, defaultValue }) => {
          const defDefault = defaultValue ?? 50;
          const value = toPercent(getNumericRawValue(data, key, name) ?? defDefault);
          const prevValueRaw = previousData ? getNumericRawValue(previousData, key, name) : undefined;
          const hasPrevValue = prevValueRaw !== undefined;
          const prevValue = toPercent(hasPrevValue ? prevValueRaw : value);
          const delta = Math.round(value - prevValue);
          const deltaClass = delta > 0 ? "bst-delta bst-delta-up" : delta < 0 ? "bst-delta bst-delta-down" : "bst-delta bst-delta-flat";
          const showDelta = latestAiIndex != null && entry.messageIndex === latestAiIndex && hasPrevValue;
          const rowClass = showDelta && delta !== 0 ? "bst-row bst-row-changed" : "bst-row";
          return `
            <div class="${rowClass}">
              <div class="bst-label"><span>${label}</span><span>${value}%${showDelta ? `<span class="${deltaClass}">${formatDelta(delta)}</span>` : ""}</span></div>
              <div class="bst-track"><div class="bst-fill" style="width:${value}%;--bst-stat-color:${color};"></div></div>
            </div>
          `;
        }).join("")}
        ${enabledNonNumeric.map(def => {
          const resolved = resolveNonNumericValue(data, def, name);
          const displayValue = resolved == null ? "not set" : formatNonNumericForDisplay(def, resolved);
          const color = def.color || "#9bd5ff";
          return `
            <div class="bst-row bst-row-non-numeric">
              <div class="bst-label">
                <span>${escapeHtml(def.label)}</span>
                <span class="bst-non-numeric-chip" style="--bst-stat-color:${escapeHtml(color)};" title="${escapeHtml(displayValue)}">${escapeHtml(displayValue)}</span>
              </div>
            </div>
          `;
        }).join("")}
        ${moodText !== "" ? `
        <div class="bst-mood${moodImage ? " bst-mood-has-image" : ""}" title="${moodText} (${moodTrend})">
          <div class="bst-mood-wrap ${moodImage ? "bst-mood-wrap--image" : "bst-mood-wrap--emoji"}">
            ${moodImage
              ? `<button type="button" class="bst-mood-image-trigger" data-bst-action="open-mood-preview" data-bst-image-src="${escapeHtml(moodImage)}" data-bst-image-alt="${escapeHtml(moodText)}" data-bst-image-character="${escapeHtml(name)}" data-bst-image-mood="${escapeHtml(moodText)}" aria-label="Open mood image preview for ${escapeHtml(name)} (${escapeHtml(moodText)})"><span class="bst-mood-image-frame${moodSource === "st_expressions" ? " bst-mood-image-frame--st-expression" : ""}"><img class="bst-mood-image${moodSource === "st_expressions" ? " bst-mood-image--st-expression" : ""}" src="${escapeHtml(moodImage)}" alt="${escapeHtml(moodText)}"${stExpressionImageStyle}></span></button>`
              : `<span class="bst-mood-chip"><span class="bst-mood-emoji">${moodToEmojiEntity(moodText)}</span></span>`}
            ${moodImage && lastThoughtText
              ? renderThoughtMarkup(lastThoughtText, thoughtUiKey, "bubble")
              : moodImage
                ? ""
                : `<span class="bst-mood-badge" style="background:${moodBadgeColor(moodText)};">${moodText} (${moodTrend})</span>`}
          </div>
        </div>` : ""}
        ${settings.showLastThought && data.statistics.lastThought?.[name] !== undefined && !moodImage ? renderThoughtMarkup(String(data.statistics.lastThought?.[name] ?? ""), thoughtUiKey, "panel") : ""}
        ${enabledNumeric.length === 0 && enabledNonNumeric.length === 0 && moodText === "" && !(settings.showLastThought && data.statistics.lastThought?.[name] !== undefined) ? `<div class="bst-empty">No stats recorded.</div>` : ""}
        </div>
      `;
      cardHtmlByName.push({ name, html: cardHtml, isActive, isNew, cardColor });
      const nonNumericSignature = enabledNonNumeric.map(def => {
        const value = resolveNonNumericValue(data, def, name);
        if (value == null) return `${def.id}:not_set`;
        return `${def.id}:${typeof value === "boolean" ? String(value) : value}`;
      }).join("|");
      signatureParts.push(`card:${name}:${isActive ? "1" : "0"}:${moodText}:${moodImage ?? ""}:${lastThoughtText}:${nonNumericSignature}:${cardColor}:${cardHtml}`);
    }

    const renderSignature = signatureParts.join("|#|");
    if (root.dataset.bstRenderPhase === "idle" && root.dataset.bstRenderSignature === renderSignature) {
      continue;
    }
    root.dataset.bstRenderPhase = "idle";
    root.dataset.bstRenderSignature = renderSignature;
    root.innerHTML = "";

    const actions = document.createElement("div");
    actions.className = "bst-root-actions";
    actions.innerHTML = `
      <button class="bst-mini-btn bst-root-action-main" data-bst-action="toggle-all-collapse" title="${collapsed ? "Expand cards" : "Collapse cards"}" aria-expanded="${String(!collapsed)}">
        <span class="bst-root-action-icon" aria-hidden="true">${collapsed ? "&#9656;" : "&#9662;"}</span>
        <span class="bst-root-action-label">${collapsed ? "Expand cards" : "Collapse cards"}</span>
      </button>
      ${showRetrack ? `<button class="bst-mini-btn bst-mini-btn-icon bst-root-action-summary${summaryBusy ? " is-loading" : ""}" data-bst-action="send-summary" data-loading="${summaryBusy ? "true" : "false"}" title="${summaryBusy ? "Generating prose summary of current tracked stats..." : "Generate prose summary of current tracked stats and post as a Note"}" aria-label="${summaryBusy ? "Generating prose summary of current tracked stats..." : "Generate prose summary of current tracked stats and post as a Note"}"${summaryBusy ? " disabled" : ""}><span aria-hidden="true">${summaryBusy ? "&#8987;" : "&#128221;"}</span></button>` : ""}
      ${showRetrack ? `<button class="bst-mini-btn bst-mini-btn-icon bst-mini-btn-accent bst-root-action-retrack" data-bst-action="retrack" title="Retrack latest AI message" aria-label="Retrack latest AI message"><span aria-hidden="true">&#x21BB;</span></button>` : ""}
    `;
    root.appendChild(actions);

    for (const item of cardHtmlByName) {
      const card = document.createElement("div");
      card.className = `bst-card${item.isActive ? "" : " bst-card-inactive"}${item.isNew ? " bst-card-new" : ""}`;
      card.style.setProperty("--bst-card-local", item.cardColor);
      const palette = buildActionPalette(item.cardColor);
      card.style.setProperty("--bst-action-bg", palette.bg);
      card.style.setProperty("--bst-action-border", palette.border);
      card.style.setProperty("--bst-action-text", palette.text);
      card.style.setProperty("--bst-action-bg-hover", palette.hoverBg);
      card.style.setProperty("--bst-action-border-hover", palette.hoverBorder);
      card.style.setProperty("--bst-action-focus", palette.focus);
      card.innerHTML = item.html;
      root.appendChild(card);
    }
  }
}

export function removeTrackerUI(): void {
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach(el => el.remove());
  document.getElementById(STYLE_ID)?.remove();
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
  closeMoodImageModal(true);
  closeStExpressionFrameEditor();
  closeGraphModal();
}

function openMoodImageModal(imageUrl: string, altText: string, characterName?: string, moodText?: string): void {
  ensureStyles();
  closeMoodImageModal(true);
  moodPreviewOpenedAt = Date.now();

  const modal = document.createElement("div");
  modal.className = MOOD_PREVIEW_MODAL_CLASS;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "bst-mood-preview-close";
  closeButton.setAttribute("aria-label", "Close image preview");
  closeButton.innerHTML = "&times;";
  closeButton.addEventListener("click", () => closeMoodImageModal());

  const image = document.createElement("img");
  image.className = "bst-mood-preview-image";
  image.src = imageUrl;
  image.alt = altText || "Mood image";
  image.addEventListener("click", () => {
    if (Date.now() - moodPreviewOpenedAt < 220) return;
    closeMoodImageModal();
  });

  const caption = document.createElement("div");
  caption.className = "bst-mood-preview-caption";
  const captionParts = [characterName, moodText].filter(part => typeof part === "string" && part.trim());
  caption.textContent = captionParts.length ? captionParts.join(" - ") : (altText || "Mood image");

  // Inline fallback for environments where extension CSS is delayed/overridden on mobile.
  modal.style.setProperty("position", "relative", "important");
  modal.style.setProperty("width", "min(960px, 94vw)", "important");
  modal.style.setProperty("max-height", "calc(100dvh - 24px)", "important");
  modal.style.setProperty("display", "grid", "important");
  modal.style.setProperty("grid-template-rows", "auto auto", "important");
  modal.style.setProperty("place-items", "center", "important");
  modal.style.setProperty("gap", "10px", "important");
  modal.style.setProperty("z-index", "2147483647", "important");

  image.style.setProperty("max-width", "100%", "important");
  image.style.setProperty("max-height", "calc(100dvh - 24px)", "important");
  image.style.setProperty("object-fit", "contain", "important");

  modal.appendChild(closeButton);
  modal.appendChild(image);
  modal.appendChild(caption);

  const canUseDialog = typeof window.HTMLDialogElement !== "undefined"
    && typeof document.createElement("dialog").showModal === "function";

  if (canUseDialog) {
    const dialog = document.createElement("dialog");
    dialog.className = MOOD_PREVIEW_DIALOG_CLASS;
    dialog.style.setProperty("position", "fixed", "important");
    dialog.style.setProperty("inset", "0", "important");
    dialog.style.setProperty("display", "grid", "important");
    dialog.style.setProperty("place-items", "center", "important");
    dialog.style.setProperty("margin", "0", "important");
    dialog.style.setProperty("width", "100vw", "important");
    dialog.style.setProperty("height", "100dvh", "important");
    dialog.style.setProperty("max-width", "100vw", "important");
    dialog.style.setProperty("max-height", "100dvh", "important");
    dialog.style.setProperty("padding", "12px", "important");
    dialog.style.setProperty("border", "0", "important");
    dialog.style.setProperty("background", "transparent", "important");
    dialog.style.setProperty("overflow", "auto", "important");
    dialog.style.setProperty("z-index", "2147483647", "important");
    dialog.style.setProperty("pointer-events", "auto", "important");

    dialog.appendChild(modal);
    dialog.addEventListener("click", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === dialog) {
        closeMoodImageModal();
      }
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeMoodImageModal();
    });
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
    document.body.classList.add(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.add(MOOD_PREVIEW_BODY_CLASS);
  } else {
    const backdrop = document.createElement("div");
    backdrop.className = MOOD_PREVIEW_BACKDROP_CLASS;
    backdrop.style.setProperty("position", "fixed", "important");
    backdrop.style.setProperty("inset", "0", "important");
    backdrop.style.setProperty("display", "grid", "important");
    backdrop.style.setProperty("place-items", "center", "important");
    backdrop.style.setProperty("padding", "12px", "important");
    backdrop.style.setProperty("background", "rgba(0,0,0,0.72)", "important");
    backdrop.style.setProperty("z-index", "2147483647", "important");
    backdrop.style.setProperty("overflow", "auto", "important");
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === backdrop) {
        closeMoodImageModal();
      }
    });
    backdrop.addEventListener("touchend", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === backdrop) {
        closeMoodImageModal();
      }
    }, { passive: true });
    document.body.appendChild(backdrop);
    document.body.classList.add(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.add(MOOD_PREVIEW_BODY_CLASS);
    // Fallback for environments where CSS animations are disabled/not applied.
    backdrop.style.opacity = "1";
  }

  modal.style.transform = "none";

  moodPreviewKeyListener = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeMoodImageModal();
    }
  };
  document.addEventListener("keydown", moodPreviewKeyListener);
}

function closeMoodImageModal(immediate = false): void {
  const dialog = document.querySelector(`.${MOOD_PREVIEW_DIALOG_CLASS}`) as HTMLDialogElement | null;
  const backdrop = document.querySelector(`.${MOOD_PREVIEW_BACKDROP_CLASS}`) as HTMLElement | null;
  if (!dialog && !backdrop) {
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    if (moodPreviewKeyListener) {
      document.removeEventListener("keydown", moodPreviewKeyListener);
      moodPreviewKeyListener = null;
    }
    moodPreviewOpenedAt = 0;
    return;
  }
  if (moodPreviewKeyListener) {
    document.removeEventListener("keydown", moodPreviewKeyListener);
    moodPreviewKeyListener = null;
  }

  if (dialog) {
    if (dialog.open) {
      try {
        dialog.close();
      } catch {
        // Ignore close errors from already-closing dialog.
      }
    }
    dialog.remove();
  }

  if (!backdrop) {
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
    return;
  }
  if (immediate) {
    backdrop.remove();
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
    return;
  }
  if (backdrop.classList.contains("is-closing")) return;
  backdrop.classList.add("is-closing");
  window.setTimeout(() => {
    backdrop.remove();
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
  }, 150);
}

type EditStatsPayload = {
  messageIndex: number;
  character: string;
  numeric: Record<string, number | null>;
  nonNumeric?: Record<string, string | boolean | null>;
  mood?: string | null;
  lastThought?: string | null;
};

function closeEditStatsModal(): void {
  document.querySelector(`.${EDIT_STATS_BACKDROP_CLASS}`)?.remove();
}

function openEditStatsModal(input: {
  messageIndex: number;
  character: string;
  data: TrackerData;
  settings: BetterSimTrackerSettings;
  onSave?: (payload: EditStatsPayload) => void;
}): void {
  ensureStyles();
  closeEditStatsModal();

  const numericDefs = getAllNumericStatDefinitions(input.settings).filter(def => def.track);
  const builtInDefs = numericDefs.filter(def => def.builtIn);
  const customDefs = numericDefs.filter(def => !def.builtIn);
  const nonNumericDefs = getNonNumericStatDefinitions(input.settings);
  const nonNumericDefById = new Map(nonNumericDefs.map(def => [def.id, def]));
  const currentMood = input.data.statistics.mood?.[input.character];
  const normalizedMood = currentMood ? normalizeMoodLabel(String(currentMood)) : null;
  const currentThought = input.data.statistics.lastThought?.[input.character];

  const numericField = (def: { id: string; label: string; defaultValue: number }): string => {
    const raw = getNumericRawValue(input.data, def.id, input.character);
    const value = raw !== undefined && Number.isFinite(raw) ? String(Math.round(raw)) : "";
    const placeholder = String(Math.round(def.defaultValue ?? 50));
    return `
      <label class="bst-edit-field">
        <span>${escapeHtml(def.label)}</span>
        <input type="number" min="0" max="100" step="1" data-bst-edit-stat="${escapeHtml(def.id)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
      </label>
    `;
  };

  const nonNumericField = (def: UiNonNumericStatDefinition): string => {
    const currentValue = resolveNonNumericValue(input.data, def, input.character);
    if (def.kind === "enum_single") {
      const selected = typeof currentValue === "string" ? currentValue : "";
      return `
        <label class="bst-edit-field">
          <span>${escapeHtml(def.label)}</span>
          <select data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="enum_single">
            <option value="">Clear value</option>
            ${def.enumOptions.map(option => {
              const safe = escapeHtml(option);
              const isSelected = selected === option ? "selected" : "";
              return `<option value="${safe}" ${isSelected}>${safe}</option>`;
            }).join("")}
          </select>
        </label>
      `;
    }
    if (def.kind === "boolean") {
      const selected = typeof currentValue === "boolean" ? currentValue : null;
      return `
        <label class="bst-edit-field">
          <span>${escapeHtml(def.label)}</span>
          <select data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="boolean">
            <option value="">Clear value</option>
            <option value="true" ${selected === true ? "selected" : ""}>${escapeHtml(def.booleanTrueLabel)}</option>
            <option value="false" ${selected === false ? "selected" : ""}>${escapeHtml(def.booleanFalseLabel)}</option>
          </select>
        </label>
      `;
    }
    const value = typeof currentValue === "string" ? currentValue : "";
    return `
      <label class="bst-edit-field">
        <span>${escapeHtml(def.label)}</span>
        <input type="text" maxlength="${def.textMaxLength}" data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="text_short" value="${escapeHtml(value)}" placeholder="Optional. Max ${def.textMaxLength} chars.">
      </label>
    `;
  };

  const backdrop = document.createElement("div");
  backdrop.className = EDIT_STATS_BACKDROP_CLASS;
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) {
      closeEditStatsModal();
    }
  });

  const modal = document.createElement("div");
  modal.className = EDIT_STATS_MODAL_CLASS;
  modal.innerHTML = `
    <div class="bst-edit-head">
      <div class="bst-edit-title">Edit Tracker Stats - ${escapeHtml(input.character)}</div>
      <button class="bst-btn bst-close-btn" data-action="close" aria-label="Close edit dialog">&times;</button>
    </div>
    <div class="bst-edit-sub">Numeric values are percentages (0-100). Leave a field empty to clear that stat for this tracker entry. Edits apply to the latest tracker snapshot for this character.</div>
    ${builtInDefs.length
      ? `<div class="bst-edit-grid bst-edit-grid-two">${builtInDefs.map(numericField).join("")}</div>`
      : `<div class="bst-edit-sub">No built-in numeric stats are currently tracked.</div>`}
    ${customDefs.length
      ? `<div class="bst-edit-divider"></div>
         <div class="bst-edit-grid bst-edit-grid-two">${customDefs.map(numericField).join("")}</div>`
      : ""}
    ${nonNumericDefs.length
      ? `<div class="bst-edit-divider"></div>
         <div class="bst-edit-grid bst-edit-grid-two">${nonNumericDefs.map(nonNumericField).join("")}</div>`
      : ""}
    ${input.settings.trackMood
      ? `<div class="bst-edit-divider"></div>
         <label class="bst-edit-field">
           <span>Mood</span>
           <select data-bst-edit-text="mood">
             <option value="">Clear mood</option>
             ${MOOD_LABELS.map(label => {
               const safe = escapeHtml(label);
               const selected = normalizedMood === label ? "selected" : "";
               return `<option value="${safe}" ${selected}>${safe}</option>`;
             }).join("")}
           </select>
         </label>`
      : ""}
    ${input.settings.trackLastThought
      ? `<div class="bst-edit-divider"></div>
         <label class="bst-edit-field">
           <span>Last Thought</span>
           <textarea rows="3" data-bst-edit-text="lastThought" placeholder="Optional. Keep it concise (max ${MAX_EDIT_LAST_THOUGHT_CHARS} chars).">${escapeHtml(String(currentThought ?? ""))}</textarea>
         </label>`
      : ""}
    <div class="bst-edit-actions">
      <button type="button" class="bst-btn bst-btn-soft" data-action="cancel">Cancel</button>
      <button type="button" class="bst-btn" data-action="save">Save</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => closeEditStatsModal();
  modal.querySelector('[data-action="close"]')?.addEventListener("click", close);
  modal.querySelector('[data-action="cancel"]')?.addEventListener("click", close);

  modal.querySelector('[data-action="save"]')?.addEventListener("click", () => {
    const numeric: Record<string, number | null> = {};
    modal.querySelectorAll<HTMLInputElement>("[data-bst-edit-stat]").forEach(node => {
      const key = String(node.dataset.bstEditStat ?? "").trim().toLowerCase();
      if (!key) return;
      const raw = node.value.trim();
      if (!raw) {
        numeric[key] = null;
        return;
      }
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        numeric[key] = null;
        node.value = "";
        return;
      }
      const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
      node.value = String(clamped);
      numeric[key] = clamped;
    });

    const nonNumeric: Record<string, string | boolean | null> = {};
    modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-bst-edit-non-numeric]").forEach(node => {
      const key = String(node.dataset.bstEditNonNumeric ?? "").trim().toLowerCase();
      if (!key) return;
      const def = nonNumericDefById.get(key);
      if (!def) return;
      const kind = String(node.dataset.bstEditKind ?? def.kind);
      const raw = String(node.value ?? "").trim();
      if (!raw) {
        nonNumeric[key] = null;
        return;
      }
      if (kind === "boolean") {
        nonNumeric[key] = raw.toLowerCase() === "true";
        return;
      }
      if (kind === "enum_single") {
        const matched = resolveEnumOption(def.enumOptions, raw);
        nonNumeric[key] = matched ?? null;
        if (nonNumeric[key] == null) {
          node.value = "";
        }
        return;
      }
      const text = normalizeNonNumericTextValue(raw, def.textMaxLength);
      nonNumeric[key] = text || null;
      node.value = text;
    });

    let moodValue: string | null | undefined = undefined;
    const moodSelect = modal.querySelector<HTMLSelectElement>('[data-bst-edit-text="mood"]');
    if (moodSelect) {
      const raw = String(moodSelect.value ?? "").trim();
      moodValue = raw ? raw : null;
    }

    let lastThoughtValue: string | null | undefined = undefined;
    const thoughtInput = modal.querySelector<HTMLTextAreaElement>('[data-bst-edit-text="lastThought"]');
    if (thoughtInput) {
      const text = thoughtInput.value.trim();
      lastThoughtValue = text ? text.slice(0, MAX_EDIT_LAST_THOUGHT_CHARS) : null;
    }

    input.onSave?.({
      messageIndex: input.messageIndex,
      character: input.character,
      numeric,
      nonNumeric,
      mood: moodValue,
      lastThought: lastThoughtValue,
    });
    closeEditStatsModal();
  });
}

function statValue(entry: TrackerData, statKey: string, character: string, fallback: number): number {
  const raw = getNumericRawValue(entry, statKey, character);
  if (raw === undefined || Number.isNaN(raw)) return fallback;
  return Math.max(0, Math.min(100, raw));
}

function hasCharacterSnapshot(entry: TrackerData, character: string): boolean {
  for (const statKey of BUILT_IN_NUMERIC_STAT_KEYS) {
    if (hasNumericValue(entry, statKey, character)) return true;
  }
  if (entry.customStatistics) {
    for (const values of Object.values(entry.customStatistics)) {
      if (values?.[character] !== undefined) return true;
    }
  }
  if (entry.customNonNumericStatistics) {
    for (const values of Object.values(entry.customNonNumericStatistics)) {
      if (values?.[character] !== undefined) return true;
    }
  }
  return (
    entry.statistics.mood?.[character] !== undefined ||
    entry.statistics.lastThought?.[character] !== undefined
  );
}

function hasNumericSnapshot(entry: TrackerData, character: string, defs: UiNumericStatDefinition[]): boolean {
  for (const def of defs) {
    if (hasNumericValue(entry, def.key, character)) return true;
  }
  return false;
}

function buildStatSeries(
  timeline: TrackerData[],
  character: string,
  def: UiNumericStatDefinition,
): number[] {
  let carry = Math.max(0, Math.min(100, Math.round(def.defaultValue)));
  return timeline.map(item => {
    carry = statValue(item, def.key, character, carry);
    return carry;
  });
}

function smoothSeries(values: number[], windowSize = 3): number[] {
  if (values.length <= 2 || windowSize <= 1) return values;
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j];
      count += 1;
    }
    if (count === 0) return values[i];
    return sum / count;
  });
}

const GRAPH_SMOOTH_KEY = "bst-graph-smoothing";
const GRAPH_WINDOW_KEY = "bst-graph-window";
type GraphWindow = "30" | "60" | "120" | "all";

function getGraphSmoothingPreference(): boolean {
  try {
    return localStorage.getItem(GRAPH_SMOOTH_KEY) === "1";
  } catch {
    return false;
  }
}

function setGraphSmoothingPreference(enabled: boolean): void {
  try {
    safeSetLocalStorage(GRAPH_SMOOTH_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

function getGraphWindowPreference(): GraphWindow {
  try {
    const raw = String(localStorage.getItem(GRAPH_WINDOW_KEY) ?? "all");
    if (raw === "30" || raw === "60" || raw === "120" || raw === "all") return raw;
  } catch {
    // ignore
  }
  return "all";
}

function setGraphWindowPreference(windowSize: GraphWindow): void {
  try {
    safeSetLocalStorage(GRAPH_WINDOW_KEY, windowSize);
  } catch {
    // ignore
  }
}

export function getGraphPreferences(): { window: GraphWindow; smoothing: boolean } {
  return {
    window: getGraphWindowPreference(),
    smoothing: getGraphSmoothingPreference()
  };
}

function downsampleIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>([0, length - 1]);
  const step = (length - 1) / (target - 1);
  for (let i = 1; i < target - 1; i += 1) {
    out.add(Math.round(i * step));
  }
  return Array.from(out).sort((a, b) => a - b);
}

function downsampleTimeline(values: TrackerData[], target = 140): TrackerData[] {
  if (values.length <= target) return values;
  const indexes = downsampleIndices(values.length, target);
  return indexes.map(i => values[i]);
}

function buildPolyline(values: number[], width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `${x},${y}`;
  }).join(" ");
}

function buildPointCircles(values: number[], color: string, _stat: string, width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `<circle cx="${x}" cy="${y}" r="2.7" fill="${color}" />`;
  }).join("");
}

function buildLastPointCircle(values: number[], color: string, width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  const idx = values.length - 1;
  const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
  const y = pad + ((100 - values[idx]) / 100) * drawableH;
  return `<circle cx="${x}" cy="${y}" r="4.2" fill="${color}" stroke="rgba(255,255,255,0.75)" stroke-width="1.2" />`;
}

function graphSeriesDomId(key: string): string {
  return `series-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function openGraphModal(input: {
  character: string;
  history: TrackerData[];
  accentColor: string;
  settings: BetterSimTrackerSettings;
  debug?: boolean;
}): void {
  ensureStyles();
  closeGraphModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-graph-backdrop";
  backdrop.addEventListener("click", () => closeGraphModal());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = "bst-graph-modal";

  const enabledNumeric = getNumericStatsForHistory(input.history, input.character, input.settings);
  const timeline = [...input.history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item => hasNumericSnapshot(item, input.character, enabledNumeric));
  const rawSnapshotCount = timeline.length;
  const windowPreference = getGraphWindowPreference();
  const windowSize = windowPreference === "all" ? null : Number(windowPreference);
  const windowedTimeline = windowSize ? timeline.slice(-windowSize) : timeline;
  const renderedTimeline = downsampleTimeline(windowedTimeline, 140);
  const points: Record<string, number[]> = {};
  for (const def of enabledNumeric) {
    points[def.key] = buildStatSeries(renderedTimeline, input.character, def);
  }

  const width = 780;
  const height = 320;
  let smoothing = getGraphSmoothingPreference();
  const connectionColor = input.accentColor || "#9cff8f";
  const buildSeriesFrom = (defs: UiNumericStatDefinition[], seriesSource: Record<string, number[]>) => {
    const series: Record<string, number[]> = {};
    for (const def of defs) {
      const values = seriesSource[def.key] ?? [];
      series[def.key] = smoothing ? smoothSeries(values, 3) : values;
    }
    return series;
  };
  const lineSeries = buildSeriesFrom(enabledNumeric, points);
  const lineMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    const line = buildPolyline(lineSeries[def.key] ?? [], width, height);
    return line ? `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5"></polyline>` : "";
  }).join("");
  const dotsMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    return buildPointCircles(points[def.key] ?? [], color, def.key, width, height);
  }).join("");
  const lastPointMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    return buildLastPointCircle(points[def.key] ?? [], color, width, height);
  }).join("");
  const latest: Record<string, number> = {};
  for (const def of enabledNumeric) {
    latest[def.key] = points[def.key]?.at(-1) ?? 0;
  }
  const snapshotCount = enabledNumeric.length ? (points[enabledNumeric[0].key]?.length ?? 0) : 0;

  if (input.debug) {
    console.log("[BetterSimTracker] graph-open", {
      character: input.character,
      snapshotCount,
      rawSnapshotCount,
      windowPreference,
      latest
    });
  }

  modal.innerHTML = `
    <div class="bst-graph-top">
      <div class="bst-graph-title">${input.character} Relationship Trend</div>
      <button class="bst-btn bst-close-btn" data-action="close" title="Close graph" aria-label="Close graph">&times;</button>
    </div>
    <div class="bst-graph-controls">
      <label class="bst-graph-toggle" title="Display history range">
        <span>History</span>
        <select class="bst-graph-window-select${windowPreference !== "all" ? " active" : ""}" data-action="window">
          <option value="30" ${windowPreference === "30" ? "selected" : ""}>30</option>
          <option value="60" ${windowPreference === "60" ? "selected" : ""}>60</option>
          <option value="120" ${windowPreference === "120" ? "selected" : ""}>120</option>
          <option value="all" ${windowPreference === "all" ? "selected" : ""}>All</option>
        </select>
      </label>
      <label class="bst-graph-toggle" title="Toggle smoothed graph lines">
        <input type="checkbox" data-action="toggle-smoothing" ${smoothing ? "checked" : ""}>
        <span class="bst-graph-toggle-switch"></span>
        <span>Smoothed</span>
      </label>
    </div>
    <div class="bst-graph-canvas">
    <svg class="bst-graph-svg" viewBox="0 0 ${width} ${height}" width="100%" height="320">
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.25)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.25)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.5)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.5)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.75)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.75)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24}" x2="${width - 24}" y2="${height - 24}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
      <line x1="24" y1="24" x2="24" y2="${height - 24}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
      <text x="8" y="${height - 24}" fill="rgba(255,255,255,0.75)" font-size="10">0</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.25)}" fill="rgba(255,255,255,0.75)" font-size="10">25</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.5)}" fill="rgba(255,255,255,0.75)" font-size="10">50</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.75)}" fill="rgba(255,255,255,0.75)" font-size="10">75</text>
      <text x="2" y="28" fill="rgba(255,255,255,0.75)" font-size="10">100</text>
      <text x="${width - 24}" y="14" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">Y: Relationship %</text>
      <text x="24" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10">1</text>
      <text x="${Math.round(width / 2)}" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="middle">${Math.max(1, Math.ceil(snapshotCount / 2))}</text>
      <text x="${width - 24}" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">${Math.max(1, snapshotCount)}</text>
      <text x="${width - 24}" y="26" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">X: Chat Timeline</text>
      ${enabledNumeric.length ? lineMarkup : ""}
      ${enabledNumeric.length ? dotsMarkup : ""}
      ${enabledNumeric.length ? lastPointMarkup : ""}
      <g id="bst-graph-hover" opacity="0">
        <line id="bst-graph-hover-line" x1="0" y1="24" x2="0" y2="${height - 24}" stroke="rgba(255,255,255,0.25)" stroke-width="1"></line>
        ${enabledNumeric.map(def => {
          const color = def.key === "connection" ? connectionColor : def.color;
          return `<circle id="bst-graph-hover-${graphSeriesDomId(def.key)}" r="3.8" fill="${color}"></circle>`;
        }).join("")}
      </g>
      ${enabledNumeric.length === 0 && snapshotCount === 0
        ? `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="rgba(255,255,255,0.65)" font-size="13" text-anchor="middle">No numeric stats recorded</text>`
        : enabledNumeric.length > 0 && snapshotCount === 0
          ? `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="rgba(255,255,255,0.65)" font-size="13" text-anchor="middle">No tracker history yet</text>`
          : ""}
    </svg>
    <div class="bst-graph-tooltip" id="bst-graph-tooltip"></div>
    </div>
    <div class="bst-graph-legend">
      ${enabledNumeric.length
        ? enabledNumeric.map(def => {
            const color = def.key === "connection" ? connectionColor : def.color;
            const value = Math.round(latest[def.key] ?? 0);
            return `<span><i class="bst-legend-dot" style="background:${color};"></i>${def.label} ${value}</span>`;
          }).join("")
        : `<span class="bst-graph-legend-empty">No numeric stats recorded for this character.</span>`}
    </div>
  `;
  document.body.appendChild(modal);

  const svg = modal.querySelector(".bst-graph-svg") as SVGSVGElement | null;
  const hoverGroup = modal.querySelector("#bst-graph-hover") as SVGGElement | null;
  const hoverLine = modal.querySelector("#bst-graph-hover-line") as SVGLineElement | null;
  const hoverDots: Record<string, SVGCircleElement | null> = {};
  for (const def of enabledNumeric) {
    hoverDots[def.key] = modal.querySelector(`#bst-graph-hover-${graphSeriesDomId(def.key)}`) as SVGCircleElement | null;
  }
  const tooltip = modal.querySelector("#bst-graph-tooltip") as HTMLDivElement | null;
  const pointCount = enabledNumeric.length ? (points[enabledNumeric[0].key]?.length ?? 0) : 0;
  if (svg && hoverGroup && hoverLine && tooltip && pointCount > 0) {
    const pad = 24;
    const drawableW = Math.max(1, width - pad * 2);
    const drawableH = Math.max(1, height - pad * 2);
    const xFor = (idx: number): number =>
      pad + (pointCount === 1 ? drawableW / 2 : (drawableW * idx) / (pointCount - 1));
    const yFor = (value: number): number => pad + ((100 - value) / 100) * drawableH;
    const clampIndex = (idx: number): number => Math.max(0, Math.min(pointCount - 1, idx));
    const updateHover = (clientX: number, clientY: number): void => {
        const rect = svg.getBoundingClientRect();
        const relX = clientX - rect.left;
        const idx = clampIndex(Math.round(((relX - pad) / drawableW) * (pointCount - 1)));
        const cx = xFor(idx);

        hoverGroup.setAttribute("opacity", "1");
        hoverLine.setAttribute("x1", String(cx));
        hoverLine.setAttribute("x2", String(cx));
        for (const def of enabledNumeric) {
          const series = points[def.key] ?? [];
          const value = series[idx] ?? 0;
          hoverDots[def.key]?.setAttribute("cx", String(cx));
          hoverDots[def.key]?.setAttribute("cy", String(yFor(value)));
        }

        tooltip.classList.add("visible");
        tooltip.innerHTML = `
          <div><strong>Index:</strong> ${idx + 1}/${pointCount}</div>
          ${enabledNumeric.map(def => `<div>${def.label}: ${Math.round((points[def.key]?.[idx] ?? 0))}</div>`).join("")}
        `;
        const canvas = modal.querySelector(".bst-graph-canvas") as HTMLElement;
        const canvasRect = canvas.getBoundingClientRect();
        const localX = clientX - canvasRect.left;
        const localY = clientY - canvasRect.top;
        const tooltipWidth = tooltip.offsetWidth || 140;
        const tooltipHeight = tooltip.offsetHeight || 60;
        const left = Math.min(canvasRect.width - tooltipWidth - 8, Math.max(8, localX + 12));
        const top = Math.min(canvasRect.height - tooltipHeight - 8, Math.max(8, localY + 12));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      };
    svg.addEventListener("mousemove", event => updateHover(event.clientX, event.clientY));
    svg.addEventListener("mouseleave", () => {
      hoverGroup.setAttribute("opacity", "0");
      tooltip.classList.remove("visible");
    });
  }

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => closeGraphModal());
  modal.querySelector('[data-action="toggle-smoothing"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLInputElement;
    setGraphSmoothingPreference(Boolean(target.checked));
    closeGraphModal();
    openGraphModal(input);
  });
  modal.querySelector('[data-action="window"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLSelectElement;
    const next = target.value === "30" || target.value === "60" || target.value === "120" || target.value === "all"
      ? target.value
      : "all";
    setGraphWindowPreference(next);
    closeGraphModal();
    openGraphModal(input);
  });
}

export function closeGraphModal(): void {
  document.querySelector(".bst-graph-backdrop")?.remove();
  document.querySelector(".bst-graph-modal")?.remove();
}

export function openSettingsModal(input: {
  settings: BetterSimTrackerSettings;
  profileOptions: ConnectionProfileOption[];
  previewCharacterCandidates?: Array<{ name: string; avatar?: string | null }>;
  debugRecord?: DeltaDebugRecord | null;
  injectedPrompt?: string;
  onSave: (next: BetterSimTrackerSettings) => void;
  onRetrack?: () => void;
  onClearCurrentChat?: () => void;
  onDumpDiagnostics?: () => void;
  onClearDiagnostics?: () => void;
}): void {
  ensureStyles();
  closeSettingsModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-settings-backdrop";
  backdrop.addEventListener("click", () => closeSettingsModal());
  document.body.appendChild(backdrop);

  const profileMap = new Map<string, string>();
  for (const option of input.profileOptions) {
    profileMap.set(option.id, option.label);
  }
  if (input.settings.connectionProfile && !profileMap.has(input.settings.connectionProfile)) {
    profileMap.set(input.settings.connectionProfile, `${input.settings.connectionProfile} (current)`);
  }

  const profileOptionsHtml = [
    `<option value="">Use active connection</option>`,
    ...Array.from(profileMap.entries()).map(([id, label]) => `<option value="${id}">${label}</option>`)
  ].join("");
  let customStatsState: CustomStatDefinition[] = Array.isArray(input.settings.customStats)
    ? input.settings.customStats.map(cloneCustomStatDefinition)
    : [];
  let builtInNumericStatUiState: BuiltInNumericStatUiSettings = cloneBuiltInNumericStatUi(input.settings.builtInNumericStatUi);

  const modal = document.createElement("div");
  modal.className = "bst-settings";
  modal.innerHTML = `
    <div class="bst-settings-top">
      <div>
        <h3>BetterSimTracker Settings</h3>
        <p class="bst-settings-subtitle">Changes are saved automatically.</p>
      </div>
      <div class="bst-settings-top-actions">
        <button class="bst-btn bst-btn-soft" data-action="toggle-all-sections" title="Expand all sections">Expand all</button>
        <button class="bst-btn bst-close-btn" data-action="close" title="Close settings" aria-label="Close settings">&times;</button>
      </div>
    </div>
    <div class="bst-settings-section bst-quick-help">
      <h4><span class="bst-header-icon fa-solid fa-circle-info"></span>Quick Help</h4>
      <div class="bst-help-line"><strong>Extraction mode:</strong> Unified = faster single request. Sequential = one request per stat (more robust, slower).</div>
      <ul class="bst-help-list">
        <li><strong>Affection:</strong> emotional warmth and care</li>
        <li><strong>Trust:</strong> safety and willingness to be vulnerable</li>
        <li><strong>Desire:</strong> attraction/flirt tension</li>
        <li><strong>Connection:</strong> bond depth and emotional attunement</li>
      </ul>
      <div class="bst-help-line"><strong>Mood</strong> is short-term tone. <strong>Last Thought</strong> is one brief internal line for continuity.</div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-plug"></span>Connection</h4>
      <div class="bst-settings-grid">
        <label>Connection Profile <select data-k="connectionProfile">${profileOptionsHtml}</select></label>
        <label>Max Tokens Override <input data-k="maxTokensOverride" type="number" min="0" max="100000"></label>
        <label>Context Size Override <input data-k="truncationLengthOverride" type="number" min="0" max="200000"></label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-filter"></span>Extraction &amp; Injection</h4>
      <div class="bst-settings-grid">
        <div class="bst-section-divider">Extraction Settings</div>
        <label>Context Messages <input data-k="contextMessages" type="number" min="1" max="40"></label>
        <label data-bst-row="maxConcurrentCalls">Max Concurrent Requests <input data-k="maxConcurrentCalls" type="number" min="1" max="8"></label>
        <label data-bst-row="maxRetriesPerStat">Max Retries Per Stat <input data-k="maxRetriesPerStat" type="number" min="0" max="4"></label>
        <label>Max Delta Per Turn <input data-k="maxDeltaPerTurn" type="number" min="1" max="30"></label>
        <label>Confidence Dampening <input data-k="confidenceDampening" type="number" min="0" max="1" step="0.05"></label>
        <label>Mood Stickiness <input data-k="moodStickiness" type="number" min="0" max="1" step="0.05"></label>
        <label data-bst-row="activityLookback">Activity Lookback <input data-k="activityLookback" type="number" min="1" max="25"></label>
        <div class="bst-section-divider">Extraction Includes</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="includeCharacterCardsInPrompt" type="checkbox">Include Character Cards in Extraction Prompt</label>
          <label class="bst-check"><input data-k="includeLorebookInExtraction" type="checkbox">Include Activated Lorebook in Extraction Prompt</label>
        </div>
        <label data-bst-row="lorebookExtractionMaxChars">Lorebook Extraction Limit <input data-k="lorebookExtractionMaxChars" type="number" min="0" max="12000"></label>
        <div class="bst-help-line bst-toggle-help" data-bst-row="lorebookExtractionHelp">Maximum lorebook characters included in extraction context (0 = no trim).</div>

        <div class="bst-section-divider">Extraction Toggles</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="sequentialExtraction" type="checkbox">Sequential Extraction (per stat)</label>
          <label class="bst-check"><input data-k="strictJsonRepair" type="checkbox">Strict JSON Repair</label>
          <label class="bst-check"><input data-k="autoDetectActive" type="checkbox">Auto Detect Active</label>
        </div>

        <div class="bst-section-divider">User Tracking</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="enableUserTracking" type="checkbox">Enable User-Side Extraction</label>
          <label class="bst-check"><input data-k="userTrackMood" type="checkbox">Track User Mood</label>
          <label class="bst-check"><input data-k="userTrackLastThought" type="checkbox">Track User Last Thought</label>
          <label class="bst-check"><input data-k="includeUserTrackerInInjection" type="checkbox">Include User Tracker In Injection</label>
        </div>

        <div class="bst-section-divider">Injection Settings</div>
        <label data-bst-row="injectPromptDepth">Injection Depth <select data-k="injectPromptDepth"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select></label>
        <label data-bst-row="injectionPromptMaxChars">Injection Prompt Max Chars <input data-k="injectionPromptMaxChars" type="number" min="500" max="30000"></label>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="injectTrackerIntoPrompt" type="checkbox">Inject Tracker Into Prompt</label>
          <label class="bst-check"><input data-k="summarizationNoteVisibleForAI" type="checkbox">Summarization Note Visible for AI (future notes)</label>
          <label class="bst-check" data-bst-row="injectSummarizationNote"><input data-k="injectSummarizationNote" type="checkbox">Inject Summarization Note</label>
        </div>
        <div class="bst-help-line bst-toggle-help"><strong>Summarize</strong> creates a prose note of current tracked stats (no numbers), typically 4-6 sentences, grounded in recent messages.</div>
        <div class="bst-help-line bst-toggle-help"><code>Summarization Note Visible for AI</code> affects only newly generated BetterSimTracker summary notes. Existing notes are not modified for safety.</div>
        <div class="bst-help-line bst-toggle-help"><code>Inject Summarization Note</code> only affects hidden tracker prompt injection guidance and does not edit chat messages.</div>
        <div class="bst-section-divider" data-bst-row="injectPromptDivider">Injection Prompt</div>
        <div class="bst-injection-prompt" data-bst-row="injectPromptBlock">
          <div class="bst-help-line">Shown only when Inject Tracker Into Prompt is enabled.</div>
          <div class="bst-help-line">Placeholders you can use:</div>
          <ul class="bst-help-list">
            <li><code>{{header}}</code> — privacy + usage rules header</li>
            <li><code>{{statSemantics}}</code> — enabled stat meanings</li>
            <li><code>{{behaviorBands}}</code> — low/medium/high behavior bands</li>
            <li><code>{{reactRules}}</code> — how-to-react rules</li>
            <li><code>{{priorityRules}}</code> — priority rules block</li>
            <li><code>{{lines}}</code> — per-character state lines</li>
            <li><code>{{summarizationNote}}</code> — optional latest tracker summary note (when enabled)</li>
          </ul>
          <div class="bst-prompt-group bst-prompt-inline">
            <div class="bst-prompt-head">
              <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-wand-magic-sparkles"></span>Injection Prompt</span>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateInjection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
            </div>
            <div class="bst-prompt-body">
              <div class="bst-prompt-caption">Template (editable)</div>
              <textarea data-k="promptTemplateInjection" rows="8"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-chart-line"></span>Tracked Stats</h4>
      <div class="bst-custom-stats-top bst-custom-stats-top-centered">
        <button type="button" class="bst-btn bst-btn-soft" data-action="manage-builtins">Manage Built-in Stats</button>
      </div>
      <div data-bst-row="moodAdvancedBlock" class="bst-mood-advanced-settings">
        <div class="bst-section-divider">Mood Advanced Settings</div>
        <div class="bst-settings-grid bst-settings-grid-single">
          <label>Mood Source
            <select data-k="moodSource">
              <option value="bst_images">BST mood images</option>
              <option value="st_expressions">ST expressions</option>
            </select>
          </label>
        </div>
        <div data-bst-row="globalMoodExpressionMap">
          <div class="bst-help-line">Global mood to ST expression map (character overrides still take priority).</div>
          <div class="bst-character-map bst-global-mood-map">
            ${MOOD_LABELS.map(label => {
              const moodLabel = label as MoodLabel;
              const safeLabel = escapeHtml(moodLabel);
              const rawMap = input.settings.moodExpressionMap as Record<string, unknown> | undefined;
              const explicitValue = rawMap && typeof rawMap[moodLabel] === "string" ? String(rawMap[moodLabel]).trim() : "";
              const value = explicitValue || DEFAULT_MOOD_EXPRESSION_MAP[moodLabel];
              const safeValue = escapeHtml(value);
              const safePlaceholder = escapeHtml(DEFAULT_MOOD_EXPRESSION_MAP[moodLabel]);
              return `
                <label class="bst-character-map-row">
                  <span>${safeLabel}</span>
                  <input type="text" data-bst-global-mood-map="${safeLabel}" value="${safeValue}" placeholder="${safePlaceholder}">
                </label>
              `;
            }).join("")}
          </div>
        </div>
        <div data-bst-row="stExpressionImageOptions">
          <div class="bst-help-line">ST expression framing (global): zoom and crop position for expression sprites.</div>
          <div class="bst-st-expression-control">
            <button type="button" class="bst-btn bst-btn-soft" data-action="open-global-st-framing">Adjust ST Expression Framing</button>
            <div class="bst-help-line bst-st-expression-summary" data-bst-row="stExpressionImageSummary"></div>
            <input data-k="stExpressionImageZoom" type="hidden">
            <input data-k="stExpressionImagePositionX" type="hidden">
            <input data-k="stExpressionImagePositionY" type="hidden">
          </div>
        </div>
        <div class="bst-help-line">Emoji is always fallback if the selected source has no image.</div>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-sliders"></span>Custom Stats</h4>
      <div class="bst-custom-stats-top">
        <div class="bst-help-line">Add custom stats (numeric, enum, boolean, short text). Maximum ${MAX_CUSTOM_STATS} custom stats.</div>
        <button type="button" class="bst-btn bst-btn-soft" data-action="custom-add">Add Custom Stat</button>
      </div>
      <div class="bst-custom-stats-list" data-bst-row="customStatsList"></div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-eye"></span>Display</h4>
      <div class="bst-settings-grid">
        <label data-bst-row="inactiveLabel">Inactive Label <input data-k="inactiveLabel" type="text"></label>
        <label>Accent Color
          <div class="bst-color-inputs">
            <input data-k-color="accentColor" type="color">
          </div>
        </label>
        <label>Card Opacity <input data-k="cardOpacity" type="number" min="0.1" max="1" step="0.01"></label>
        <label>Border Radius <input data-k="borderRadius" type="number" min="0" max="32"></label>
        <label>Font Size <input data-k="fontSize" type="number" min="10" max="22"></label>
        <div class="bst-section-divider">Toggles</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="showInactive" type="checkbox">Show Inactive</label>
          <label class="bst-check"><input data-k="showLastThought" type="checkbox">Show Last Thought</label>
        </div>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-pen-to-square"></span>Prompts</h4>
            <details class="bst-help-details">
        <summary>Prompt help</summary>
        <div class="bst-help-line">Unified prompt is used for one-prompt built-in extraction. Custom stats always use per-stat prompts in all modes.</div>
        <div class="bst-help-line">Instruction is always editable. Protocol can be edited only when advanced unlock is enabled.</div>
        <div class="bst-help-line">Strict/repair prompts are fixed for safety and consistency.</div>
        <div class="bst-help-line">Placeholders you can use:</div>
        <ul class="bst-help-list">
          <li><code>{{envelope}}</code> — prebuilt header with user/characters + recent messages</li>
          <li><code>{{userName}}</code> — current user name</li>
          <li><code>{{characters}}</code> — comma-separated character names</li>
          <li><code>{{contextText}}</code> — raw recent messages text</li>
          <li><code>{{currentLines}}</code> — current tracker state lines</li>
          <li><code>{{historyLines}}</code> — recent tracker snapshot lines</li>
          <li><code>{{numericStats}}</code> — requested numeric stats list</li>
          <li><code>{{textStats}}</code> — requested text stats list</li>
          <li><code>{{maxDelta}}</code> — configured max delta per turn</li>
          <li><code>{{moodOptions}}</code> — allowed mood labels</li>
          <li><code>{{statId}}</code>/<code>{{statLabel}}</code> — custom stat identity (custom per-stat template)</li>
          <li><code>{{statDescription}}</code>/<code>{{statDefault}}</code> — custom stat metadata (custom per-stat template)</li>
          <li><code>{{statKind}}</code>/<code>{{valueSchema}}</code> — non-numeric stat kind + expected value format</li>
          <li><code>{{allowedValues}}</code>/<code>{{textMaxLen}}</code> — enum option list or text-short limit</li>
          <li><code>{{defaultValueLiteral}}</code>/<code>{{booleanTrueLabel}}</code>/<code>{{booleanFalseLabel}}</code> — non-numeric defaults/labels</li>
        </ul>
      </details>
      <div class="bst-check-grid">
        <label class="bst-check"><input data-k="unlockProtocolPrompts" type="checkbox">Unlock Protocol Prompt Editing (Advanced)</label>
      </div>
      <div class="bst-help-line">By default protocol blocks are locked. Enable the toggle above to edit and reset them.</div>
      <div class="bst-settings-grid bst-settings-grid-single bst-prompts-stack">
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-layer-group"></span>Unified Prompt</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateUnified" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateUnified" rows="8"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolUnified)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolUnified" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolUnified" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-heart"></span>Seq: Affection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialAffection" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialAffection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialAffection" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialAffection">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialAffection)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialAffection" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialAffection" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-shield-heart"></span>Seq: Trust</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialTrust" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialTrust" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialTrust" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialTrust">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialTrust)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialTrust" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialTrust" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-fire"></span>Seq: Desire</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialDesire" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialDesire" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialDesire" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialDesire">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialDesire)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialDesire" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialDesire" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-link"></span>Seq: Connection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialConnection" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialConnection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialConnection" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialConnection">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialConnection)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialConnection" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialConnection" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-sliders"></span>Custom Numeric Default</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialCustomNumeric" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable default used when a custom stat has no per-stat override, in all modes)</div>
            <textarea data-k="promptTemplateSequentialCustomNumeric" rows="6"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialCustomNumeric)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialCustomNumeric" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialCustomNumeric" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-list-check"></span>Custom Non-Numeric Default</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialCustomNonNumeric" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable default used when enum/boolean/text custom stats have no per-stat override, in all modes)</div>
            <textarea data-k="promptTemplateSequentialCustomNonNumeric" rows="6"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialCustomNonNumeric)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialCustomNonNumeric" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialCustomNonNumeric" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-face-smile"></span>Seq: Mood</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialMood" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialMood" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialMood" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialMood">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialMood)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialMood" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialMood" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-brain"></span>Seq: LastThought</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialLastThought" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialLastThought" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialLastThought" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialLastThought">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialLastThought)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialLastThought" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialLastThought" rows="10"></textarea>
            </div>
          </div>
        </label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-bug"></span>Debug</h4>
      <div class="bst-check-grid">
        <label class="bst-check"><input data-k="debug" type="checkbox">Debug</label>
      </div>
      <div class="bst-check-grid" data-bst-row="debugFlags">
        <label class="bst-check"><input data-k="debugExtraction" type="checkbox">Extraction</label>
        <label class="bst-check"><input data-k="debugPrompts" type="checkbox">Prompts</label>
        <label class="bst-check"><input data-k="debugUi" type="checkbox">UI</label>
        <label class="bst-check"><input data-k="debugMoodImages" type="checkbox">Mood Images</label>
        <label class="bst-check"><input data-k="debugStorage" type="checkbox">Storage</label>
        <label class="bst-check" data-bst-row="includeContextInDiagnostics"><input data-k="includeContextInDiagnostics" type="checkbox">Include Context In Diagnostics</label>
        <label class="bst-check" data-bst-row="includeGraphInDiagnostics"><input data-k="includeGraphInDiagnostics" type="checkbox">Include Graph Data In Diagnostics</label>
      </div>
      <div data-bst-row="debugBody">
        <div class="bst-debug-actions">
          <button class="bst-btn bst-btn-soft bst-btn-icon" data-action="retrack" title="Retrack Last AI Message" aria-label="Retrack Last AI Message">
            <span class="fa-solid fa-rotate-left" aria-hidden="true"></span>
          </button>
          <button class="bst-btn bst-btn-danger" data-action="clear-chat" title="Delete all tracker data for the currently open chat only.">
            <span class="fa-solid fa-trash bst-btn-icon-left" aria-hidden="true"></span>
            Delete Tracker Data (Current Chat)
          </button>
          <button class="bst-btn" data-action="dump-diagnostics" title="Collect and copy current diagnostics report to clipboard.">
            <span class="fa-solid fa-file-export bst-btn-icon-left" aria-hidden="true"></span>
            Dump Diagnostics
          </button>
          <button class="bst-btn bst-btn-danger" data-action="clear-diagnostics" title="Clear stored diagnostics traces and last debug record for this chat scope.">
            <span class="fa-solid fa-broom bst-btn-icon-left" aria-hidden="true"></span>
            Clear Diagnostics
          </button>
        </div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Extraction Debug Record</div>
        <div class="bst-debug-box">${input.debugRecord ? JSON.stringify(input.debugRecord, null, 2) : "No debug record yet."}</div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Injected Prompt Block</div>
        <div class="bst-debug-box">${input.injectedPrompt?.trim() ? input.injectedPrompt : "No injected prompt currently active."}</div>
      </div>
    </div>
    <div class="bst-settings-footer">
      <button class="bst-btn bst-btn-soft" data-action="retrack" title="Retrack Last AI Message">
        <span class="fa-solid fa-rotate-left bst-btn-icon-left" aria-hidden="true"></span>
        Retrack
      </button>
      <button class="bst-btn" data-action="close" title="Close settings">Done</button>
    </div>
  `;
  document.body.appendChild(modal);

  const mergeConnectionAndGeneration = (): void => {
    const sections = Array.from(modal.querySelectorAll(".bst-settings-section")) as HTMLElement[];
    const connectionSection = sections.find(section => section.querySelector("h4")?.textContent?.trim() === "Connection");
    const generationSection = sections.find(section => section.querySelector("h4")?.textContent?.trim() === "Generation");
    if (!connectionSection || !generationSection) return;
    const generationGrid = generationSection.querySelector(".bst-settings-grid");
    if (!generationGrid) return;
    const divider = document.createElement("div");
    divider.className = "bst-section-divider";
    divider.textContent = "Generation";
    connectionSection.appendChild(divider);
    connectionSection.appendChild(generationGrid);
    generationSection.remove();
  };
  mergeConnectionAndGeneration();

  const addMinMaxHints = (): void => {
    const numberInputs = Array.from(modal.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    numberInputs.forEach(input => {
      const minAttr = input.getAttribute("min");
      const maxAttr = input.getAttribute("max");
      if (minAttr === null && maxAttr === null) return;
      const label = input.closest("label");
      if (!label) return;
      const existing = label.querySelector(".bst-minmax");
      if (existing) return;
      const span = document.createElement("span");
      span.className = "bst-minmax";
      const parts: string[] = [];
      if (minAttr !== null && minAttr !== "") parts.push(`min ${minAttr}`);
      if (maxAttr !== null && maxAttr !== "") parts.push(`max ${maxAttr}`);
      span.textContent = parts.join(" · ");
      label.appendChild(span);
    });
  };
  addMinMaxHints();

  const enforceNumberBounds = (): void => {
    const numberInputs = Array.from(modal.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    numberInputs.forEach(input => {
      const minAttr = input.getAttribute("min");
      const maxAttr = input.getAttribute("max");
      const min = minAttr !== null && minAttr !== "" ? Number(minAttr) : undefined;
      const max = maxAttr !== null && maxAttr !== "" ? Number(maxAttr) : undefined;
      if (min === undefined && max === undefined) return;
      const label = input.closest("label");
      if (!label) return;
      let notice = label.querySelector(".bst-validation") as HTMLElement | null;
      if (!notice) {
        notice = document.createElement("span");
        notice.className = "bst-validation";
        notice.style.display = "none";
        label.appendChild(notice);
      }
      let clearTimer: number | null = null;
      let clampedThisFocus = false;
      const clamp = (): void => {
        if (input.value.trim() === "") return;
        const raw = Number(input.value);
        if (Number.isNaN(raw)) return;
        let next = raw;
        if (typeof min === "number") next = Math.max(min, next);
        if (typeof max === "number") next = Math.min(max, next);
        if (next !== raw) {
          input.value = String(next);
          clampedThisFocus = true;
        }
      };
      input.addEventListener("input", clamp);
      input.addEventListener("blur", () => {
        clamp();
        if (!clampedThisFocus) return;
        const parts: string[] = [];
        if (typeof min === "number") parts.push(`min ${min}`);
        if (typeof max === "number") parts.push(`max ${max}`);
        notice.textContent = `Allowed range: ${parts.join(" · ")}. Value adjusted.`;
        notice.style.display = "block";
        if (clearTimer !== null) window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          notice.textContent = "";
          notice.style.display = "none";
        }, 1800);
        clampedThisFocus = false;
      });
      input.addEventListener("focus", () => {
        clampedThisFocus = false;
      });
    });
  };
  enforceNumberBounds();

  const initSectionDrawers = (): void => {
    const sectionIds: Record<string, string> = {
      "Connection": "connection",
      "Extraction & Injection": "extraction",
      "Tracked Stats": "tracked-stats",
      "Custom Stats": "custom-stats",
      "Display": "display",
      "Prompts": "prompts",
      "Debug": "debug"
    };
    const sections = Array.from(modal.querySelectorAll(".bst-settings-section")) as HTMLElement[];
    sections.forEach((section, index) => {
      if (index === 0) return;
      const header = section.querySelector("h4") as HTMLHeadingElement | null;
      if (!header) return;
      const label = header.textContent?.trim() ?? "";
      const id = sectionIds[label] ?? label.toLowerCase().replace(/\s+/g, "-");
      section.dataset.bstSection = id;
      const head = document.createElement("div");
      head.className = "bst-section-head";
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("data-action", "toggle-section");
      head.setAttribute("data-section", id);
      head.setAttribute("aria-expanded", "true");
      head.setAttribute("title", "Toggle section");
      const icon = document.createElement("span");
      icon.className = "bst-section-icon fa-solid fa-circle-chevron-down";
      head.appendChild(header);
      head.appendChild(icon);
      section.insertBefore(head, section.firstChild);

      const body = document.createElement("div");
      body.className = "bst-section-body";
      body.dataset.bstSectionBody = id;
      while (section.childNodes.length > 1) {
        body.appendChild(section.childNodes[1]);
      }
      section.appendChild(body);

      const storageKey = `bst.section.${id}`;
      section.dataset.bstStorageKey = storageKey;
      const stored = localStorage.getItem(storageKey);
      const collapsed = stored ? stored === "collapsed" : true;
      if (collapsed) {
        section.classList.add("bst-section-collapsed");
        head.setAttribute("aria-expanded", "false");
      }

      const toggleSection = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        const nextCollapsed = !section.classList.contains("bst-section-collapsed");
        section.classList.toggle("bst-section-collapsed", nextCollapsed);
        head.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        safeSetLocalStorage(storageKey, nextCollapsed ? "collapsed" : "expanded");
        modal.dispatchEvent(new CustomEvent("bst:section-toggle"));
      };
      head.addEventListener("click", toggleSection);
      head.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        toggleSection(event);
      });
    });
  };
  initSectionDrawers();

  const initGlobalSectionToggle = (): void => {
    const buttons = Array.from(modal.querySelectorAll('[data-action="toggle-all-sections"]')) as HTMLButtonElement[];
    if (!buttons.length) return;
    const getSections = (): HTMLElement[] =>
      Array.from(modal.querySelectorAll('.bst-settings-section[data-bst-section]')) as HTMLElement[];
    const updateButtons = (): void => {
      const sections = getSections();
      const allCollapsed = sections.length > 0 && sections.every(section => section.classList.contains("bst-section-collapsed"));
      buttons.forEach(button => {
        button.textContent = allCollapsed ? "Expand all" : "Collapse all";
        button.setAttribute("title", allCollapsed ? "Expand all sections" : "Collapse all sections");
        button.setAttribute("aria-pressed", allCollapsed ? "false" : "true");
      });
    };
    const toggleAll = (): void => {
      const sections = getSections();
      if (!sections.length) return;
      const allCollapsed = sections.every(section => section.classList.contains("bst-section-collapsed"));
      const nextCollapsed = !allCollapsed;
      sections.forEach(section => {
        section.classList.toggle("bst-section-collapsed", nextCollapsed);
        const head = section.querySelector(".bst-section-head") as HTMLElement | null;
        head?.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        const storageKey = section.dataset.bstStorageKey;
        if (storageKey) {
          safeSetLocalStorage(storageKey, nextCollapsed ? "collapsed" : "expanded");
        }
      });
      updateButtons();
    };
    buttons.forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        toggleAll();
      });
    });
    modal.addEventListener("bst:section-toggle", updateButtons);
    updateButtons();
  };
  initGlobalSectionToggle();

  const initPromptGroups = (): void => {
    const groups = Array.from(modal.querySelectorAll(".bst-prompt-group")) as HTMLElement[];
    groups.forEach(group => {
      const head = group.querySelector(".bst-prompt-head") as HTMLElement | null;
      if (!head) return;
      group.classList.add("collapsed");
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      const toggle = (event: Event): void => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".bst-prompt-reset")) return;
        if (target?.closest(".bst-prompt-generate")) return;
        event.preventDefault();
        event.stopPropagation();
        group.classList.toggle("collapsed");
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        toggle(event);
      });
    });
  };
  initPromptGroups();

  const initAccentColorPicker = (): void => {
    const colorInput = modal.querySelector('[data-k-color="accentColor"]') as HTMLInputElement | null;
    if (!colorInput) return;
    const fallback = input.settings.accentColor || "#ff5a6f";
    colorInput.value = fallback;
    colorInput.addEventListener("input", () => {
      (input.settings as unknown as Record<string, unknown>).accentColor = colorInput.value;
      persistLive();
    });
  };
  initAccentColorPicker();

  const set = (key: keyof BetterSimTrackerSettings, value: string): void => {
    const node = modal.querySelector(`[data-k="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!node) return;
    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      node.checked = value === "true";
      return;
    }
    node.value = value;
  };
  const setExtra = (key: string, value: string): void => {
    const node = modal.querySelector(`[data-k="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!node) return;
    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      node.checked = value === "true";
      return;
    }
    node.value = value;
  };

  set("connectionProfile", input.settings.connectionProfile);
  set("sequentialExtraction", String(input.settings.sequentialExtraction));
  set("maxConcurrentCalls", String(input.settings.maxConcurrentCalls));
  set("strictJsonRepair", String(input.settings.strictJsonRepair));
  set("maxRetriesPerStat", String(input.settings.maxRetriesPerStat));
  set("contextMessages", String(input.settings.contextMessages));
  set("injectPromptDepth", String(input.settings.injectPromptDepth));
  set("maxDeltaPerTurn", String(input.settings.maxDeltaPerTurn));
  set("maxTokensOverride", String(input.settings.maxTokensOverride));
  set("truncationLengthOverride", String(input.settings.truncationLengthOverride));
  set("includeCharacterCardsInPrompt", String(input.settings.includeCharacterCardsInPrompt));
  set("includeLorebookInExtraction", String(input.settings.includeLorebookInExtraction));
  set("lorebookExtractionMaxChars", String(input.settings.lorebookExtractionMaxChars));
  set("confidenceDampening", String(input.settings.confidenceDampening));
  set("moodStickiness", String(input.settings.moodStickiness));
  set("injectTrackerIntoPrompt", String(input.settings.injectTrackerIntoPrompt));
  set("injectionPromptMaxChars", String(input.settings.injectionPromptMaxChars));
  set("summarizationNoteVisibleForAI", String(input.settings.summarizationNoteVisibleForAI));
  set("injectSummarizationNote", String(input.settings.injectSummarizationNote));
  set("autoDetectActive", String(input.settings.autoDetectActive));
  set("activityLookback", String(input.settings.activityLookback));
  set("showInactive", String(input.settings.showInactive));
  set("inactiveLabel", input.settings.inactiveLabel);
  set("showLastThought", String(input.settings.showLastThought));
  set("trackAffection", String(input.settings.trackAffection));
  set("trackTrust", String(input.settings.trackTrust));
  set("trackDesire", String(input.settings.trackDesire));
  set("trackConnection", String(input.settings.trackConnection));
  set("trackMood", String(input.settings.trackMood));
  set("trackLastThought", String(input.settings.trackLastThought));
  set("enableUserTracking", String(input.settings.enableUserTracking));
  set("userTrackMood", String(input.settings.userTrackMood));
  set("userTrackLastThought", String(input.settings.userTrackLastThought));
  set("includeUserTrackerInInjection", String(input.settings.includeUserTrackerInInjection));
  set("moodSource", input.settings.moodSource);
  set("stExpressionImageZoom", String(input.settings.stExpressionImageZoom));
  set("stExpressionImagePositionX", String(input.settings.stExpressionImagePositionX));
  set("stExpressionImagePositionY", String(input.settings.stExpressionImagePositionY));
  const accentInput = modal.querySelector('[data-k-color="accentColor"]') as HTMLInputElement | null;
  if (accentInput) accentInput.value = input.settings.accentColor || "#ff5a6f";
  set("cardOpacity", String(input.settings.cardOpacity));
  set("borderRadius", String(input.settings.borderRadius));
  set("fontSize", String(input.settings.fontSize));
  set("debug", String(input.settings.debug));
  setExtra("debugExtraction", String(input.settings.debugFlags?.extraction ?? true));
  setExtra("debugPrompts", String(input.settings.debugFlags?.prompts ?? true));
  setExtra("debugUi", String(input.settings.debugFlags?.ui ?? true));
  setExtra("debugMoodImages", String(input.settings.debugFlags?.moodImages ?? true));
  setExtra("debugStorage", String(input.settings.debugFlags?.storage ?? true));
  set("includeContextInDiagnostics", String(input.settings.includeContextInDiagnostics));
  set("includeGraphInDiagnostics", String(input.settings.includeGraphInDiagnostics));
  set("promptTemplateUnified", input.settings.promptTemplateUnified);
  set("promptTemplateSequentialAffection", input.settings.promptTemplateSequentialAffection);
  set("promptTemplateSequentialTrust", input.settings.promptTemplateSequentialTrust);
  set("promptTemplateSequentialDesire", input.settings.promptTemplateSequentialDesire);
  set("promptTemplateSequentialConnection", input.settings.promptTemplateSequentialConnection);
  set("promptTemplateSequentialCustomNumeric", input.settings.promptTemplateSequentialCustomNumeric);
  set("promptTemplateSequentialCustomNonNumeric", input.settings.promptTemplateSequentialCustomNonNumeric);
  set("promptTemplateSequentialMood", input.settings.promptTemplateSequentialMood);
  set("promptTemplateSequentialLastThought", input.settings.promptTemplateSequentialLastThought);
  set("promptTemplateInjection", input.settings.promptTemplateInjection);
  set("unlockProtocolPrompts", String(input.settings.unlockProtocolPrompts));
  set("promptProtocolUnified", input.settings.promptProtocolUnified);
  set("promptProtocolSequentialAffection", input.settings.promptProtocolSequentialAffection);
  set("promptProtocolSequentialTrust", input.settings.promptProtocolSequentialTrust);
  set("promptProtocolSequentialDesire", input.settings.promptProtocolSequentialDesire);
  set("promptProtocolSequentialConnection", input.settings.promptProtocolSequentialConnection);
  set("promptProtocolSequentialCustomNumeric", input.settings.promptProtocolSequentialCustomNumeric);
  set("promptProtocolSequentialCustomNonNumeric", input.settings.promptProtocolSequentialCustomNonNumeric);
  set("promptProtocolSequentialMood", input.settings.promptProtocolSequentialMood);
  set("promptProtocolSequentialLastThought", input.settings.promptProtocolSequentialLastThought);

  const initialGlobalStExpressionFrame = getGlobalStExpressionImageOptions(input.settings);
  const readGlobalStExpressionFrame = (): StExpressionImageOptions => {
    const zoomNode = modal.querySelector('[data-k="stExpressionImageZoom"]') as HTMLInputElement | null;
    const positionXNode = modal.querySelector('[data-k="stExpressionImagePositionX"]') as HTMLInputElement | null;
    const positionYNode = modal.querySelector('[data-k="stExpressionImagePositionY"]') as HTMLInputElement | null;
    return sanitizeStExpressionFrame(
      {
        zoom: Number(zoomNode?.value ?? initialGlobalStExpressionFrame.zoom),
        positionX: Number(positionXNode?.value ?? initialGlobalStExpressionFrame.positionX),
        positionY: Number(positionYNode?.value ?? initialGlobalStExpressionFrame.positionY),
      },
      initialGlobalStExpressionFrame,
    );
  };
  const updateGlobalStExpressionSummary = (): void => {
    const summaryNode = modal.querySelector('[data-bst-row="stExpressionImageSummary"]') as HTMLElement | null;
    if (!summaryNode) return;
    summaryNode.textContent = `Current framing: ${formatStExpressionFrameSummary(readGlobalStExpressionFrame())}`;
  };
  updateGlobalStExpressionSummary();
  type GlobalPreviewCharacter = { name: string; spriteUrl: string };
  const globalFrameButton = modal.querySelector('[data-action="open-global-st-framing"]') as HTMLButtonElement | null;
  let globalPreviewCharacters: GlobalPreviewCharacter[] = [];
  let globalPreviewSelected = "";
  const noPreviewFoundText = "No ST expressions found. Add at least one character with ST expressions to use preview framing.";
  const loadGlobalPreviewCharacters = async (): Promise<GlobalPreviewCharacter[]> => {
    const candidates = (input.previewCharacterCandidates ?? [])
      .map(entry => ({
        name: String(entry?.name ?? "").trim(),
        avatar: String(entry?.avatar ?? "").trim() || undefined,
      }))
      .filter(entry => Boolean(entry.name))
      .filter(entry => getResolvedMoodSource(input.settings, entry.name, entry.avatar) === "st_expressions");
    const deduped = Array.from(new Map(candidates.map(entry => [entry.name.toLowerCase(), entry])).values());
    if (!deduped.length) return [];
    const resolved = await Promise.all(deduped.map(async entry => {
      try {
        const spriteUrl = await fetchFirstExpressionSprite(entry.name);
        return spriteUrl ? { name: entry.name, spriteUrl } : null;
      } catch {
        return null;
      }
    }));
    return resolved
      .filter((entry): entry is GlobalPreviewCharacter => Boolean(entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  if (globalFrameButton) globalFrameButton.disabled = false;
  const customStatsListNode = modal.querySelector('[data-bst-row="customStatsList"]') as HTMLElement | null;
  const customAddButton = modal.querySelector('[data-action="custom-add"]') as HTMLButtonElement | null;
  const manageBuiltInsButton = modal.querySelector('[data-action="manage-builtins"]') as HTMLButtonElement | null;

  type CustomStatWizardMode = "add" | "edit" | "duplicate";
  type CustomStatDraft = {
    kind: CustomStatKind;
    label: string;
    id: string;
    description: string;
    behaviorGuidance: string;
    defaultValue: string;
    defaultBoolean: boolean;
    maxDeltaPerTurn: string;
    enumOptionsText: string;
    booleanTrueLabel: string;
    booleanFalseLabel: string;
    textMaxLength: string;
    enabled: boolean;
    includeInInjection: boolean;
    color: string;
    sequentialPromptTemplate: string;
    lockId: boolean;
  };

  const makeDraft = (mode: CustomStatWizardMode, source?: CustomStatDefinition): CustomStatDraft => {
    if (!source) {
      return {
        kind: "numeric",
        label: "",
        id: "",
        description: "",
        behaviorGuidance: "",
        defaultValue: "50",
        defaultBoolean: false,
        maxDeltaPerTurn: "",
        enumOptionsText: "",
        booleanTrueLabel: "enabled",
        booleanFalseLabel: "disabled",
        textMaxLength: "120",
        enabled: true,
        includeInInjection: true,
        color: "",
        sequentialPromptTemplate: "",
        lockId: false,
      };
    }
    const clone = cloneCustomStatDefinition(source);
    const duplicateId = mode === "duplicate"
      ? suggestUniqueCustomStatId(`${clone.id}_copy`, new Set(customStatsState.map(item => item.id)))
      : clone.id;
    const kind = normalizeCustomStatKind(clone.kind);
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(clone.textMaxLength) || 120)));
    return {
      kind,
      label: clone.label,
      id: duplicateId,
      description: clone.description ?? "",
      behaviorGuidance: clone.behaviorGuidance ?? "",
      defaultValue: kind === "numeric"
        ? String(Number.isFinite(Number(clone.defaultValue)) ? Math.round(Number(clone.defaultValue)) : 50)
        : (kind === "boolean" ? "" : String(clone.defaultValue ?? "")),
      defaultBoolean: kind === "boolean" ? Boolean(clone.defaultValue) : false,
      maxDeltaPerTurn: kind === "numeric" && clone.maxDeltaPerTurn != null ? String(Math.round(clone.maxDeltaPerTurn)) : "",
      enumOptionsText: kind === "enum_single" ? normalizeCustomEnumOptions(clone.enumOptions).join("\n") : "",
      booleanTrueLabel: String(clone.booleanTrueLabel ?? "enabled").trim() || "enabled",
      booleanFalseLabel: String(clone.booleanFalseLabel ?? "disabled").trim() || "disabled",
      textMaxLength: kind === "text_short" ? String(textMaxLength) : "120",
      enabled: kind === "numeric"
        ? (clone.track || clone.showOnCard || clone.showInGraph)
        : (clone.track || clone.showOnCard),
      includeInInjection: clone.includeInInjection,
      color: clone.color ?? "",
      sequentialPromptTemplate: clone.sequentialPromptTemplate ?? "",
      lockId: mode === "edit",
    };
  };

  const validateCustomStatDraft = (
    draft: CustomStatDraft,
    mode: CustomStatWizardMode,
    step: number,
    currentId?: string,
  ): string[] => {
    const errors: string[] = [];
    const id = draft.id.trim().toLowerCase();
    const label = draft.label.trim();
    const existingIds = new Set(customStatsState
      .map(item => item.id)
      .filter(item => !currentId || item !== currentId));

    if (step >= 1) {
      if (label.length < 2 || label.length > 40) {
        errors.push("Label must be between 2 and 40 characters.");
      }
      if (!id) {
        errors.push("ID is required.");
      } else if (!CUSTOM_STAT_ID_REGEX.test(id)) {
        errors.push("ID must match: lowercase, numbers, underscore, and start with a letter.");
      } else if (RESERVED_CUSTOM_STAT_IDS.has(id)) {
        errors.push("ID is reserved by the tracker.");
      } else if (existingIds.has(id)) {
        errors.push("ID is already used.");
      }
      if (mode === "edit" && draft.lockId && currentId && id !== currentId) {
        errors.push("ID cannot be changed in edit mode.");
      }
      if (draft.description.trim().length < 3) {
        errors.push("Description is required (at least 3 characters).");
      }
    }

    if (step >= 2) {
      if (draft.kind === "numeric") {
        const defaultValue = Number(draft.defaultValue);
        if (!Number.isFinite(defaultValue) || defaultValue < 0 || defaultValue > 100) {
          errors.push("Default value must be between 0 and 100.");
        }
        if (draft.maxDeltaPerTurn.trim()) {
          const maxDelta = Number(draft.maxDeltaPerTurn);
          if (!Number.isFinite(maxDelta) || maxDelta < 1 || maxDelta > 30) {
            errors.push("Max delta per turn must be between 1 and 30.");
          }
        }
      } else if (draft.kind === "enum_single") {
        const options = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        if (options.length < 2) errors.push("Enum options require at least 2 unique values.");
        if (options.length > 12) errors.push("Enum options allow up to 12 values.");
        if (options.some(option => hasScriptLikeContent(option))) {
          errors.push("Enum values cannot contain script-like content.");
        }
        if (hasScriptLikeContent(String(draft.defaultValue ?? ""))) {
          errors.push("Default enum value cannot contain script-like content.");
        }
        const selected = String(draft.defaultValue ?? "");
        if (!selected.length) {
          errors.push("Default enum value is required.");
        } else if (resolveEnumOption(options, selected) == null) {
          errors.push("Default enum value must match one allowed option.");
        }
      } else if (draft.kind === "boolean") {
        if (!draft.booleanTrueLabel.trim()) errors.push("True label is required for boolean stats.");
        if (!draft.booleanFalseLabel.trim()) errors.push("False label is required for boolean stats.");
      } else if (draft.kind === "text_short") {
        const maxLen = Number(draft.textMaxLength);
        if (!Number.isFinite(maxLen) || maxLen < 20 || maxLen > 200) {
          errors.push("Text max length must be between 20 and 200.");
        }
        const bounded = Math.max(20, Math.min(200, Math.round(maxLen || 120)));
        if (String(draft.defaultValue ?? "").trim().length > bounded) {
          errors.push("Default text exceeds max length.");
        }
      }
    }

    if (step >= 3) {
      if (draft.sequentialPromptTemplate.length > 20000) {
        errors.push("Custom sequential prompt template is too long.");
      }
    }

    if (step >= 4) {
      if (draft.behaviorGuidance.length > 2000) {
        errors.push("Behavior instruction is too long.");
      }
    }

    if (step >= 5) {
      const color = draft.color.trim();
      if (color && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
        errors.push("Color must be empty or a hex value like #66ccff.");
      }
    }

    return errors;
  };

  const toCustomStatDefinition = (draft: CustomStatDraft): CustomStatDefinition => {
    const maxDeltaText = draft.maxDeltaPerTurn.trim();
    const maxDeltaValue = maxDeltaText ? Number(maxDeltaText) : null;
    const behaviorGuidance = draft.behaviorGuidance.trim();
    const color = draft.color.trim();
    const template = draft.sequentialPromptTemplate.trim();
    const kind = normalizeCustomStatKind(draft.kind);
    const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
    const trueLabel = draft.booleanTrueLabel.trim().slice(0, 40) || "enabled";
    const falseLabel = draft.booleanFalseLabel.trim().slice(0, 40) || "disabled";
    const resolvedDefault = (() => {
      if (kind === "numeric") return Math.max(0, Math.min(100, Math.round(Number(draft.defaultValue))));
      if (kind === "boolean") return Boolean(draft.defaultBoolean);
      if (kind === "enum_single") {
        const matched = resolveEnumOption(enumOptions, draft.defaultValue);
        if (matched != null) return matched;
        return enumOptions[0] ?? "";
      }
      return normalizeNonNumericTextValue(draft.defaultValue, textMaxLength);
    })();
    return {
      id: draft.id.trim().toLowerCase(),
      kind,
      label: draft.label.trim(),
      description: draft.description.trim(),
      behaviorGuidance: behaviorGuidance || undefined,
      defaultValue: resolvedDefault,
      maxDeltaPerTurn: kind === "numeric" && maxDeltaValue != null && Number.isFinite(maxDeltaValue)
        ? Math.max(1, Math.min(30, Math.round(maxDeltaValue)))
        : undefined,
      enumOptions: kind === "enum_single" ? enumOptions : undefined,
      booleanTrueLabel: kind === "boolean" ? trueLabel : undefined,
      booleanFalseLabel: kind === "boolean" ? falseLabel : undefined,
      textMaxLength: kind === "text_short" ? textMaxLength : undefined,
      track: draft.enabled,
      includeInInjection: draft.includeInInjection,
      showOnCard: draft.enabled,
      showInGraph: kind === "numeric" ? draft.enabled : false,
      color: color || undefined,
      sequentialPromptTemplate: template || undefined,
    };
  };

  const renderCustomStatsList = (): void => {
    if (!customStatsListNode) return;
    if (customAddButton) {
      customAddButton.disabled = customStatsState.length >= MAX_CUSTOM_STATS;
      customAddButton.title = customAddButton.disabled
        ? `Maximum ${MAX_CUSTOM_STATS} custom stats reached.`
        : "Add custom stat";
    }
    if (!customStatsState.length) {
      customStatsListNode.innerHTML = `
        <div class="bst-custom-stat-empty">
          No custom stats yet. Add one to track extra dimensions without changing built-in defaults.
        </div>
      `;
      return;
    }
    customStatsListNode.innerHTML = customStatsState.map(stat => {
      const kind = normalizeCustomStatKind(stat.kind);
      const flags = [
        stat.track || stat.showOnCard || stat.showInGraph ? "enabled" : "disabled",
        kind,
        stat.includeInInjection ? "injection" : "no injection",
      ];
      const description = (stat.description ?? "").trim();
      const defaultMeta = (() => {
        if (kind === "numeric") {
          return `Default: ${Math.round(Number(stat.defaultValue) || 0)}% | Max delta: ${stat.maxDeltaPerTurn == null ? "global" : Math.round(Number(stat.maxDeltaPerTurn))}`;
        }
        if (kind === "boolean") {
          const trueLabel = String(stat.booleanTrueLabel ?? "enabled").trim() || "enabled";
          const falseLabel = String(stat.booleanFalseLabel ?? "disabled").trim() || "disabled";
          return `Default: ${Boolean(stat.defaultValue) ? trueLabel : falseLabel} | Graph: disabled`;
        }
        if (kind === "enum_single") {
          const options = normalizeCustomEnumOptions(stat.enumOptions);
          return `Default: ${String(stat.defaultValue ?? "").trim() || "(empty)"} | Options: ${options.length} | Graph: disabled`;
        }
        const limit = Math.max(20, Math.min(200, Math.round(Number(stat.textMaxLength) || 120)));
        return `Default: ${String(stat.defaultValue ?? "").trim() || "(empty)"} | Max length: ${limit} | Graph: disabled`;
      })();
      return `
        <div class="bst-custom-stat-row" data-bst-custom-id="${escapeHtml(stat.id)}">
          <div class="bst-custom-stat-main">
            <div class="bst-custom-stat-title">
              <span>${escapeHtml(stat.label)}</span>
              <span class="bst-custom-stat-id">${escapeHtml(stat.id)}</span>
            </div>
            <div class="bst-custom-stat-meta">
              ${escapeHtml(defaultMeta)}
            </div>
            ${description ? `<div class="bst-custom-stat-meta">${escapeHtml(description)}</div>` : ""}
            <div class="bst-custom-stat-flags">
              ${flags.map(flag => `<span class="bst-custom-stat-flag">${escapeHtml(flag)}</span>`).join("")}
            </div>
          </div>
          <div class="bst-custom-stat-actions">
            <button type="button" class="bst-btn bst-btn-soft" data-action="custom-edit" data-custom-id="${escapeHtml(stat.id)}">Edit</button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="custom-duplicate" data-custom-id="${escapeHtml(stat.id)}">Clone</button>
            <button type="button" class="bst-btn bst-btn-danger" data-action="custom-remove" data-custom-id="${escapeHtml(stat.id)}">Remove</button>
          </div>
        </div>
      `;
    }).join("");
  };

  const closeCustomWizard = (): void => {
    document.querySelector(".bst-custom-wizard-backdrop")?.remove();
    document.querySelector(".bst-custom-wizard")?.remove();
  };

  const openBuiltInManagerWizard = (): void => {
    closeCustomWizard();
    const current = collectSettings();
    const draftUi = cloneBuiltInNumericStatUi(current.builtInNumericStatUi);
    const draftTrack: Record<(typeof BUILT_IN_TRACKABLE_STAT_KEY_LIST)[number], boolean> = {
      affection: current.trackAffection,
      trust: current.trackTrust,
      desire: current.trackDesire,
      connection: current.trackConnection,
      mood: current.trackMood,
      lastThought: current.trackLastThought,
    };

    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    const renderRows = (): string =>
      BUILT_IN_TRACKABLE_STAT_KEY_LIST.map(key => {
        const isNumeric = BUILT_IN_NUMERIC_STAT_KEYS.has(key);
        const enabled = isNumeric
          ? (draftTrack[key] || draftUi[key as keyof BuiltInNumericStatUiSettings].showOnCard || draftUi[key as keyof BuiltInNumericStatUiSettings].showInGraph)
          : draftTrack[key];
        return `
        <div class="bst-custom-stat-row">
          <div class="bst-custom-stat-main">
            <div class="bst-custom-stat-title">
              <span>${escapeHtml(BUILT_IN_STAT_LABELS[key])}</span>
              <span class="bst-custom-stat-id">${escapeHtml(key)}</span>
            </div>
          </div>
          <div class="bst-check-grid bst-toggle-block ${isNumeric ? "" : "bst-check-grid-single"}">
            <label class="bst-check"><input type="checkbox" data-bst-builtin-enabled="${key}" ${enabled ? "checked" : ""}>${isNumeric ? "Enabled (Track + Card + Graph)" : "Enabled (Track)"}</label>
            ${isNumeric
              ? `<label class="bst-check"><input type="checkbox" data-bst-builtin-inject="${key}" ${draftUi[key as keyof BuiltInNumericStatUiSettings].includeInInjection ? "checked" : ""}>Include in prompt injection</label>`
              : ""}
          </div>
        </div>
      `;
      }).join("");

    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Manage Built-in Stats</div>
          <div class="bst-custom-wizard-step" data-bst-builtin-step>Step 1 / 2</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-panel is-active" data-bst-builtin-panel="1">
        <div class="bst-help-line">Built-in stats are never deleted. You can manage whether each one is enabled.</div>
        <ul class="bst-help-list">
          <li><strong>Enabled</strong>: one toggle for Track + Card + Graph on numeric built-ins, and Track on text built-ins.</li>
          <li><strong>Include in prompt injection</strong>: controls prompt injection lines for numeric built-ins.</li>
        </ul>
      </div>
      <div class="bst-custom-wizard-panel" data-bst-builtin-panel="2">
        <div class="bst-help-line">Configure built-in stats behavior:</div>
        ${renderRows()}
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="builtin-back">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="builtin-next">Next</button>
          <button type="button" class="bst-btn bst-btn-soft" data-action="builtin-save" style="display:none;">Save</button>
        </div>
      </div>
    `;

    const stepLabel = wizard.querySelector('[data-bst-builtin-step]') as HTMLElement | null;
    const panel1 = wizard.querySelector('[data-bst-builtin-panel="1"]') as HTMLElement | null;
    const panel2 = wizard.querySelector('[data-bst-builtin-panel="2"]') as HTMLElement | null;
    const backBtn = wizard.querySelector('[data-action="builtin-back"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="builtin-next"]') as HTMLButtonElement | null;
    const saveBtn = wizard.querySelector('[data-action="builtin-save"]') as HTMLButtonElement | null;
    let step = 1;

    const syncStep = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 2`;
      panel1?.classList.toggle("is-active", step === 1);
      panel2?.classList.toggle("is-active", step === 2);
      if (backBtn) backBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 1 ? "" : "none";
      if (saveBtn) saveBtn.style.display = step === 2 ? "" : "none";
    };

    const applyFromDom = (): void => {
      for (const key of BUILT_IN_TRACKABLE_STAT_KEY_LIST) {
        const enabled = Boolean((wizard.querySelector(`[data-bst-builtin-enabled="${key}"]`) as HTMLInputElement | null)?.checked);
        draftTrack[key] = enabled;
        if (BUILT_IN_NUMERIC_STAT_KEYS.has(key)) {
          const numericKey = key as (typeof BUILT_IN_NUMERIC_STAT_KEY_LIST)[number];
          draftUi[numericKey].showOnCard = enabled;
          draftUi[numericKey].showInGraph = enabled;
          draftUi[numericKey].includeInInjection = Boolean((wizard.querySelector(`[data-bst-builtin-inject="${key}"]`) as HTMLInputElement | null)?.checked);
        }
      }
    };

    const close = (): void => closeCustomWizard();
    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    backBtn?.addEventListener("click", () => {
      step = 1;
      syncStep();
    });
    nextBtn?.addEventListener("click", () => {
      step = 2;
      syncStep();
    });
    saveBtn?.addEventListener("click", () => {
      applyFromDom();
      builtInNumericStatUiState = cloneBuiltInNumericStatUi(draftUi);
      input.settings.trackAffection = draftTrack.affection;
      input.settings.trackTrust = draftTrack.trust;
      input.settings.trackDesire = draftTrack.desire;
      input.settings.trackConnection = draftTrack.connection;
      input.settings.trackMood = draftTrack.mood;
      input.settings.trackLastThought = draftTrack.lastThought;
      close();
      persistLive();
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
    syncStep();
  };

  const openCustomRemoveWizard = (target: CustomStatDefinition): void => {
    closeCustomWizard();
    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Remove Custom Stat</div>
          <div class="bst-custom-wizard-step" data-bst-remove-step>Step 1 / 2</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-panel is-active" data-bst-remove-panel="1">
        <div class="bst-help-line"><strong>${escapeHtml(target.label)}</strong> (${escapeHtml(target.id)}) will be removed from active definitions.</div>
        <ul class="bst-help-list">
          <li>Future extraction will stop updating this stat.</li>
          <li>Cards/graph/injection will stop showing this stat.</li>
          <li>Historical snapshot payload is retained (soft remove).</li>
        </ul>
      </div>
      <div class="bst-custom-wizard-panel" data-bst-remove-panel="2">
        <div class="bst-help-line">Confirm removal of <strong>${escapeHtml(target.label)}</strong>.</div>
        <div class="bst-help-line">This is a soft remove only in current release.</div>
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-remove-back">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-remove-next">Next</button>
          <button type="button" class="bst-btn bst-btn-danger" data-action="custom-remove-confirm" style="display:none;">Remove Stat</button>
        </div>
      </div>
    `;
    const stepLabel = wizard.querySelector("[data-bst-remove-step]") as HTMLElement | null;
    const panel1 = wizard.querySelector('[data-bst-remove-panel="1"]') as HTMLElement | null;
    const panel2 = wizard.querySelector('[data-bst-remove-panel="2"]') as HTMLElement | null;
    const backBtn = wizard.querySelector('[data-action="custom-remove-back"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="custom-remove-next"]') as HTMLButtonElement | null;
    const confirmBtn = wizard.querySelector('[data-action="custom-remove-confirm"]') as HTMLButtonElement | null;
    let step = 1;

    const syncStep = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 2`;
      panel1?.classList.toggle("is-active", step === 1);
      panel2?.classList.toggle("is-active", step === 2);
      if (backBtn) backBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 1 ? "" : "none";
      if (confirmBtn) confirmBtn.style.display = step === 2 ? "" : "none";
    };
    syncStep();

    const close = (): void => closeCustomWizard();
    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    backBtn?.addEventListener("click", () => {
      step = 1;
      syncStep();
    });
    nextBtn?.addEventListener("click", () => {
      step = 2;
      syncStep();
    });
    confirmBtn?.addEventListener("click", () => {
      customStatsState = customStatsState.filter(item => item.id !== target.id);
      renderCustomStatsList();
      close();
      persistLive();
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
  };

  const openCustomStatWizard = (mode: CustomStatWizardMode, source?: CustomStatDefinition): void => {
    if (mode === "add" && customStatsState.length >= MAX_CUSTOM_STATS) return;
    closeCustomWizard();

    const existingIds = new Set(customStatsState.map(item => item.id));
    const fallbackBase = source?.label || source?.id || "custom_stat";
    const draft = makeDraft(mode, source);
    if (mode === "add" && !draft.id) {
      draft.id = suggestUniqueCustomStatId(fallbackBase, existingIds);
    }

    let idTouched = Boolean(draft.id && mode !== "add");
    let step = 1;

    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">${mode === "edit" ? "Edit" : mode === "duplicate" ? "Clone" : "Add"} Custom Stat</div>
          <div class="bst-custom-wizard-step" data-bst-custom-step>Step 1 / 6</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-error" data-bst-custom-error></div>

      <div class="bst-custom-wizard-panel is-active" data-bst-custom-panel="1">
        <div class="bst-custom-wizard-grid">
          <label>Label
            <input type="text" data-bst-custom-field="label" maxlength="40" value="${escapeHtml(draft.label)}" placeholder="e.g. Respect">
          </label>
          <label>ID
            <input type="text" data-bst-custom-field="id" maxlength="32" value="${escapeHtml(draft.id)}" ${draft.lockId ? "readonly" : ""} placeholder="respect">
          </label>
          <label>Type
            <select data-bst-custom-field="kind">
              <option value="numeric" ${draft.kind === "numeric" ? "selected" : ""}>Numeric (0-100)</option>
              <option value="enum_single" ${draft.kind === "enum_single" ? "selected" : ""}>Enum (single choice)</option>
              <option value="boolean" ${draft.kind === "boolean" ? "selected" : ""}>Boolean (true/false)</option>
              <option value="text_short" ${draft.kind === "text_short" ? "selected" : ""}>Short text</option>
            </select>
          </label>
        </div>
        <label>Description
          <textarea data-bst-custom-field="description" rows="4" maxlength="${CUSTOM_STAT_DESCRIPTION_MAX_LENGTH}" placeholder="Required. Explain what this stat represents and how extraction should interpret it.">${escapeHtml(draft.description)}</textarea>
        </label>
        <div class="bst-custom-char-counter" data-bst-custom-description-counter></div>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-improve-description" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-description-btn-label>Improve description with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-description-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="2">
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="numeric">
          <label>Default Value (%)
            <input type="number" min="0" max="100" data-bst-custom-field="numericDefaultValue" value="${escapeHtml(draft.kind === "numeric" ? draft.defaultValue : "50")}">
          </label>
          <label>Max Delta Per Turn
            <input type="number" min="1" max="30" data-bst-custom-field="maxDeltaPerTurn" value="${escapeHtml(draft.maxDeltaPerTurn)}" placeholder="Use global">
          </label>
        </div>
        <div class="bst-custom-wizard-grid bst-custom-wizard-grid-single" data-bst-kind-panel="enum_single" style="display:none;">
          <label>Allowed Values (2-12, one per line)
            <textarea data-bst-custom-field="enumOptionsText" rows="5" placeholder="guarded&#10;cautious&#10;open">${escapeHtml(draft.enumOptionsText)}</textarea>
          </label>
          <label>Default Enum Value
            <input type="text" data-bst-custom-field="enumDefaultValue" maxlength="200" value="${escapeHtml(draft.kind === "enum_single" ? draft.defaultValue : "")}" placeholder="guarded">
          </label>
        </div>
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="boolean" style="display:none;">
          <label>Default Value
            <select data-bst-custom-field="defaultBoolean">
              <option value="true" ${draft.defaultBoolean ? "selected" : ""}>True</option>
              <option value="false" ${!draft.defaultBoolean ? "selected" : ""}>False</option>
            </select>
          </label>
          <label>True Label
            <input type="text" data-bst-custom-field="booleanTrueLabel" maxlength="40" value="${escapeHtml(draft.booleanTrueLabel)}" placeholder="enabled">
          </label>
          <label>False Label
            <input type="text" data-bst-custom-field="booleanFalseLabel" maxlength="40" value="${escapeHtml(draft.booleanFalseLabel)}" placeholder="disabled">
          </label>
        </div>
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="text_short" style="display:none;">
          <label>Default Text
            <input type="text" data-bst-custom-field="textDefaultValue" value="${escapeHtml(draft.kind === "text_short" ? draft.defaultValue : "")}" placeholder="focused on de-escalation">
          </label>
          <label>Text Max Length (20-200)
            <input type="number" min="20" max="200" data-bst-custom-field="textMaxLength" value="${escapeHtml(draft.textMaxLength)}">
          </label>
        </div>
        <div class="bst-help-line" data-bst-kind-help="value">Numeric stats use 0-100 with optional max delta. Non-numeric stats store absolute values and do not use delta.</div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="3">
        <div class="bst-check-grid bst-toggle-block">
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="enabled" ${draft.enabled ? "checked" : ""}><span data-bst-kind-help="enabledLabel">Enabled (Track + Card + Graph)</span></label>
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="includeInInjection" ${draft.includeInInjection ? "checked" : ""}>Include in prompt injection</label>
        </div>
        <label>Per-Stat Prompt Override (optional)
          <textarea data-bst-custom-field="sequentialPromptTemplate" rows="6" placeholder="Optional per-stat override used in all extraction modes. Leave empty to use the global custom-stat fallback for this kind.">${escapeHtml(draft.sequentialPromptTemplate)}</textarea>
        </label>
        <div class="bst-help-line" data-bst-kind-help="templateFallback">Used in all extraction modes. Empty override uses global Custom Numeric Default.</div>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-generate-template" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-template-btn-label>Generate with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-template-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="4">
        <div class="bst-help-line">Optional behavior instruction for prompt injection. Describe how this stat value should shape behavior, with clear increase/decrease evidence cues.</div>
        <label>Behavior Instruction (optional)
          <textarea data-bst-custom-field="behaviorGuidance" rows="6" placeholder="Optional. Example:\n- low focus -> easily distracted, short replies, weak follow-through.\n- medium focus -> generally attentive but can drift during long exchanges.\n- high focus -> sustained attention, user-first responses, clear follow-through.\n- increase cues -> direct user engagement, clarifying questions, consistent follow-up.\n- decrease cues -> evasive replies, frequent topic drift, delayed/partial engagement.">${escapeHtml(draft.behaviorGuidance)}</textarea>
        </label>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-generate-behavior" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-behavior-btn-label>Generate with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-behavior-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="5">
        <div class="bst-help-line" data-bst-kind-help="color">Color helps visually distinguish this stat in cards and graph.</div>
        <label>Color (optional)
          <div class="bst-color-inputs">
            <input type="color" data-bst-custom-color-picker value="#66ccff" aria-label="Custom stat color picker">
            <input type="text" data-bst-custom-field="color" value="${escapeHtml(draft.color)}" placeholder="#66ccff">
          </div>
        </label>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="6">
        <div class="bst-help-line">Review before saving:</div>
        <pre class="bst-custom-wizard-review" data-bst-custom-review></pre>
      </div>

      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-prev">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-next">Next</button>
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-save" style="display:none;">Save</button>
        </div>
      </div>
    `;

    const stepLabel = wizard.querySelector("[data-bst-custom-step]") as HTMLElement | null;
    const errorNode = wizard.querySelector("[data-bst-custom-error]") as HTMLElement | null;
    const reviewNode = wizard.querySelector("[data-bst-custom-review]") as HTMLElement | null;
    const prevBtn = wizard.querySelector('[data-action="custom-prev"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="custom-next"]') as HTMLButtonElement | null;
    const saveBtn = wizard.querySelector('[data-action="custom-save"]') as HTMLButtonElement | null;
    const improveDescriptionBtn = wizard.querySelector('[data-action="custom-improve-description"]') as HTMLButtonElement | null;
    const improveDescriptionLabelNode = wizard.querySelector("[data-bst-custom-description-btn-label]") as HTMLElement | null;
    const improveDescriptionStatusNode = wizard.querySelector("[data-bst-custom-description-status]") as HTMLElement | null;
    const descriptionCounterNode = wizard.querySelector("[data-bst-custom-description-counter]") as HTMLElement | null;
    const generateTemplateBtn = wizard.querySelector('[data-action="custom-generate-template"]') as HTMLButtonElement | null;
    const generateTemplateLabelNode = wizard.querySelector("[data-bst-custom-template-btn-label]") as HTMLElement | null;
    const generateStatusNode = wizard.querySelector("[data-bst-custom-template-status]") as HTMLElement | null;
    const generateBehaviorBtn = wizard.querySelector('[data-action="custom-generate-behavior"]') as HTMLButtonElement | null;
    const generateBehaviorLabelNode = wizard.querySelector("[data-bst-custom-behavior-btn-label]") as HTMLElement | null;
    const generateBehaviorStatusNode = wizard.querySelector("[data-bst-custom-behavior-status]") as HTMLElement | null;
    const getField = (name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null =>
      wizard.querySelector(`[data-bst-custom-field="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    const colorPickerNode = wizard.querySelector('[data-bst-custom-color-picker]') as HTMLInputElement | null;
    let generateDescriptionRequestId = 0;
    let generateTemplateRequestId = 0;
    let generateBehaviorRequestId = 0;
    let generatingDescription = false;
    let generatingTemplate = false;
    let generatingBehavior = false;

    const toPickerHex = (raw: string, fallback: string): string => {
      const value = raw.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
      if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        const r = value[1];
        const g = value[2];
        const b = value[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
      }
      return fallback;
    };

    const syncDraftFromFields = (): void => {
      const labelNode = getField("label");
      const idNode = getField("id");
      const kindNode = getField("kind") as HTMLSelectElement | null;
      const descriptionNode = getField("description");
      const behaviorGuidanceNode = getField("behaviorGuidance");
      const numericDefaultNode = getField("numericDefaultValue");
      const enumDefaultNode = getField("enumDefaultValue");
      const textDefaultNode = getField("textDefaultValue");
      const defaultBooleanNode = getField("defaultBoolean") as HTMLSelectElement | null;
      const maxDeltaNode = getField("maxDeltaPerTurn");
      const enumOptionsNode = getField("enumOptionsText");
      const trueLabelNode = getField("booleanTrueLabel");
      const falseLabelNode = getField("booleanFalseLabel");
      const textMaxLengthNode = getField("textMaxLength");
      const enabledNode = getField("enabled") as HTMLInputElement | null;
      const injectNode = getField("includeInInjection") as HTMLInputElement | null;
      const colorNode = getField("color");
      const templateNode = getField("sequentialPromptTemplate");
      draft.label = String(labelNode?.value ?? "");
      draft.id = String(idNode?.value ?? "").toLowerCase();
      draft.kind = normalizeCustomStatKind(kindNode?.value);
      draft.description = String(descriptionNode?.value ?? "");
      draft.behaviorGuidance = String(behaviorGuidanceNode?.value ?? "");
      if (draft.kind === "numeric") {
        draft.defaultValue = String(numericDefaultNode?.value ?? "");
      } else if (draft.kind === "enum_single") {
        draft.defaultValue = String(enumDefaultNode?.value ?? "");
      } else if (draft.kind === "text_short") {
        draft.defaultValue = String(textDefaultNode?.value ?? "");
      } else {
        draft.defaultValue = "";
      }
      draft.defaultBoolean = String(defaultBooleanNode?.value ?? "false").toLowerCase() === "true";
      draft.maxDeltaPerTurn = String(maxDeltaNode?.value ?? "");
      draft.enumOptionsText = String(enumOptionsNode?.value ?? "");
      draft.booleanTrueLabel = String(trueLabelNode?.value ?? "");
      draft.booleanFalseLabel = String(falseLabelNode?.value ?? "");
      draft.textMaxLength = String(textMaxLengthNode?.value ?? "");
      draft.enabled = Boolean(enabledNode?.checked);
      draft.includeInInjection = Boolean(injectNode?.checked);
      draft.color = String(colorNode?.value ?? "");
      draft.sequentialPromptTemplate = String(templateNode?.value ?? "");
    };

    const syncColorPickerFromText = (): void => {
      if (!colorPickerNode) return;
      const colorNode = getField("color") as HTMLInputElement | null;
      const fallback = toPickerHex(input.settings.accentColor || "#66ccff", "#66ccff");
      colorPickerNode.value = toPickerHex(String(colorNode?.value ?? ""), fallback);
    };

    const syncColorTextFromPicker = (): void => {
      const colorNode = getField("color") as HTMLInputElement | null;
      if (!colorNode || !colorPickerNode) return;
      colorNode.value = colorPickerNode.value;
    };

    const writeReview = (): void => {
      if (!reviewNode) return;
      const normalized = toCustomStatDefinition(draft);
      reviewNode.textContent = JSON.stringify(normalized, null, 2);
    };

    const updateDescriptionCounter = (): void => {
      if (!descriptionCounterNode) return;
      const descriptionNode = getField("description") as HTMLTextAreaElement | null;
      if (!descriptionNode) return;
      const maxLength = Number(descriptionNode.getAttribute("maxlength")) || CUSTOM_STAT_DESCRIPTION_MAX_LENGTH;
      const currentLength = descriptionNode.value.length;
      descriptionCounterNode.textContent = `${currentLength}/${maxLength} chars`;
      const warnThreshold = Math.max(1, maxLength - 30);
      const state = currentLength >= maxLength ? "limit" : currentLength >= warnThreshold ? "warn" : "ok";
      descriptionCounterNode.setAttribute("data-state", state);
    };

    const syncKindUi = (): void => {
      const kind = normalizeCustomStatKind(draft.kind);
      wizard.querySelectorAll<HTMLElement>("[data-bst-kind-panel]").forEach(panel => {
        const panelKind = String(panel.dataset.bstKindPanel ?? "");
        panel.style.display = panelKind === kind ? (panel.classList.contains("bst-custom-wizard-grid") ? "grid" : "block") : "none";
      });

      const enabledHelpNode = wizard.querySelector('[data-bst-kind-help="enabledLabel"]') as HTMLElement | null;
      if (enabledHelpNode) {
        enabledHelpNode.textContent = kind === "numeric"
          ? "Enabled (Track + Card + Graph)"
          : "Enabled (Track + Card)";
      }

      const fallbackHelpNode = wizard.querySelector('[data-bst-kind-help="templateFallback"]') as HTMLElement | null;
      if (fallbackHelpNode) {
        fallbackHelpNode.textContent = kind === "numeric"
          ? "Used in all extraction modes. Empty override uses global Custom Numeric Default."
          : "Used in all extraction modes. Empty override uses global Custom Non-Numeric Default.";
      }

      const valueHelpNode = wizard.querySelector('[data-bst-kind-help="value"]') as HTMLElement | null;
      if (valueHelpNode) {
        if (kind === "numeric") {
          valueHelpNode.textContent = "Numeric stats use 0-100 with optional max delta.";
        } else if (kind === "enum_single") {
          valueHelpNode.textContent = "Enum stats store one value from the allowed list (no delta, no graph).";
        } else if (kind === "boolean") {
          valueHelpNode.textContent = "Boolean stats store true/false (no delta, no graph).";
        } else {
          valueHelpNode.textContent = "Short text stats store concise single-line state text (no delta, no graph).";
        }
      }

      const colorHelpNode = wizard.querySelector('[data-bst-kind-help="color"]') as HTMLElement | null;
      if (colorHelpNode) {
        colorHelpNode.textContent = kind === "numeric"
          ? "Color helps visually distinguish this stat in cards and graph."
          : "Color helps visually distinguish this stat on cards. Non-numeric stats are not graphed in this version.";
      }

      const templateNode = getField("sequentialPromptTemplate") as HTMLTextAreaElement | null;
      if (templateNode) {
        templateNode.placeholder = kind === "numeric"
          ? "Optional per-stat override used in all extraction modes. Literal example: Update only respect_score deltas from recent messages based on respect cues. Leave empty to use global Custom Numeric Default."
          : "Optional per-stat override used in all extraction modes. Literal example: Update only stance value for {{statId}} using allowed values and recent conversational cues. Leave empty to use global Custom Non-Numeric Default.";
      }

      const behaviorNode = getField("behaviorGuidance") as HTMLTextAreaElement | null;
      if (behaviorNode) {
        if (kind === "numeric") {
          behaviorNode.placeholder = "Optional. Example:\n- low focus -> easily distracted, short replies, weak follow-through.\n- medium focus -> generally attentive but can drift during long exchanges.\n- high focus -> sustained attention, user-first responses, clear follow-through.\n- increase cues -> direct user engagement, clarifying questions, consistent follow-up.\n- decrease cues -> evasive replies, frequent topic drift, delayed/partial engagement.";
        } else if (kind === "enum_single") {
          behaviorNode.placeholder = "Optional. Example:\n- guarded -> cautious tone, minimal disclosure.\n- cautious -> polite engagement with measured openness.\n- open -> proactive engagement and clearer emotional availability.\n- increase cues -> explicit trust/rapport signs.\n- decrease cues -> conflict, withdrawal, contradiction.";
        } else if (kind === "boolean") {
          behaviorNode.placeholder = "Optional. Example:\n- {{statId}} true -> behavior follows the enabled state.\n- {{statId}} false -> behavior follows the disabled state.\n- increase cues -> evidence that should switch to true.\n- decrease cues -> evidence that should switch to false.";
        } else {
          behaviorNode.placeholder = "Optional. Example:\n- interpret {{statId}} as short scene-state text.\n- keep responses aligned with the current text state.\n- increase cues -> evidence to update the text state.\n- decrease cues -> evidence to simplify or reset the text state.";
        }
      }
    };

    const syncStepUi = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 6`;
      Array.from(wizard.querySelectorAll("[data-bst-custom-panel]")).forEach(panel => {
        const element = panel as HTMLElement;
        const panelStep = Number(element.dataset.bstCustomPanel ?? "1");
        element.classList.toggle("is-active", panelStep === step);
      });
      if (prevBtn) prevBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 6 ? "none" : "";
      if (saveBtn) saveBtn.style.display = step === 6 ? "" : "none";
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
    };

    const setErrors = (errors: string[]): boolean => {
      if (!errorNode) return errors.length === 0;
      if (!errors.length) {
        errorNode.style.display = "none";
        errorNode.textContent = "";
        return true;
      }
      errorNode.style.display = "block";
      errorNode.textContent = errors.join("\n");
      return false;
    };

    const setGenerateStatus = (
      node: HTMLElement | null,
      fallback: string,
      state: "idle" | "loading" | "success" | "error",
      message?: string,
    ): void => {
      if (!node) return;
      const text = String(message ?? "").trim();
      if (!text && state === "idle") {
        node.textContent = fallback;
        node.setAttribute("data-state", "idle");
        return;
      }
      node.textContent = text;
      node.setAttribute("data-state", state);
    };

    const setButtonLoading = (
      button: HTMLButtonElement | null,
      labelNode: HTMLElement | null,
      loading: boolean,
      loadingLabel: string,
      idleLabel: string,
    ): void => {
      if (button) {
        button.disabled = loading;
        button.setAttribute("data-loading", loading ? "true" : "false");
      }
      if (labelNode) {
        labelNode.textContent = loading ? loadingLabel : idleLabel;
      }
    };

    const setDescriptionGenerateLoading = (loading: boolean): void => {
      generatingDescription = loading;
      setButtonLoading(
        improveDescriptionBtn,
        improveDescriptionLabelNode,
        loading,
        "Improving...",
        "Improve description with AI",
      );
    };

    const setTemplateGenerateLoading = (loading: boolean): void => {
      generatingTemplate = loading;
      setButtonLoading(
        generateTemplateBtn,
        generateTemplateLabelNode,
        loading,
        "Generating...",
        "Generate with AI",
      );
    };

    const setBehaviorGenerateLoading = (loading: boolean): void => {
      generatingBehavior = loading;
      setButtonLoading(
        generateBehaviorBtn,
        generateBehaviorLabelNode,
        loading,
        "Generating...",
        "Generate with AI",
      );
    };

    const close = (): void => {
      generateDescriptionRequestId += 1;
      generateTemplateRequestId += 1;
      generateBehaviorRequestId += 1;
      setDescriptionGenerateLoading(false);
      setTemplateGenerateLoading(false);
      setBehaviorGenerateLoading(false);
      closeCustomWizard();
    };
    const currentId = source?.id;
    const validateCurrentStep = (): boolean => {
      syncDraftFromFields();
      return setErrors(validateCustomStatDraft(draft, mode, step, currentId));
    };

    const validateAll = (): boolean => {
      syncDraftFromFields();
      return setErrors(validateCustomStatDraft(draft, mode, 5, currentId));
    };

    const labelInput = getField("label") as HTMLInputElement | null;
    const idInput = getField("id") as HTMLInputElement | null;
    const kindInput = getField("kind") as HTMLSelectElement | null;
    const colorTextInput = getField("color") as HTMLInputElement | null;
    labelInput?.addEventListener("input", () => {
      if (draft.lockId || idTouched) return;
      if (!idInput) return;
      const suggested = toCustomStatSlug(labelInput.value || "stat");
      const existing = new Set(customStatsState
        .map(item => item.id)
        .filter(item => item !== source?.id));
      idInput.value = suggestUniqueCustomStatId(suggested, existing);
    });
    idInput?.addEventListener("input", () => {
      idTouched = true;
      idInput.value = idInput.value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    });
    kindInput?.addEventListener("change", () => {
      syncDraftFromFields();
      syncKindUi();
      writeReview();
    });
    const applyPickerColor = (): void => {
      // Firefox may emit only "change" for <input type="color"> dialog commits.
      syncColorTextFromPicker();
      syncDraftFromFields();
      writeReview();
    };
    colorPickerNode?.addEventListener("input", applyPickerColor);
    colorPickerNode?.addEventListener("change", applyPickerColor);
    colorTextInput?.addEventListener("input", () => {
      syncColorPickerFromText();
    });
    syncColorPickerFromText();
    setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "idle");
    setGenerateStatus(generateStatusNode, "Uses current connection profile.", "idle");
    setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "idle");

    improveDescriptionBtn?.addEventListener("click", async () => {
      if (generatingDescription) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();

      if (!label) generationErrors.push("Label is required before AI description improvement.");
      if (!statId) generationErrors.push("ID is required before AI description improvement.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Write a draft description before AI improvement.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateDescriptionRequestId;
      setDescriptionGenerateLoading(true);
      setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "loading", "Improving description...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildCustomStatDescriptionGenerationPrompt({
          statId,
          statLabel: label,
          currentDescription: description,
          statKind,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateDescriptionRequestId) return;

        const cleaned = sanitizeGeneratedCustomDescription(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty description text. Try again.");
        }
        if (cleaned.length < 3) {
          throw new Error("AI description is too short. Try again.");
        }

        const descriptionNode = getField("description") as HTMLTextAreaElement | null;
        if (!descriptionNode) {
          throw new Error("Description field is unavailable.");
        }
        descriptionNode.value = cleaned;
        descriptionNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "success", "Improved. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.description.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: cleaned.length,
        });
      } catch (error) {
        if (requestId !== generateDescriptionRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "error", message || "Description improvement failed. Try again.");
      } finally {
        if (requestId === generateDescriptionRequestId) {
          setDescriptionGenerateLoading(false);
        }
      }
    });

    generateTemplateBtn?.addEventListener("click", async () => {
      if (generatingTemplate) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();

      if (!label) generationErrors.push("Label is required before AI generation.");
      if (!statId) generationErrors.push("ID is required before AI generation.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Description is required before AI generation.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateTemplateRequestId;
      setTemplateGenerateLoading(true);
      setGenerateStatus(generateStatusNode, "Uses current connection profile.", "loading", "Generating instruction...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildSequentialCustomOverrideGenerationPrompt({
          statId,
          statLabel: label,
          statDescription: description,
          statKind,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateTemplateRequestId) return;

        const cleaned = sanitizeGeneratedSequentialTemplate(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty instruction text. Try again.");
        }
        const statSpecificTemplate = cleaned
          .replaceAll("{{statId}}", statId)
          .replaceAll("{{statLabel}}", label)
          .replaceAll("{{statDescription}}", description);

        const templateNode = getField("sequentialPromptTemplate") as HTMLTextAreaElement | null;
        if (!templateNode) {
          throw new Error("Sequential template field is unavailable.");
        }
        templateNode.value = statSpecificTemplate;
        templateNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.override.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: statSpecificTemplate.length,
        });
      } catch (error) {
        if (requestId !== generateTemplateRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === generateTemplateRequestId) {
          setTemplateGenerateLoading(false);
        }
      }
    });

    generateBehaviorBtn?.addEventListener("click", async () => {
      if (generatingBehavior) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();
      const behaviorGuidance = draft.behaviorGuidance.trim();

      if (!label) generationErrors.push("Label is required before AI generation.");
      if (!statId) generationErrors.push("ID is required before AI generation.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Description is required before AI generation.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateBehaviorRequestId;
      setBehaviorGenerateLoading(true);
      setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "loading", "Generating behavior instruction...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildCustomStatBehaviorGuidanceGenerationPrompt({
          statId,
          statLabel: label,
          statDescription: description,
          currentGuidance: behaviorGuidance,
          statKind,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateBehaviorRequestId) return;

        const cleaned = sanitizeGeneratedBehaviorGuidance(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty behavior instruction text. Try again.");
        }

        const resolvedGuidance = cleaned
          .replaceAll("{{statId}}", statId)
          .replaceAll("{{statLabel}}", label)
          .replaceAll("{{statDescription}}", description);

        const behaviorNode = getField("behaviorGuidance") as HTMLTextAreaElement | null;
        if (!behaviorNode) {
          throw new Error("Behavior instruction field is unavailable.");
        }
        behaviorNode.value = resolvedGuidance;
        behaviorNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.behavior.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: resolvedGuidance.length,
        });
      } catch (error) {
        if (requestId !== generateBehaviorRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === generateBehaviorRequestId) {
          setBehaviorGenerateLoading(false);
        }
      }
    });

    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    prevBtn?.addEventListener("click", () => {
      if (step <= 1) return;
      step -= 1;
      setErrors([]);
      syncStepUi();
    });
    nextBtn?.addEventListener("click", () => {
      if (!validateCurrentStep()) return;
      if (step >= 6) return;
      step += 1;
      setErrors([]);
      syncStepUi();
    });
    saveBtn?.addEventListener("click", () => {
      if (!validateAll()) return;
      const nextDef = toCustomStatDefinition(draft);
      if (mode === "edit" && source) {
        customStatsState = customStatsState.map(item => item.id === source.id ? nextDef : item);
      } else {
        customStatsState = [...customStatsState, nextDef];
      }
      customStatsState = customStatsState.slice(0, MAX_CUSTOM_STATS);
      renderCustomStatsList();
      close();
      persistLive();
    });

    wizard.querySelectorAll("input, textarea, select").forEach(node => {
      node.addEventListener("input", () => {
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
      });
      node.addEventListener("change", () => {
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
      });
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
    syncStepUi();
    updateDescriptionCounter();
  };

  customAddButton?.addEventListener("click", () => {
    openCustomStatWizard("add");
  });
  manageBuiltInsButton?.addEventListener("click", () => {
    openBuiltInManagerWizard();
  });

  customStatsListNode?.addEventListener("click", event => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button[data-action][data-custom-id]") as HTMLButtonElement | null;
    if (!button) return;
    const id = String(button.getAttribute("data-custom-id") ?? "").trim().toLowerCase();
    if (!id) return;
    const stat = customStatsState.find(item => item.id === id);
    if (!stat) return;
    const action = String(button.getAttribute("data-action") ?? "");
    if (action === "custom-edit") {
      openCustomStatWizard("edit", stat);
      return;
    }
    if (action === "custom-duplicate") {
      openCustomStatWizard("duplicate", stat);
      return;
    }
    if (action === "custom-remove") {
      openCustomRemoveWizard(stat);
    }
  });
  renderCustomStatsList();

  const collectSettings = (): BetterSimTrackerSettings => {
    const read = (k: keyof BetterSimTrackerSettings): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readExtra = (k: string): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readBool = (k: keyof BetterSimTrackerSettings, fallback: boolean): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      if (!node) return fallback;
      return read(k) === "true";
    };
    const readBoolExtra = (k: string, fallback: boolean): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      if (!node) return fallback;
      return readExtra(k) === "true";
    };
    const readNumber = (k: keyof BetterSimTrackerSettings, fallback: number, min?: number, max?: number): number => {
      const n = Number(read(k));
      if (Number.isNaN(n)) return fallback;
      let v = n;
      if (typeof min === "number") v = Math.max(min, v);
      if (typeof max === "number") v = Math.min(max, v);
      return v;
    };
    const readGlobalMoodExpressionMap = (): Record<MoodLabel, string> => {
      const map: Record<MoodLabel, string> = { ...DEFAULT_MOOD_EXPRESSION_MAP };
      const nodes = Array.from(modal.querySelectorAll("[data-bst-global-mood-map]")) as HTMLInputElement[];
      for (const node of nodes) {
        const mood = normalizeMoodLabel(String(node.dataset.bstGlobalMoodMap ?? "")) as MoodLabel | null;
        if (!mood) continue;
        const value = String(node.value ?? "").trim().slice(0, 80);
        map[mood] = value || DEFAULT_MOOD_EXPRESSION_MAP[mood];
      }
      return map;
    };

    return {
      ...input.settings,
      connectionProfile: read("connectionProfile"),
      sequentialExtraction: readBool("sequentialExtraction", input.settings.sequentialExtraction),
      maxConcurrentCalls: readNumber("maxConcurrentCalls", input.settings.maxConcurrentCalls, 1, 8),
      strictJsonRepair: readBool("strictJsonRepair", input.settings.strictJsonRepair),
      maxRetriesPerStat: readNumber("maxRetriesPerStat", input.settings.maxRetriesPerStat, 0, 4),
      contextMessages: readNumber("contextMessages", input.settings.contextMessages, 1, 40),
      injectPromptDepth: readNumber("injectPromptDepth", input.settings.injectPromptDepth, 0, 8),
      maxDeltaPerTurn: readNumber("maxDeltaPerTurn", input.settings.maxDeltaPerTurn, 1, 30),
      maxTokensOverride: readNumber("maxTokensOverride", input.settings.maxTokensOverride, 0, 100000),
      truncationLengthOverride: readNumber("truncationLengthOverride", input.settings.truncationLengthOverride, 0, 200000),
      includeCharacterCardsInPrompt: readBool("includeCharacterCardsInPrompt", input.settings.includeCharacterCardsInPrompt),
      includeLorebookInExtraction: readBool("includeLorebookInExtraction", input.settings.includeLorebookInExtraction),
      lorebookExtractionMaxChars: readNumber("lorebookExtractionMaxChars", input.settings.lorebookExtractionMaxChars, 0, 12000),
      confidenceDampening: readNumber("confidenceDampening", input.settings.confidenceDampening, 0, 1),
      moodStickiness: readNumber("moodStickiness", input.settings.moodStickiness, 0, 1),
      injectTrackerIntoPrompt: readBool("injectTrackerIntoPrompt", input.settings.injectTrackerIntoPrompt),
      injectionPromptMaxChars: readNumber("injectionPromptMaxChars", input.settings.injectionPromptMaxChars, 500, 30000),
      summarizationNoteVisibleForAI: readBool("summarizationNoteVisibleForAI", input.settings.summarizationNoteVisibleForAI),
      injectSummarizationNote: readBool("injectSummarizationNote", input.settings.injectSummarizationNote),
      autoDetectActive: readBool("autoDetectActive", input.settings.autoDetectActive),
      activityLookback: readNumber("activityLookback", input.settings.activityLookback, 1, 25),
      showInactive: readBool("showInactive", input.settings.showInactive),
      inactiveLabel: read("inactiveLabel") || input.settings.inactiveLabel,
      showLastThought: readBool("showLastThought", input.settings.showLastThought),
      trackAffection: readBool("trackAffection", input.settings.trackAffection),
      trackTrust: readBool("trackTrust", input.settings.trackTrust),
      trackDesire: readBool("trackDesire", input.settings.trackDesire),
      trackConnection: readBool("trackConnection", input.settings.trackConnection),
      trackMood: readBool("trackMood", input.settings.trackMood),
      trackLastThought: readBool("trackLastThought", input.settings.trackLastThought),
      enableUserTracking: readBool("enableUserTracking", input.settings.enableUserTracking),
      userTrackMood: readBool("userTrackMood", input.settings.userTrackMood),
      userTrackLastThought: readBool("userTrackLastThought", input.settings.userTrackLastThought),
      includeUserTrackerInInjection: readBool("includeUserTrackerInInjection", input.settings.includeUserTrackerInInjection),
      builtInNumericStatUi: cloneBuiltInNumericStatUi(builtInNumericStatUiState),
      moodSource: read("moodSource") === "st_expressions" ? "st_expressions" : "bst_images",
      moodExpressionMap: readGlobalMoodExpressionMap(),
      stExpressionImageZoom: readNumber("stExpressionImageZoom", input.settings.stExpressionImageZoom, 0.5, 3),
      stExpressionImagePositionX: readNumber("stExpressionImagePositionX", input.settings.stExpressionImagePositionX, 0, 100),
      stExpressionImagePositionY: readNumber("stExpressionImagePositionY", input.settings.stExpressionImagePositionY, 0, 100),
      accentColor: read("accentColor") || input.settings.accentColor,
      cardOpacity: readNumber("cardOpacity", input.settings.cardOpacity, 0.1, 1),
      borderRadius: readNumber("borderRadius", input.settings.borderRadius, 0, 32),
      fontSize: readNumber("fontSize", input.settings.fontSize, 10, 22),
      debug: readBool("debug", input.settings.debug),
      debugFlags: {
        extraction: readBoolExtra("debugExtraction", input.settings.debugFlags?.extraction ?? true),
        prompts: readBoolExtra("debugPrompts", input.settings.debugFlags?.prompts ?? true),
        ui: readBoolExtra("debugUi", input.settings.debugFlags?.ui ?? true),
        moodImages: readBoolExtra("debugMoodImages", input.settings.debugFlags?.moodImages ?? true),
        storage: readBoolExtra("debugStorage", input.settings.debugFlags?.storage ?? true),
      },
      includeContextInDiagnostics: readBool("includeContextInDiagnostics", input.settings.includeContextInDiagnostics),
      includeGraphInDiagnostics: readBool("includeGraphInDiagnostics", input.settings.includeGraphInDiagnostics),
      promptTemplateUnified: read("promptTemplateUnified") || DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
      promptTemplateSequentialAffection: read("promptTemplateSequentialAffection") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection,
      promptTemplateSequentialTrust: read("promptTemplateSequentialTrust") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust,
      promptTemplateSequentialDesire: read("promptTemplateSequentialDesire") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire,
      promptTemplateSequentialConnection: read("promptTemplateSequentialConnection") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection,
      promptTemplateSequentialCustomNumeric: read("promptTemplateSequentialCustomNumeric") || DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
      promptTemplateSequentialCustomNonNumeric: read("promptTemplateSequentialCustomNonNumeric") || DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
      promptTemplateSequentialMood: read("promptTemplateSequentialMood") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
      promptTemplateSequentialLastThought: read("promptTemplateSequentialLastThought") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
      promptTemplateInjection: read("promptTemplateInjection") || DEFAULT_INJECTION_PROMPT_TEMPLATE,
      unlockProtocolPrompts: readBool("unlockProtocolPrompts", input.settings.unlockProtocolPrompts),
      promptProtocolUnified: read("promptProtocolUnified") || DEFAULT_PROTOCOL_UNIFIED,
      promptProtocolSequentialAffection: read("promptProtocolSequentialAffection") || DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
      promptProtocolSequentialTrust: read("promptProtocolSequentialTrust") || DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
      promptProtocolSequentialDesire: read("promptProtocolSequentialDesire") || DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
      promptProtocolSequentialConnection: read("promptProtocolSequentialConnection") || DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
      promptProtocolSequentialCustomNumeric: read("promptProtocolSequentialCustomNumeric") || DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
      promptProtocolSequentialCustomNonNumeric: read("promptProtocolSequentialCustomNonNumeric") || DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
      promptProtocolSequentialMood: read("promptProtocolSequentialMood") || DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
      promptProtocolSequentialLastThought: read("promptProtocolSequentialLastThought") || DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
      customStats: customStatsState.map(cloneCustomStatDefinition)
    };
  };

  const syncExtractionVisibility = (): void => {
    const maxConcurrentRow = modal.querySelector('[data-bst-row="maxConcurrentCalls"]') as HTMLElement | null;
    const injectPromptDepthRow = modal.querySelector('[data-bst-row="injectPromptDepth"]') as HTMLElement | null;
    const maxRetriesRow = modal.querySelector('[data-bst-row="maxRetriesPerStat"]') as HTMLElement | null;
    const lookbackRow = modal.querySelector('[data-bst-row="activityLookback"]') as HTMLElement | null;
    const inactiveLabelRow = modal.querySelector('[data-bst-row="inactiveLabel"]') as HTMLElement | null;
    const debugBodyRow = modal.querySelector('[data-bst-row="debugBody"]') as HTMLElement | null;
    const debugFlagsRow = modal.querySelector('[data-bst-row="debugFlags"]') as HTMLElement | null;
    const contextDiagRow = modal.querySelector('[data-bst-row="includeContextInDiagnostics"]') as HTMLElement | null;
    const graphDiagRow = modal.querySelector('[data-bst-row="includeGraphInDiagnostics"]') as HTMLElement | null;
    const injectPromptBlock = modal.querySelector('[data-bst-row="injectPromptBlock"]') as HTMLElement | null;
    const injectPromptDivider = modal.querySelector('[data-bst-row="injectPromptDivider"]') as HTMLElement | null;
    const injectSummarizationNoteRow = modal.querySelector('[data-bst-row="injectSummarizationNote"]') as HTMLElement | null;
    const lorebookExtractionMaxCharsRow = modal.querySelector('[data-bst-row="lorebookExtractionMaxChars"]') as HTMLElement | null;
    const lorebookExtractionHelpRow = modal.querySelector('[data-bst-row="lorebookExtractionHelp"]') as HTMLElement | null;
    const injectionPromptMaxCharsRow = modal.querySelector('[data-bst-row="injectionPromptMaxChars"]') as HTMLElement | null;
    const moodAdvancedBlock = modal.querySelector('[data-bst-row="moodAdvancedBlock"]') as HTMLElement | null;
    const globalMoodExpressionMap = modal.querySelector('[data-bst-row="globalMoodExpressionMap"]') as HTMLElement | null;
    const stExpressionImageOptions = modal.querySelector('[data-bst-row="stExpressionImageOptions"]') as HTMLElement | null;
    const protocolReadonlyBlocks = Array.from(modal.querySelectorAll(".bst-protocol-readonly-wrap")) as HTMLElement[];
    const protocolEditableBlocks = Array.from(modal.querySelectorAll(".bst-protocol-editable-wrap")) as HTMLElement[];
    const current = collectSettings();
    if (maxConcurrentRow) {
      maxConcurrentRow.style.display = current.sequentialExtraction ? "flex" : "none";
      maxConcurrentRow.style.flexDirection = "column";
      maxConcurrentRow.style.gap = "4px";
    }
    if (injectPromptDepthRow) {
      injectPromptDepthRow.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
      injectPromptDepthRow.style.flexDirection = "column";
      injectPromptDepthRow.style.gap = "4px";
    }
    if (maxRetriesRow) {
      maxRetriesRow.style.display = current.strictJsonRepair ? "flex" : "none";
      maxRetriesRow.style.flexDirection = "column";
      maxRetriesRow.style.gap = "4px";
    }
    if (lookbackRow) {
      lookbackRow.style.display = current.autoDetectActive ? "flex" : "none";
      lookbackRow.style.flexDirection = "column";
      lookbackRow.style.gap = "4px";
    }
    if (inactiveLabelRow) {
      inactiveLabelRow.style.display = current.showInactive ? "flex" : "none";
      inactiveLabelRow.style.flexDirection = "column";
      inactiveLabelRow.style.gap = "4px";
    }
    if (debugBodyRow) {
      debugBodyRow.style.display = current.debug ? "block" : "none";
    }
    if (debugFlagsRow) {
      debugFlagsRow.style.display = current.debug ? "grid" : "none";
    }
    if (contextDiagRow) {
      contextDiagRow.style.display = current.debug ? "" : "none";
    }
    if (graphDiagRow) {
      graphDiagRow.style.display = current.debug ? "" : "none";
    }
    if (injectPromptBlock) {
      injectPromptBlock.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
    }
    if (injectPromptDivider) {
      injectPromptDivider.style.display = current.injectTrackerIntoPrompt ? "block" : "none";
    }
    if (injectSummarizationNoteRow) {
      injectSummarizationNoteRow.style.display = current.injectTrackerIntoPrompt ? "" : "none";
    }
    if (lorebookExtractionMaxCharsRow) {
      lorebookExtractionMaxCharsRow.style.display = current.includeLorebookInExtraction ? "flex" : "none";
      lorebookExtractionMaxCharsRow.style.flexDirection = "column";
      lorebookExtractionMaxCharsRow.style.gap = "4px";
    }
    if (lorebookExtractionHelpRow) {
      lorebookExtractionHelpRow.style.display = current.includeLorebookInExtraction ? "block" : "none";
    }
    if (injectionPromptMaxCharsRow) {
      injectionPromptMaxCharsRow.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
      injectionPromptMaxCharsRow.style.flexDirection = "column";
      injectionPromptMaxCharsRow.style.gap = "4px";
    }
    if (moodAdvancedBlock) {
      moodAdvancedBlock.style.display = current.trackMood ? "block" : "none";
    }
    if (globalMoodExpressionMap) {
      globalMoodExpressionMap.style.display = current.trackMood && current.moodSource === "st_expressions" ? "block" : "none";
    }
    if (stExpressionImageOptions) {
      stExpressionImageOptions.style.display = current.trackMood && current.moodSource === "st_expressions" ? "block" : "none";
    }
    for (const node of protocolReadonlyBlocks) {
      node.style.display = current.unlockProtocolPrompts ? "none" : "block";
    }
    for (const node of protocolEditableBlocks) {
      node.style.display = current.unlockProtocolPrompts ? "block" : "none";
    }
  };

  const persistLive = (): void => {
    const next = collectSettings();
    customStatsState = Array.isArray(next.customStats)
      ? next.customStats.map(cloneCustomStatDefinition)
      : [];
    builtInNumericStatUiState = cloneBuiltInNumericStatUi(next.builtInNumericStatUi);
    input.settings = next;
    input.onSave(next);
    renderCustomStatsList();
    updateGlobalStExpressionSummary();
    syncExtractionVisibility();
  };

  modal.querySelector('[data-action="open-global-st-framing"]')?.addEventListener("click", async () => {
    if (globalFrameButton) globalFrameButton.disabled = true;
    globalPreviewCharacters = await loadGlobalPreviewCharacters();
    if (globalFrameButton) globalFrameButton.disabled = false;
    if (!globalPreviewCharacters.find(item => item.name === globalPreviewSelected)) {
      globalPreviewSelected = globalPreviewCharacters[0]?.name ?? "";
    }
    const selected = globalPreviewCharacters.find(item => item.name === globalPreviewSelected) ?? globalPreviewCharacters[0] ?? null;
    openStExpressionFrameEditor({
      title: "Adjust ST Expression Framing",
      description: selected
        ? `Global framing preview using ${selected.name}'s ST expression sprite.`
        : "Global framing used when mood source is ST expressions.",
      initial: readGlobalStExpressionFrame(),
      fallback: DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS,
      previewChoices: globalPreviewCharacters.map(item => ({ name: item.name, imageUrl: item.spriteUrl })),
      selectedPreviewName: selected?.name ?? "",
      onPreviewNameChange: name => {
        globalPreviewSelected = name;
      },
      emptyPreviewText: noPreviewFoundText,
      onChange: next => {
        set("stExpressionImageZoom", String(next.zoom));
        set("stExpressionImagePositionX", String(next.positionX));
        set("stExpressionImagePositionY", String(next.positionY));
        updateGlobalStExpressionSummary();
        persistLive();
      },
    });
  });

  modal.querySelectorAll("input, select, textarea").forEach(node => {
    node.addEventListener("change", persistLive);
    if (node instanceof HTMLInputElement && node.type === "number") {
      node.addEventListener("input", persistLive);
    }
    if (node instanceof HTMLTextAreaElement) {
      node.addEventListener("input", persistLive);
    }
  });
  syncExtractionVisibility();
  const tooltips: Partial<Record<keyof BetterSimTrackerSettings, string>> = {
    connectionProfile: "Choose a specific SillyTavern connection profile for tracker extraction calls.",
    sequentialExtraction: "Run one extraction prompt per stat instead of one unified prompt. More robust but slower.",
    maxConcurrentCalls: "When sequential mode is enabled, number of stat requests sent in parallel.",
    strictJsonRepair: "Enable strict retry prompts when model output is not valid or missing required fields.",
    maxRetriesPerStat: "Maximum repair retries for each stat extraction stage.",
    contextMessages: "How many recent chat messages are included in tracker extraction context.",
    injectPromptDepth: "How deep into the in-chat prompt stack the injected relationship state should be inserted (0 = nearest/top, max 8).",
    maxDeltaPerTurn: "Hard cap for stat change magnitude in one tracker update before confidence scaling.",
    maxTokensOverride: "Override max tokens for extraction requests (0 = use profile/preset defaults).",
    truncationLengthOverride: "Override context truncation length for extraction requests (0 = use profile/preset defaults).",
    includeCharacterCardsInPrompt: "Include character card description/personality/scenario if recent messages are unclear.",
    confidenceDampening: "How strongly model confidence scales stat deltas (0 = ignore confidence, 1 = full effect).",
    moodStickiness: "Higher values keep previous mood unless confidence is strong.",
    injectTrackerIntoPrompt: "Inject current relationship state into generation prompt for behavioral coherence.",
    includeLorebookInExtraction: "Include activated lorebook context in extraction prompt building (for stat analysis only).",
    lorebookExtractionMaxChars: "Maximum lorebook characters included in extraction context (0 means no trim).",
    injectionPromptMaxChars: "Maximum size of hidden injection prompt block sent to generation.",
    summarizationNoteVisibleForAI: "Controls visibility mode for newly generated Summarize notes (prose summaries of current tracked stats). Existing notes are unchanged for safety.",
    injectSummarizationNote: "Include the latest Summarize note (prose summary of current tracked stats) in hidden tracker prompt injection guidance only (no chat-message edits).",
    autoDetectActive: "Automatically decide which group characters are active in current scene.",
    activityLookback: "How many recent messages are scanned for active-speaker detection.",
    trackAffection: "Enable Affection stat extraction and updates.",
    trackTrust: "Enable Trust stat extraction and updates.",
    trackDesire: "Enable Desire stat extraction and updates.",
    trackConnection: "Enable Connection stat extraction and updates.",
    trackMood: "Enable mood extraction and mood display updates.",
    trackLastThought: "Enable hidden short internal thought extraction.",
    enableUserTracking: "Run user-side extraction after user messages.",
    userTrackMood: "Allow user-side extraction to update User mood.",
    userTrackLastThought: "Allow user-side extraction to update User lastThought.",
    includeUserTrackerInInjection: "Include user-side tracked state in hidden prompt injection when available.",
    moodSource: "Choose where mood images come from: BetterSimTracker uploads or SillyTavern expression sprites.",
    stExpressionImageZoom: "Global zoom for ST expression mood images (higher values crop closer).",
    stExpressionImagePositionX: "Global horizontal crop position for ST expression mood images.",
    stExpressionImagePositionY: "Global vertical crop position for ST expression mood images.",
    showInactive: "Show tracker cards for inactive/off-screen characters.",
    inactiveLabel: "Text label shown on cards for inactive characters.",
    showLastThought: "Show extracted last thought text inside tracker cards.",
    accentColor: "Accent color for fills, highlights, and action emphasis.",
    cardOpacity: "Overall tracker container opacity.",
    borderRadius: "Corner roundness for tracker cards and controls.",
    fontSize: "Base font size used inside tracker cards.",
    debug: "Enable verbose diagnostics logging for troubleshooting.",
    includeContextInDiagnostics: "Include extraction prompt/context text in diagnostics dumps (larger logs).",
    includeGraphInDiagnostics: "Include graph-open series payloads in diagnostics trace output.",
    promptTemplateInjection: "Template for injected relationship state guidance (used only when injection is enabled).",
    promptTemplateUnified: "Unified prompt instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialAffection: "Sequential Affection instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialTrust: "Sequential Trust instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialDesire: "Sequential Desire instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialConnection: "Sequential Connection instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialCustomNumeric: "Default instruction for custom numeric per-stat extraction (used in all modes; per-stat override in custom stat wizard still wins).",
    promptTemplateSequentialCustomNonNumeric: "Default instruction for custom non-numeric per-stat extraction (used in all modes; per-stat override in custom stat wizard still wins).",
    promptTemplateSequentialMood: "Sequential Mood instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialLastThought: "Sequential LastThought instruction (protocol is separately configurable in advanced mode).",
    unlockProtocolPrompts: "Advanced mode: unlock protocol blocks for editing. Incorrect protocol formatting can break extraction.",
    promptProtocolUnified: "Protocol block for unified extraction (advanced override).",
    promptProtocolSequentialAffection: "Protocol block for sequential affection extraction (advanced override).",
    promptProtocolSequentialTrust: "Protocol block for sequential trust extraction (advanced override).",
    promptProtocolSequentialDesire: "Protocol block for sequential desire extraction (advanced override).",
    promptProtocolSequentialConnection: "Protocol block for sequential connection extraction (advanced override).",
    promptProtocolSequentialCustomNumeric: "Protocol block for custom numeric extraction (advanced override).",
    promptProtocolSequentialCustomNonNumeric: "Protocol block for custom non-numeric extraction (advanced override).",
    promptProtocolSequentialMood: "Protocol block for sequential mood extraction (advanced override).",
    promptProtocolSequentialLastThought: "Protocol block for sequential lastThought extraction (advanced override)."
  };
  for (const [key, tooltip] of Object.entries(tooltips) as Array<[keyof BetterSimTrackerSettings, string]>) {
    const inputNode = modal.querySelector(`[data-k="${key}"]`) as HTMLElement | null;
    if (!inputNode) continue;
    inputNode.setAttribute("title", tooltip);
    const labelNode = inputNode.closest("label");
    labelNode?.setAttribute("title", tooltip);
  }

  modal.querySelectorAll('[data-action="close"]').forEach(node => {
    node.addEventListener("click", () => {
      persistLive();
      closeSettingsModal();
    });
  });

  modal.querySelectorAll('[data-action="retrack"]').forEach(node => {
    node.addEventListener("click", () => {
      persistLive();
      input.onRetrack?.();
    });
  });

  modal.querySelector('[data-action="clear-chat"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearCurrentChat?.();
  });

  modal.querySelector('[data-action="dump-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onDumpDiagnostics?.();
  });

  modal.querySelector('[data-action="clear-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearDiagnostics?.();
  });
  const promptDefaults: Partial<Record<keyof BetterSimTrackerSettings, string>> = {
    promptTemplateUnified: DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
    promptTemplateSequentialAffection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection,
    promptTemplateSequentialTrust: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust,
    promptTemplateSequentialDesire: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire,
    promptTemplateSequentialConnection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection,
    promptTemplateSequentialCustomNumeric: DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
    promptTemplateSequentialCustomNonNumeric: DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
    promptTemplateSequentialMood: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
    promptTemplateSequentialLastThought: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
    promptTemplateInjection: DEFAULT_INJECTION_PROMPT_TEMPLATE,
    promptProtocolUnified: DEFAULT_PROTOCOL_UNIFIED,
    promptProtocolSequentialAffection: DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
    promptProtocolSequentialTrust: DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
    promptProtocolSequentialDesire: DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
    promptProtocolSequentialConnection: DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
    promptProtocolSequentialCustomNumeric: DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
    promptProtocolSequentialCustomNonNumeric: DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
    promptProtocolSequentialMood: DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
    promptProtocolSequentialLastThought: DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
  };

  type BuiltInSequentialPromptSettingKey =
    | "promptTemplateSequentialAffection"
    | "promptTemplateSequentialTrust"
    | "promptTemplateSequentialDesire"
    | "promptTemplateSequentialConnection"
    | "promptTemplateSequentialMood"
    | "promptTemplateSequentialLastThought";

  const builtInSequentialPromptKeyToStat: Record<
    BuiltInSequentialPromptSettingKey,
    "affection" | "trust" | "desire" | "connection" | "mood" | "lastThought"
  > = {
    promptTemplateSequentialAffection: "affection",
    promptTemplateSequentialTrust: "trust",
    promptTemplateSequentialDesire: "desire",
    promptTemplateSequentialConnection: "connection",
    promptTemplateSequentialMood: "mood",
    promptTemplateSequentialLastThought: "lastThought",
  };

  const setBuiltInSeqAiStatus = (
    key: BuiltInSequentialPromptSettingKey,
    state: "idle" | "loading" | "success" | "error",
    message?: string,
  ): void => {
    const statusNode = modal.querySelector(`[data-bst-seq-ai-status="${key}"]`) as HTMLElement | null;
    if (!statusNode) return;
    const text = String(message ?? "").trim();
    if (!text && state === "idle") {
      statusNode.textContent = "Uses current connection profile.";
      statusNode.setAttribute("data-state", "idle");
      return;
    }
    statusNode.textContent = text;
    statusNode.setAttribute("data-state", state);
  };

  (Object.keys(builtInSequentialPromptKeyToStat) as BuiltInSequentialPromptSettingKey[])
    .forEach(key => setBuiltInSeqAiStatus(key, "idle"));

  let builtInSeqGenerateRequestId = 0;
  modal.querySelectorAll('[data-action="generate-seq-prompt"]').forEach(node => {
    node.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) return;
      if (button.getAttribute("data-loading") === "true") return;

      const key = button.getAttribute("data-generate-for") as BuiltInSequentialPromptSettingKey | null;
      if (!key || !(key in builtInSequentialPromptKeyToStat)) return;
      const stat = builtInSequentialPromptKeyToStat[key];

      const textarea = modal.querySelector(`[data-k="${key}"]`) as HTMLTextAreaElement | null;
      if (!textarea) {
        setBuiltInSeqAiStatus(key, "error", "Prompt field unavailable.");
        return;
      }

      const currentInstruction = textarea.value.trim() || String(promptDefaults[key] ?? "");
      const requestId = ++builtInSeqGenerateRequestId;
      button.disabled = true;
      button.setAttribute("data-loading", "true");
      setBuiltInSeqAiStatus(key, "loading", "Generating instruction...");
      try {
        const settingsForRequest = collectSettings();
        const prompt = buildBuiltInSequentialPromptGenerationPrompt({
          stat,
          currentInstruction,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== builtInSeqGenerateRequestId) return;

        const cleaned = sanitizeGeneratedSequentialTemplate(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty instruction text. Try again.");
        }

        textarea.value = cleaned;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        setBuiltInSeqAiStatus(key, "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "builtin.seq.generated", {
          stat,
          key,
          profileId: response.meta.profileId,
          outputChars: cleaned.length,
        });
      } catch (error) {
        if (requestId !== builtInSeqGenerateRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setBuiltInSeqAiStatus(key, "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === builtInSeqGenerateRequestId) {
          button.disabled = false;
          button.setAttribute("data-loading", "false");
        }
      }
    });
  });

  modal.querySelectorAll('[data-action="reset-prompt"]').forEach(node => {
    node.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      const key = target?.getAttribute("data-reset-for") as keyof BetterSimTrackerSettings | null;
      if (!key) return;
      const value = promptDefaults[key];
      if (typeof value !== "string") return;
      (input.settings as unknown as Record<string, unknown>)[key] = value;
      set(key, value);
      persistLive();
    });
  });
}

export function closeSettingsModal(): void {
  closeStExpressionFrameEditor();
  document.querySelector(".bst-custom-wizard-backdrop")?.remove();
  document.querySelector(".bst-custom-wizard")?.remove();
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
}



