import { STYLE_ID } from "./constants";
import { logDebug } from "./settings";
import type {
  BetterSimTrackerSettings,
  ConnectionProfileOption,
  DeltaDebugRecord,
  MoodLabel,
  MoodSource,
  StExpressionImageOptions,
  StatValue,
  TrackerData,
} from "./types";
import {
  DEFAULT_INJECTION_PROMPT_TEMPLATE,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
  LAST_THOUGHT_PROMPT_PROTOCOL,
  MOOD_PROMPT_PROTOCOL,
  NUMERIC_PROMPT_PROTOCOL,
  UNIFIED_PROMPT_PROTOCOL,
  moodOptions,
} from "./prompts";
import {
  closeStExpressionFrameEditor,
  formatStExpressionFrameSummary,
  openStExpressionFrameEditor,
  projectStExpressionPosition,
  sanitizeStExpressionFrame,
} from "./stExpressionFrameEditor";
import { fetchFirstExpressionSprite } from "./stExpressionSprites";

type NumericStatKey = "affection" | "trust" | "desire" | "connection";

const NUMERIC_STAT_DEFS: Array<{ key: NumericStatKey; label: string; short: string; color: string }> = [
  { key: "affection", label: "Affection", short: "A", color: "#ff6b81" },
  { key: "trust", label: "Trust", short: "T", color: "#55d5ff" },
  { key: "desire", label: "Desire", short: "D", color: "#ffb347" },
  { key: "connection", label: "Connection", short: "C", color: "#9cff8f" }
];

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
const DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS: StExpressionImageOptions = {
  zoom: 1.2,
  positionX: 50,
  positionY: 20,
};

function hasNumericValue(entry: TrackerData, key: NumericStatKey, name: string): boolean {
  return entry.statistics[key]?.[name] !== undefined;
}

function getNumericStatsForCharacter(entry: TrackerData, name: string): typeof NUMERIC_STAT_DEFS {
  return NUMERIC_STAT_DEFS.filter(def => hasNumericValue(entry, def.key, name));
}

function getNumericStatsForHistory(history: TrackerData[], name: string): typeof NUMERIC_STAT_DEFS {
  return NUMERIC_STAT_DEFS.filter(def => history.some(entry => hasNumericValue(entry, def.key, name)));
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

function getResolvedMoodSource(settings: BetterSimTrackerSettings, characterName: string): MoodSource {
  const fallback = normalizeMoodSource(settings.moodSource);
  const entry = settings.characterDefaults?.[characterName] as Record<string, unknown> | undefined;
  if (!entry) return fallback;
  const override = normalizeMoodSource(entry.moodSource);
  if (entry.moodSource === "bst_images" || entry.moodSource === "st_expressions") return override;
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function getResolvedStExpressionImageOptions(settings: BetterSimTrackerSettings, characterName: string): StExpressionImageOptions {
  const globalOptions = getGlobalStExpressionImageOptions(settings);
  const entry = settings.characterDefaults?.[characterName] as Record<string, unknown> | undefined;
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

function getMappedExpressionLabel(settings: BetterSimTrackerSettings, characterName: string, moodLabel: MoodLabel): string {
  const entry = settings.characterDefaults?.[characterName] as Record<string, unknown> | undefined;
  const rawMap = entry?.moodExpressionMap as Record<string, unknown> | undefined;
  const override = rawMap && typeof rawMap[moodLabel] === "string"
    ? String(rawMap[moodLabel]).trim()
    : "";
  if (override) return override;
  return DEFAULT_MOOD_EXPRESSION_MAP[moodLabel] ?? "neutral";
}

function getMoodImageUrl(
  settings: BetterSimTrackerSettings,
  characterName: string,
  moodRaw: string,
  onRerender?: () => void,
): string | null {
  const entry = settings.characterDefaults?.[characterName] as Record<string, unknown> | undefined;
  const normalizedMood = (normalizeMoodLabel(moodRaw) ?? "Neutral") as MoodLabel;
  const source = getResolvedMoodSource(settings, characterName);

  if (source === "bst_images") {
    const moodImages = entry?.moodImages as Record<string, string> | undefined;
    const url = moodImages?.[normalizedMood];
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }

  const expression = getMappedExpressionLabel(settings, characterName, normalizedMood);
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
  let hash = 0;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const sat = 46 + (hash % 22); // 46..67
  const light = 24 + ((hash >> 5) % 10); // 24..33
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function hslFromName(name: string): { h: number; s: number; l: number } {
  let hash = 0;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return {
    h: hash % 360,
    s: 46 + (hash % 22),
    l: 24 + ((hash >> 5) % 10),
  };
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function allocateCharacterColors(names: string[]): Record<string, string> {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (!unique.length) return {};
  const sorted = [...unique].sort((a, b) => a.localeCompare(b));
  const step = Math.max(22, Math.floor(360 / Math.max(1, sorted.length)));
  const takenHues: number[] = [];
  const out: Record<string, string> = {};

  for (const name of sorted) {
    const seed = hslFromName(name);
    let bestHue = seed.h;
    let bestScore = -1;
    for (let i = 0; i < 16; i += 1) {
      const candidate = (seed.h + i * step) % 360;
      const minDist = takenHues.length
        ? Math.min(...takenHues.map(h => hueDistance(h, candidate)))
        : 360;
      if (minDist > bestScore) {
        bestScore = minDist;
        bestHue = candidate;
      }
    }
    takenHues.push(bestHue);
    out[name] = `hsl(${bestHue} ${seed.s}% ${seed.l}%)`;
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
  gap: 6px;
  margin-bottom: 2px;
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
  transition: box-shadow .15s ease;
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
.bst-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 2px;
  opacity: 0.93;
}
.bst-track {
  background: rgba(255,255,255,0.14);
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
}
.bst-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--bst-accent), color-mix(in srgb, var(--bst-accent) 65%, #ffd38f 35%));
  box-shadow: 0 0 10px color-mix(in srgb, var(--bst-accent) 70%, #ffffff 30%);
  transition: width 0.5s ease;
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
  width: clamp(64px, 11vw, 84px);
  height: clamp(64px, 11vw, 84px);
  border-radius: clamp(12px, 3vw, 16px);
  justify-self: center;
  overflow: hidden;
  border: 2px solid color-mix(in srgb, var(--bst-card-local, var(--bst-accent)) 55%, #ffffff 45%);
  box-shadow: 0 12px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.25);
}
.bst-mood-image-frame--st-expression {
  --bst-st-expression-zoom: 1.2;
  --bst-st-expression-pos-x: 50%;
  --bst-st-expression-pos-y: 20%;
}
.bst-mood-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  display: block;
}
.bst-mood-image--st-expression {
  object-position: var(--bst-st-expression-pos-x) var(--bst-st-expression-pos-y);
  transform: scale(var(--bst-st-expression-zoom));
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
  align-items: center;
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
  width: min(760px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  background:
    radial-gradient(1200px 400px at 0% 0%, rgba(255, 98, 123, 0.14), transparent 60%),
    radial-gradient(900px 300px at 100% 0%, rgba(86, 189, 255, 0.12), transparent 55%),
    #121621;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  color: #fff;
  padding: 16px;
  pointer-events: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-family: "Segoe UI", "Trebuchet MS", sans-serif;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.bst-settings h3 { margin: 0 0 4px 0; font-size: 20px; letter-spacing: 0.2px; }
.bst-settings-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.bst-settings-subtitle { margin: 0 0 12px 0; opacity: 0.78; font-size: 12px; }
.bst-settings-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bst-settings-grid-compact { gap: 8px; }
.bst-settings-grid-single { grid-template-columns: minmax(0, 1fr); }
.bst-check-grid {
  display: grid;
  column-gap: 22px;
  row-gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  min-height: 26px;
}
.bst-settings label { font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.bst-check { flex-direction: row !important; align-items: center; gap: 8px !important; }
.bst-check input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--bst-accent); }
.bst-settings input, .bst-settings select, .bst-settings textarea {
  background: #0d1220 !important;
  color: #f3f5f9 !important;
  border: 1px solid rgba(255,255,255,0.20) !important;
  border-radius: 8px;
  padding: 7px;
}
.bst-settings input:focus-visible,
.bst-settings select:focus-visible,
.bst-settings textarea:focus-visible {
  outline: none;
  border-color: rgba(56,189,248,0.9) !important;
  box-shadow: 0 0 0 2px rgba(56,189,248,0.25);
}
.bst-settings label:focus-within {
  color: #e6f6ff;
}
.bst-settings textarea {
  resize: vertical;
  min-height: 120px;
  font-family: Consolas, "Courier New", monospace;
  line-height: 1.35;
}
.bst-settings input::placeholder { color: rgba(243,245,249,0.6); }
.bst-settings-section {
  margin: 12px 0;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(9, 12, 20, 0.45);
}
.bst-color-inputs {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
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
  onOpenGraph?: (characterName: string) => void,
  onRetrackMessage?: (messageIndex: number) => void,
  onCancelExtraction?: () => void,
  onRequestRerender?: () => void,
): void {
  ensureStyles();
  const palette = allocateCharacterColors(allCharacters);
  const sortedEntries = [...entries].sort((a, b) => a.messageIndex - b.messageIndex);
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
    root.innerHTML = "";

    if (!root.dataset.bstBound) {
      root.dataset.bstBound = "1";
      root.addEventListener("click", event => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('[data-bst-action="graph"]') as HTMLElement | null;
        if (button) {
          const name = String(button.getAttribute("data-character") ?? "").trim();
          if (!name) return;
          onOpenGraph?.(name);
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
          collapse.setAttribute("title", nextCollapsed ? "Expand all trackers" : "Collapse all trackers");
          collapse.innerHTML = nextCollapsed ? "&#9656; Expand all" : "&#9662; Collapse all";
          return;
        }
        const cancel = target?.closest('[data-bst-action="cancel-extraction"]') as HTMLElement | null;
        if (cancel) {
          onCancelExtraction?.();
          return;
        }
      });
    }
    root.classList.toggle("bst-root-collapsed", collapsedTrackerMessages.has(entry.messageIndex));

    if (uiState.phase === "generating" && uiState.messageIndex === entry.messageIndex) {
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
      continue;
    }

    const showRetrack = latestAiIndex != null && entry.messageIndex === latestAiIndex;
    {
      const collapsed = root.classList.contains("bst-root-collapsed");
      const actions = document.createElement("div");
      actions.className = "bst-root-actions";
      actions.innerHTML = `
        <button class="bst-mini-btn" data-bst-action="toggle-all-collapse" title="${collapsed ? "Expand all trackers" : "Collapse all trackers"}" aria-expanded="${String(!collapsed)}">${collapsed ? "&#9656; Expand all" : "&#9662; Collapse all"}</button>
        ${showRetrack ? `<button class="bst-mini-btn bst-mini-btn-icon bst-mini-btn-accent" data-bst-action="retrack" title="Retrack latest AI message" aria-label="Retrack latest AI message">&#x21BB;</button>` : ""}
      `;
      root.appendChild(actions);
    }

    const activeSet = new Set(data.activeCharacters.map(normalizeName));
    const hasAnyStatFor = (name: string): boolean =>
      data.statistics.affection?.[name] !== undefined ||
      data.statistics.trust?.[name] !== undefined ||
      data.statistics.desire?.[name] !== undefined ||
      data.statistics.connection?.[name] !== undefined ||
      data.statistics.mood?.[name] !== undefined ||
      data.statistics.lastThought?.[name] !== undefined;
    const forceAllInGroup = isGroupChat;
    const displayPool =
      (forceAllInGroup || settings.showInactive) && allCharacters.length > 0
        ? allCharacters
        : data.activeCharacters;
    const targets = displayPool.filter(name => hasAnyStatFor(name) || activeSet.has(normalizeName(name)));

    for (const name of targets) {
      const isActive = activeSet.has(normalizeName(name));
      if (!isActive && !settings.showInactive) continue;

      const previousData = findPreviousData(entry.messageIndex);
      const enabledNumeric = getNumericStatsForCharacter(data, name);
      const moodText = data.statistics.mood?.[name] !== undefined ? String(data.statistics.mood?.[name]) : "";
      const prevMood = previousData?.statistics.mood?.[name] !== undefined ? String(previousData.statistics.mood?.[name]) : moodText;
      const moodTrend = prevMood === moodText ? "stable" : "shifted";
      const moodSource = moodText ? getResolvedMoodSource(settings, name) : "bst_images";
      const stExpressionImageOptions = moodSource === "st_expressions"
        ? getResolvedStExpressionImageOptions(settings, name)
        : null;
      const moodImage = moodText ? getMoodImageUrl(settings, name, moodText, onRequestRerender) : null;
      const lastThoughtText = settings.showLastThought && data.statistics.lastThought?.[name] !== undefined
        ? String(data.statistics.lastThought?.[name] ?? "")
        : "";
      const stExpressionStyle = stExpressionImageOptions
        ? ` style="--bst-st-expression-zoom:${stExpressionImageOptions.zoom.toFixed(2)};--bst-st-expression-pos-x:${projectStExpressionPosition(stExpressionImageOptions.positionX, stExpressionImageOptions.zoom).toFixed(2)}%;--bst-st-expression-pos-y:${projectStExpressionPosition(stExpressionImageOptions.positionY, stExpressionImageOptions.zoom).toFixed(2)}%;"`
        : "";
      const card = document.createElement("div");
      card.className = `bst-card${isActive ? "" : " bst-card-inactive"}`;
      card.style.setProperty("--bst-card-local", palette[name] ?? colorFromName(name));
      const collapsedSummary = enabledNumeric.map(def => {
        const value = toPercent(data.statistics[def.key]?.[name] ?? 0);
        return `<span>${def.short} ${value}%</span>`;
      }).join("");
      const showCollapsedMood = moodText !== "";
      card.innerHTML = `
        <div class="bst-head">
          <div class="bst-name" title="${name}">${name}</div>
          <div class="bst-actions">
            <button class="bst-mini-btn" data-bst-action="graph" data-character="${name}" title="Open relationship graph"><span aria-hidden="true">&#128200;</span> Graph</button>
            <div class="bst-state" title="${isActive ? "Active" : settings.inactiveLabel}">${isActive ? "Active" : `${settings.inactiveLabel} <span class="fa-solid fa-ghost bst-inactive-icon" aria-hidden="true"></span>`}</div>
          </div>
        </div>
        ${enabledNumeric.length || showCollapsedMood ? `
        <div class="bst-collapsed-summary" title="Tracked stats">
          ${collapsedSummary || ""}
          ${showCollapsedMood ? `<span class="bst-collapsed-mood" title="${moodText}">${moodToEmojiEntity(moodText)}</span>` : ""}
        </div>` : ""}
        <div class="bst-body">
        ${enabledNumeric.map(({ key, label }) => {
          const value = toPercent(data.statistics[key]?.[name] ?? 0);
          const prevValueRaw = previousData?.statistics[key]?.[name];
          const prevValue = toPercent(prevValueRaw ?? value);
          const delta = Math.round(value - prevValue);
          const deltaClass = delta > 0 ? "bst-delta bst-delta-up" : delta < 0 ? "bst-delta bst-delta-down" : "bst-delta bst-delta-flat";
          const showDelta = latestAiIndex != null && entry.messageIndex === latestAiIndex;
          return `
            <div class="bst-row">
              <div class="bst-label"><span>${label}</span><span>${value}%${showDelta ? `<span class="${deltaClass}">${formatDelta(delta)}</span>` : ""}</span></div>
              <div class="bst-track"><div class="bst-fill" style="width:${value}%"></div></div>
            </div>
          `;
        }).join("")}
        ${moodText !== "" ? `
        <div class="bst-mood${moodImage ? " bst-mood-has-image" : ""}" title="${moodText} (${moodTrend})">
          <div class="bst-mood-wrap ${moodImage ? "bst-mood-wrap--image" : "bst-mood-wrap--emoji"}">
            ${moodImage
              ? `<span class="bst-mood-image-frame${moodSource === "st_expressions" ? " bst-mood-image-frame--st-expression" : ""}"${stExpressionStyle}><img class="bst-mood-image${moodSource === "st_expressions" ? " bst-mood-image--st-expression" : ""}" src="${escapeHtml(moodImage)}" alt="${escapeHtml(moodText)}"></span>`
              : `<span class="bst-mood-chip"><span class="bst-mood-emoji">${moodToEmojiEntity(moodText)}</span></span>`}
            ${moodImage && lastThoughtText
              ? `<span class="bst-mood-bubble">${escapeHtml(lastThoughtText)}</span>`
              : moodImage
                ? ""
                : `<span class="bst-mood-badge" style="background:${moodBadgeColor(moodText)};">${moodText} (${moodTrend})</span>`}
          </div>
        </div>` : ""}
        ${settings.showLastThought && data.statistics.lastThought?.[name] !== undefined && !moodImage ? `<div class="bst-thought">${String(data.statistics.lastThought?.[name] ?? "")}</div>` : ""}
        ${enabledNumeric.length === 0 && moodText === "" && !(settings.showLastThought && data.statistics.lastThought?.[name] !== undefined) ? `<div class="bst-empty">No stats recorded.</div>` : ""}
        </div>
      `;
      root.appendChild(card);
    }
  }
}

export function removeTrackerUI(): void {
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach(el => el.remove());
  document.getElementById(STYLE_ID)?.remove();
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
  closeStExpressionFrameEditor();
  closeGraphModal();
}

function statValue(entry: TrackerData, stat: NumericStatKey, character: string): number {
  const raw = Number(entry.statistics[stat]?.[character] ?? 0);
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

function hasCharacterSnapshot(entry: TrackerData, character: string): boolean {
  return (
    entry.statistics.affection?.[character] !== undefined ||
    entry.statistics.trust?.[character] !== undefined ||
    entry.statistics.desire?.[character] !== undefined ||
    entry.statistics.connection?.[character] !== undefined ||
    entry.statistics.mood?.[character] !== undefined ||
    entry.statistics.lastThought?.[character] !== undefined
  );
}

function hasNumericSnapshot(entry: TrackerData, character: string): boolean {
  return (
    entry.statistics.affection?.[character] !== undefined ||
    entry.statistics.trust?.[character] !== undefined ||
    entry.statistics.desire?.[character] !== undefined ||
    entry.statistics.connection?.[character] !== undefined
  );
}

function buildStatSeries(
  timeline: TrackerData[],
  character: string,
  stat: NumericStatKey,
): number[] {
  let carry = 50;
  return timeline.map(item => {
    const raw = item.statistics[stat]?.[character];
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        carry = Math.max(0, Math.min(100, n));
      }
    }
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

  const enabledNumeric = getNumericStatsForHistory(input.history, input.character);
  const timeline = [...input.history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item => hasNumericSnapshot(item, input.character));
  const rawSnapshotCount = timeline.length;
  const windowPreference = getGraphWindowPreference();
  const windowSize = windowPreference === "all" ? null : Number(windowPreference);
  const windowedTimeline = windowSize ? timeline.slice(-windowSize) : timeline;
  const renderedTimeline = downsampleTimeline(windowedTimeline, 140);
  const points: Partial<Record<NumericStatKey, number[]>> = {};
  for (const def of enabledNumeric) {
    points[def.key] = buildStatSeries(renderedTimeline, input.character, def.key);
  }

  const width = 780;
  const height = 320;
  let smoothing = getGraphSmoothingPreference();
  const connectionColor = input.accentColor || "#9cff8f";
  const buildSeriesFrom = (defs: typeof NUMERIC_STAT_DEFS, seriesSource: Partial<Record<NumericStatKey, number[]>>) => {
    const series: Partial<Record<NumericStatKey, number[]>> = {};
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
  const latest: Partial<Record<NumericStatKey, number>> = {};
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
          return `<circle id="bst-graph-hover-${def.key}" r="3.8" fill="${color}"></circle>`;
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
  const hoverDots: Partial<Record<NumericStatKey, SVGCircleElement | null>> = {};
  for (const def of enabledNumeric) {
    hoverDots[def.key] = modal.querySelector(`#bst-graph-hover-${def.key}`) as SVGCircleElement | null;
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
  previewCharacterCandidates?: string[];
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

  const modal = document.createElement("div");
  modal.className = "bst-settings";
  modal.innerHTML = `
    <div class="bst-settings-top">
      <div>
        <h3>BetterSimTracker Settings</h3>
        <p class="bst-settings-subtitle">Changes are saved automatically.</p>
      </div>
      <button class="bst-btn bst-close-btn" data-action="close" title="Close settings" aria-label="Close settings">&times;</button>
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
      <h4><span class="bst-header-icon fa-solid fa-plug"></span>Connection &amp; Generation</h4>
      <div class="bst-settings-grid">
        <label>Connection Profile <select data-k="connectionProfile">${profileOptionsHtml}</select></label>
        <label>Max Tokens Override <input data-k="maxTokensOverride" type="number" min="0" max="100000"></label>
        <label>Context Size Override <input data-k="truncationLengthOverride" type="number" min="0" max="200000"></label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-filter"></span>Extraction</h4>
      <div class="bst-settings-grid">
        <label>Context Messages <input data-k="contextMessages" type="number" min="1" max="40"></label>
        <label data-bst-row="maxConcurrentCalls">Max Concurrent Requests <input data-k="maxConcurrentCalls" type="number" min="1" max="8"></label>
        <label data-bst-row="maxRetriesPerStat">Max Retries Per Stat <input data-k="maxRetriesPerStat" type="number" min="0" max="4"></label>
        <label>Max Delta Per Turn <input data-k="maxDeltaPerTurn" type="number" min="1" max="30"></label>
        <label>Confidence Dampening <input data-k="confidenceDampening" type="number" min="0" max="1" step="0.05"></label>
        <label>Mood Stickiness <input data-k="moodStickiness" type="number" min="0" max="1" step="0.05"></label>
        <label data-bst-row="activityLookback">Activity Lookback <input data-k="activityLookback" type="number" min="1" max="25"></label>
        <div class="bst-section-divider">Toggles</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="includeCharacterCardsInPrompt" type="checkbox">Include Character Cards in Extraction Prompt</label>
          <label class="bst-check"><input data-k="injectTrackerIntoPrompt" type="checkbox">Inject Tracker Into Prompt</label>
          <label class="bst-check"><input data-k="sequentialExtraction" type="checkbox">Sequential Extraction (per stat)</label>
          <label class="bst-check"><input data-k="strictJsonRepair" type="checkbox">Strict JSON Repair</label>
          <label class="bst-check"><input data-k="autoDetectActive" type="checkbox">Auto Detect Active</label>
        </div>
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
      <div class="bst-check-grid">
        <label class="bst-check"><input data-k="trackAffection" type="checkbox">Track Affection</label>
        <label class="bst-check"><input data-k="trackTrust" type="checkbox">Track Trust</label>
        <label class="bst-check"><input data-k="trackDesire" type="checkbox">Track Desire</label>
        <label class="bst-check"><input data-k="trackConnection" type="checkbox">Track Connection</label>
        <label class="bst-check"><input data-k="trackMood" type="checkbox">Track Mood</label>
        <label class="bst-check"><input data-k="trackLastThought" type="checkbox">Track Last Thought</label>
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
        <div class="bst-help-line">Unified prompt is used for one-prompt extraction. Sequential mode uses per-stat prompts.</div>
        <div class="bst-help-line">Only the instruction section is editable; protocol blocks are fixed for safety and consistency.</div>
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
        </ul>
      </details>
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
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(UNIFIED_PROMPT_PROTOCOL)}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-heart"></span>Seq: Affection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialAffection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialAffection" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(NUMERIC_PROMPT_PROTOCOL("affection"))}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-shield-heart"></span>Seq: Trust</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialTrust" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialTrust" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(NUMERIC_PROMPT_PROTOCOL("trust"))}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-fire"></span>Seq: Desire</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialDesire" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialDesire" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(NUMERIC_PROMPT_PROTOCOL("desire"))}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-link"></span>Seq: Connection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialConnection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialConnection" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(NUMERIC_PROMPT_PROTOCOL("connection"))}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-face-smile"></span>Seq: Mood</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialMood" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialMood" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(MOOD_PROMPT_PROTOCOL)}</pre>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-brain"></span>Seq: LastThought</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialLastThought" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialLastThought" rows="6"></textarea>
            <div class="bst-prompt-caption">Protocol (read-only)</div>
            <pre class="bst-prompt-protocol">${escapeHtml(LAST_THOUGHT_PROMPT_PROTOCOL)}</pre>
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
  `;
  document.body.appendChild(modal);

  const mergeConnectionAndGeneration = (): void => {
    const sections = Array.from(modal.querySelectorAll(".bst-settings-section")) as HTMLElement[];
    const connectionSection = sections.find(section => section.querySelector("h4")?.textContent?.trim() === "Connection & Generation");
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
      "Connection & Generation": "connection",
      "Extraction": "extraction",
      "Tracked Stats": "tracked-stats",
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
      const stored = localStorage.getItem(storageKey);
      const defaultOpen = id === "extraction" || id === "display";
      const collapsed = stored ? stored === "collapsed" : !defaultOpen;
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
      };
      head.addEventListener("click", toggleSection);
      head.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        toggleSection(event);
      });
    });
  };
  initSectionDrawers();

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
  set("maxDeltaPerTurn", String(input.settings.maxDeltaPerTurn));
  set("maxTokensOverride", String(input.settings.maxTokensOverride));
  set("truncationLengthOverride", String(input.settings.truncationLengthOverride));
  set("includeCharacterCardsInPrompt", String(input.settings.includeCharacterCardsInPrompt));
  set("confidenceDampening", String(input.settings.confidenceDampening));
  set("moodStickiness", String(input.settings.moodStickiness));
  set("injectTrackerIntoPrompt", String(input.settings.injectTrackerIntoPrompt));
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
  set("promptTemplateSequentialMood", input.settings.promptTemplateSequentialMood);
  set("promptTemplateSequentialLastThought", input.settings.promptTemplateSequentialLastThought);
  set("promptTemplateInjection", input.settings.promptTemplateInjection);

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
    const candidateNames = Array.from(
      new Set(
        (input.previewCharacterCandidates ?? [])
          .map(name => String(name ?? "").trim())
          .filter(name => Boolean(name))
          .filter(name => getResolvedMoodSource(input.settings, name) === "st_expressions"),
      ),
    );
    if (!candidateNames.length) return [];
    const resolved = await Promise.all(candidateNames.map(async name => {
      try {
        const spriteUrl = await fetchFirstExpressionSprite(name);
        return spriteUrl ? { name, spriteUrl } : null;
      } catch {
        return null;
      }
    }));
    return resolved
      .filter((entry): entry is GlobalPreviewCharacter => Boolean(entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  if (globalFrameButton) globalFrameButton.disabled = false;

  const collectSettings = (): BetterSimTrackerSettings => {
    const read = (k: keyof BetterSimTrackerSettings): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readExtra = (k: string): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readBool = (k: keyof BetterSimTrackerSettings): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      return read(k) === "true";
    };
    const readBoolExtra = (k: string): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
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

    return {
      ...input.settings,
      connectionProfile: read("connectionProfile"),
      sequentialExtraction: readBool("sequentialExtraction"),
      maxConcurrentCalls: readNumber("maxConcurrentCalls", input.settings.maxConcurrentCalls, 1, 8),
      strictJsonRepair: readBool("strictJsonRepair"),
      maxRetriesPerStat: readNumber("maxRetriesPerStat", input.settings.maxRetriesPerStat, 0, 4),
      contextMessages: readNumber("contextMessages", input.settings.contextMessages, 1, 40),
      maxDeltaPerTurn: readNumber("maxDeltaPerTurn", input.settings.maxDeltaPerTurn, 1, 30),
      maxTokensOverride: readNumber("maxTokensOverride", input.settings.maxTokensOverride, 0, 100000),
      truncationLengthOverride: readNumber("truncationLengthOverride", input.settings.truncationLengthOverride, 0, 200000),
      includeCharacterCardsInPrompt: readBool("includeCharacterCardsInPrompt"),
      confidenceDampening: readNumber("confidenceDampening", input.settings.confidenceDampening, 0, 1),
      moodStickiness: readNumber("moodStickiness", input.settings.moodStickiness, 0, 1),
      injectTrackerIntoPrompt: readBool("injectTrackerIntoPrompt"),
      autoDetectActive: readBool("autoDetectActive"),
      activityLookback: readNumber("activityLookback", input.settings.activityLookback, 1, 25),
      showInactive: readBool("showInactive"),
      inactiveLabel: read("inactiveLabel") || input.settings.inactiveLabel,
      showLastThought: readBool("showLastThought"),
      trackAffection: readBool("trackAffection"),
      trackTrust: readBool("trackTrust"),
      trackDesire: readBool("trackDesire"),
      trackConnection: readBool("trackConnection"),
      trackMood: readBool("trackMood"),
      trackLastThought: readBool("trackLastThought"),
      moodSource: read("moodSource") === "st_expressions" ? "st_expressions" : "bst_images",
      stExpressionImageZoom: readNumber("stExpressionImageZoom", input.settings.stExpressionImageZoom, 0.5, 3),
      stExpressionImagePositionX: readNumber("stExpressionImagePositionX", input.settings.stExpressionImagePositionX, 0, 100),
      stExpressionImagePositionY: readNumber("stExpressionImagePositionY", input.settings.stExpressionImagePositionY, 0, 100),
      accentColor: read("accentColor") || input.settings.accentColor,
      cardOpacity: readNumber("cardOpacity", input.settings.cardOpacity, 0.1, 1),
      borderRadius: readNumber("borderRadius", input.settings.borderRadius, 0, 32),
      fontSize: readNumber("fontSize", input.settings.fontSize, 10, 22),
      debug: readBool("debug"),
      debugFlags: {
        extraction: readBoolExtra("debugExtraction"),
        prompts: readBoolExtra("debugPrompts"),
        ui: readBoolExtra("debugUi"),
        moodImages: readBoolExtra("debugMoodImages"),
        storage: readBoolExtra("debugStorage"),
      },
      includeContextInDiagnostics: readBool("includeContextInDiagnostics"),
      includeGraphInDiagnostics: readBool("includeGraphInDiagnostics"),
      promptTemplateUnified: read("promptTemplateUnified") || input.settings.promptTemplateUnified,
      promptTemplateSequentialAffection: read("promptTemplateSequentialAffection") || input.settings.promptTemplateSequentialAffection,
      promptTemplateSequentialTrust: read("promptTemplateSequentialTrust") || input.settings.promptTemplateSequentialTrust,
      promptTemplateSequentialDesire: read("promptTemplateSequentialDesire") || input.settings.promptTemplateSequentialDesire,
      promptTemplateSequentialConnection: read("promptTemplateSequentialConnection") || input.settings.promptTemplateSequentialConnection,
      promptTemplateSequentialMood: read("promptTemplateSequentialMood") || input.settings.promptTemplateSequentialMood,
      promptTemplateSequentialLastThought: read("promptTemplateSequentialLastThought") || input.settings.promptTemplateSequentialLastThought,
      promptTemplateInjection: read("promptTemplateInjection") || input.settings.promptTemplateInjection
    };
  };

  const syncExtractionVisibility = (): void => {
    const maxConcurrentRow = modal.querySelector('[data-bst-row="maxConcurrentCalls"]') as HTMLElement | null;
    const maxRetriesRow = modal.querySelector('[data-bst-row="maxRetriesPerStat"]') as HTMLElement | null;
    const lookbackRow = modal.querySelector('[data-bst-row="activityLookback"]') as HTMLElement | null;
    const inactiveLabelRow = modal.querySelector('[data-bst-row="inactiveLabel"]') as HTMLElement | null;
    const debugBodyRow = modal.querySelector('[data-bst-row="debugBody"]') as HTMLElement | null;
    const debugFlagsRow = modal.querySelector('[data-bst-row="debugFlags"]') as HTMLElement | null;
    const contextDiagRow = modal.querySelector('[data-bst-row="includeContextInDiagnostics"]') as HTMLElement | null;
    const graphDiagRow = modal.querySelector('[data-bst-row="includeGraphInDiagnostics"]') as HTMLElement | null;
    const injectPromptBlock = modal.querySelector('[data-bst-row="injectPromptBlock"]') as HTMLElement | null;
    const injectPromptDivider = modal.querySelector('[data-bst-row="injectPromptDivider"]') as HTMLElement | null;
    const moodAdvancedBlock = modal.querySelector('[data-bst-row="moodAdvancedBlock"]') as HTMLElement | null;
    const stExpressionImageOptions = modal.querySelector('[data-bst-row="stExpressionImageOptions"]') as HTMLElement | null;
    const current = collectSettings();
    if (maxConcurrentRow) {
      maxConcurrentRow.style.display = current.sequentialExtraction ? "flex" : "none";
      maxConcurrentRow.style.flexDirection = "column";
      maxConcurrentRow.style.gap = "4px";
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
    if (moodAdvancedBlock) {
      moodAdvancedBlock.style.display = current.trackMood ? "block" : "none";
    }
    if (stExpressionImageOptions) {
      stExpressionImageOptions.style.display = current.trackMood && current.moodSource === "st_expressions" ? "block" : "none";
    }
  };

  const persistLive = (): void => {
    const next = collectSettings();
    input.settings = next;
    input.onSave(next);
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
    maxDeltaPerTurn: "Hard cap for stat change magnitude in one tracker update before confidence scaling.",
    maxTokensOverride: "Override max tokens for extraction requests (0 = use profile/preset defaults).",
    truncationLengthOverride: "Override context truncation length for extraction requests (0 = use profile/preset defaults).",
    includeCharacterCardsInPrompt: "Include character card description/personality/scenario if recent messages are unclear.",
    confidenceDampening: "How strongly model confidence scales stat deltas (0 = ignore confidence, 1 = full effect).",
    moodStickiness: "Higher values keep previous mood unless confidence is strong.",
    injectTrackerIntoPrompt: "Inject current relationship state into generation prompt for behavioral coherence.",
    autoDetectActive: "Automatically decide which group characters are active in current scene.",
    activityLookback: "How many recent messages are scanned for active-speaker detection.",
    trackAffection: "Enable Affection stat extraction and updates.",
    trackTrust: "Enable Trust stat extraction and updates.",
    trackDesire: "Enable Desire stat extraction and updates.",
    trackConnection: "Enable Connection stat extraction and updates.",
    trackMood: "Enable mood extraction and mood display updates.",
    trackLastThought: "Enable hidden short internal thought extraction.",
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
    promptTemplateUnified: "Unified prompt instruction (protocol block is fixed).",
    promptTemplateSequentialAffection: "Sequential Affection instruction (protocol block is fixed).",
    promptTemplateSequentialTrust: "Sequential Trust instruction (protocol block is fixed).",
    promptTemplateSequentialDesire: "Sequential Desire instruction (protocol block is fixed).",
    promptTemplateSequentialConnection: "Sequential Connection instruction (protocol block is fixed).",
    promptTemplateSequentialMood: "Sequential Mood instruction (protocol block is fixed).",
    promptTemplateSequentialLastThought: "Sequential LastThought instruction (protocol block is fixed)."
  };
  for (const [key, tooltip] of Object.entries(tooltips) as Array<[keyof BetterSimTrackerSettings, string]>) {
    const inputNode = modal.querySelector(`[data-k="${key}"]`) as HTMLElement | null;
    if (!inputNode) continue;
    inputNode.setAttribute("title", tooltip);
    const labelNode = inputNode.closest("label");
    labelNode?.setAttribute("title", tooltip);
  }

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    persistLive();
    closeSettingsModal();
  });

  modal.querySelector('[data-action="retrack"]')?.addEventListener("click", () => {
    persistLive();
    input.onRetrack?.();
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
    promptTemplateSequentialMood: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
    promptTemplateSequentialLastThought: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
    promptTemplateInjection: DEFAULT_INJECTION_PROMPT_TEMPLATE,
  };

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
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
}

