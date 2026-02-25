import { moodOptions } from "./prompts";
import { logDebug } from "./settings";
import {
  type CharacterDefaultsIdentity,
  resolveCharacterDefaultsEntry,
  updateCharacterDefaultsEntry,
} from "./characterDefaults";
import {
  closeStExpressionFrameEditor,
  formatStExpressionFrameSummary,
  openStExpressionFrameEditor,
  sanitizeStExpressionFrame,
} from "./stExpressionFrameEditor";
import { fetchExpressionSpritePaths, fetchFirstExpressionSprite } from "./stExpressionSprites";
import type {
  BetterSimTrackerSettings,
  CustomStatKind,
  CustomStatDefinition,
  MoodExpressionMap,
  MoodLabel,
  MoodSource,
  StExpressionImageOptions,
  STContext,
} from "./types";

const PANEL_ID = "bst-character-panel";
const NAME_INPUT_SELECTORS = ["#character_name_pole", "#character_name", "input[name='name']"];
const AVATAR_INPUT_SELECTORS = ["#avatar_url_pole", "input[name='avatar']"];
const POPUP_SELECTORS = ["#character_popup", ".character_popup", "#character-settings"];

type InitInput = {
  getContext: () => STContext | null;
  getSettings: () => BetterSimTrackerSettings | null;
  setSettings: (next: BetterSimTrackerSettings) => void;
  saveSettings: (context: STContext, settings: BetterSimTrackerSettings) => void;
  onSettingsUpdated: () => void;
};

type MoodImageSet = Partial<Record<MoodLabel, string>>;

const moodLabelSet = new Set(moodOptions.map(label => label.toLowerCase()));
const moodLabels = moodOptions as MoodLabel[];
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
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXPRESSION_CHECK_TTL_MS = 30_000;
const expressionAvailabilityCache = new Map<string, { checkedAt: number; hasExpressions: boolean }>();
let lastEditorCharacterId: number | null = null;
let editorListenerBound = false;

function notify(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
  const anyGlobal = globalThis as Record<string, unknown>;
  const toastr = anyGlobal.toastr as Record<string, (msg: string, title?: string) => void> | undefined;
  if (toastr && typeof toastr[type] === "function") {
    toastr[type](message, "BetterSimTracker");
    return;
  }
  if (type === "error") {
    console.error("[BetterSimTracker]", message);
  } else if (type === "warning") {
    console.warn("[BetterSimTracker]", message);
  } else {
    console.log("[BetterSimTracker]", message);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssEscape(value: string): string {
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
    return globalThis.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function validateImageFile(file: File): Promise<string | null> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Unsupported image format. Use PNG, JPG, or WebP.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `Image too large. Max size is ${formatBytes(MAX_IMAGE_BYTES)}.`;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image."));
      img.src = url;
    });
    if (img.width > MAX_IMAGE_WIDTH || img.height > MAX_IMAGE_HEIGHT) {
      return `Image too large. Max dimensions are ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}px.`;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mood";
}

function moodSpriteName(mood: MoodLabel): string {
  return `bst_mood_${slugify(mood)}`;
}

function normalizeMoodLabel(raw: string): MoodLabel | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (moodLabelSet.has(key)) return moodOptions.find(label => label.toLowerCase() === key) as MoodLabel;
  return null;
}

function normalizeMoodSource(raw: string): MoodSource | null {
  if (raw === "bst_images" || raw === "st_expressions") return raw;
  return null;
}

async function hasExpressionSpritesForCharacter(characterName: string): Promise<boolean> {
  const key = characterName.trim().toLowerCase();
  if (!key) return false;
  const cached = expressionAvailabilityCache.get(key);
  if (cached && Date.now() - cached.checkedAt < EXPRESSION_CHECK_TTL_MS) {
    return cached.hasExpressions;
  }
  const sprites = await fetchExpressionSpritePaths(characterName);
  const hasExpressions = sprites.length > 0;
  expressionAvailabilityCache.set(key, { checkedAt: Date.now(), hasExpressions });
  return hasExpressions;
}

function sanitizeExpressionValue(raw: string): string {
  return raw.trim().slice(0, 80);
}

function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return null;
  const normalized = value.length === 3
    ? value.split("").map(char => char + char).join("")
    : value;
  return `#${normalized.toLowerCase()}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeStExpressionImageOptions(raw: unknown, fallback: StExpressionImageOptions): StExpressionImageOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const zoomRaw = Number(obj.zoom);
  const xRaw = Number(obj.positionX);
  const yRaw = Number(obj.positionY);
  const zoom = Number.isFinite(zoomRaw) ? clampNumber(zoomRaw, 0.5, 3) : fallback.zoom;
  const positionX = Number.isFinite(xRaw) ? clampNumber(xRaw, 0, 100) : fallback.positionX;
  const positionY = Number.isFinite(yRaw) ? clampNumber(yRaw, 0, 100) : fallback.positionY;
  return { zoom, positionX, positionY };
}

function findPopup(): HTMLElement | null {
  for (const selector of POPUP_SELECTORS) {
    const node = document.querySelector(selector);
    if (node instanceof HTMLElement) return node;
  }
  return null;
}

function findNameInput(container: HTMLElement): HTMLInputElement | null {
  for (const selector of NAME_INPUT_SELECTORS) {
    const node = container.querySelector(selector);
    if (node instanceof HTMLInputElement) return node;
  }
  return null;
}

function findAvatarInput(container: HTMLElement): HTMLInputElement | null {
  for (const selector of AVATAR_INPUT_SELECTORS) {
    const node = container.querySelector(selector);
    if (node instanceof HTMLInputElement) return node;
  }
  return null;
}

function findPanelContainer(popup: HTMLElement): HTMLElement {
  const candidates = [
    popup.querySelector(".character-settings"),
    popup.querySelector(".character_settings"),
    popup.querySelector(".character-advanced"),
    popup.querySelector(".character_editor"),
    popup.querySelector(".character-card"),
    popup.querySelector(".character_card"),
  ];
  for (const node of candidates) {
    if (node instanceof HTMLElement) return node;
  }
  return popup;
}

function getDefaults(settings: BetterSimTrackerSettings, identity: CharacterDefaultsIdentity): Record<string, unknown> {
  return resolveCharacterDefaultsEntry(settings, identity);
}

function withUpdatedDefaults(
  settings: BetterSimTrackerSettings,
  identity: CharacterDefaultsIdentity,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): BetterSimTrackerSettings {
  return updateCharacterDefaultsEntry(settings, identity, updater);
}

function clampStat(value: string): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeCustomStatKind(value: unknown): CustomStatKind {
  if (value === "enum_single" || value === "boolean" || value === "text_short") return value;
  return "numeric";
}

function normalizeCustomEnumOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const token = String(item ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 12) break;
  }
  return out;
}

function clampPercentInputElement(input: HTMLInputElement): void {
  const value = input.value.trim();
  if (!value) return;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return;
  const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
  if (String(clamped) !== input.value) {
    input.value = String(clamped);
  }
}

function sanitizeMoodDefaultValue(value: string): string | null {
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed) return null;
  return normalizeMoodLabel(trimmed) ?? trimmed;
}

function resolveEffectiveMoodSource(settings: BetterSimTrackerSettings, defaults: Record<string, unknown>): MoodSource {
  return normalizeMoodSource(String(defaults.moodSource ?? "")) ?? normalizeMoodSource(String(settings.moodSource ?? "")) ?? "bst_images";
}

function normalizeSpriteList(data: unknown): Array<{ label?: string; path?: string }> {
  if (Array.isArray(data)) return data as Array<{ label?: string; path?: string }>;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.sprites)) return record.sprites as Array<{ label?: string; path?: string }>;
    if (Array.isArray(record.data)) return record.data as Array<{ label?: string; path?: string }>;
  }
  return [];
}

async function fetchSpriteList(
  headers: Record<string, string>,
  characterName: string,
  settings: BetterSimTrackerSettings,
): Promise<Array<{ label?: string; path?: string }>> {
  const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(characterName)}`, {
    method: "GET",
    headers
  });
  if (!response.ok) {
    logDebug(settings, "moodImages", "sprites.get failed", { status: response.status, characterName });
    throw new Error("Upload succeeded but sprite list could not be loaded.");
  }
  const data = await response.json();
  const list = normalizeSpriteList(data);
  logDebug(settings, "moodImages", "sprites.get ok", { characterName, count: list.length });
  return list;
}

async function uploadMoodImage(
  context: STContext,
  settings: BetterSimTrackerSettings,
  characterName: string,
  mood: MoodLabel,
  file: File,
): Promise<string> {
  const label = moodSpriteName(mood);
  const headers: Record<string, string> = {};
  if (context.csrf_token) {
    headers["X-CSRF-Token"] = context.csrf_token;
  }

  const beforeSprites = await fetchSpriteList(headers, characterName, settings).catch(() => []);
  logDebug(settings, "moodImages", "sprites.upload start", { characterName, mood, label, beforeCount: beforeSprites.length });
  const form = new FormData();
  form.append("name", characterName);
  form.append("label", label);
  form.append("spriteName", label);
  form.append("avatar", file);

  const response = await fetch("/api/sprites/upload", {
    method: "POST",
    body: form,
    headers
  });

  if (!response.ok) {
    logDebug(settings, "moodImages", "sprites.upload failed", { status: response.status, characterName, mood, label });
    throw new Error(`Upload failed (${response.status})`);
  }

  logDebug(settings, "moodImages", "sprites.upload ok", { characterName, mood, label });
  const sprites = await fetchSpriteList(headers, characterName, settings);
  const normalizedLabel = label.toLowerCase();
  const match = sprites.find(sprite => String(sprite.label ?? "").toLowerCase() === normalizedLabel);
  if (match?.path) {
    logDebug(settings, "moodImages", "sprites.match label", { characterName, mood, label, path: match.path });
    return match.path;
  }

  const beforePaths = new Set(beforeSprites.map(sprite => sprite.path).filter(Boolean) as string[]);
  const added = sprites.filter(sprite => sprite.path && !beforePaths.has(sprite.path));
  if (added.length === 1 && added[0].path) {
    logDebug(settings, "moodImages", "sprites.match added", { characterName, mood, label, path: added[0].path });
    return added[0].path;
  }

  logDebug(settings, "moodImages", "sprites.match failed", {
    characterName,
    mood,
    label,
    afterCount: sprites.length,
    addedCount: added.length
  });
  throw new Error("Upload succeeded but sprite was not found in list.");
}

async function deleteMoodImage(
  context: STContext,
  settings: BetterSimTrackerSettings,
  characterName: string,
  mood: MoodLabel,
): Promise<void> {
  const spriteName = moodSpriteName(mood);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (context.csrf_token) {
    headers["X-CSRF-Token"] = context.csrf_token;
  }

  logDebug(settings, "moodImages", "sprites.delete start", { characterName, mood, spriteName });
  const response = await fetch("/api/sprites/delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: characterName, label: spriteName, spriteName })
  });

  if (!response.ok) {
    logDebug(settings, "moodImages", "sprites.delete failed", { status: response.status, characterName, mood, spriteName });
    throw new Error(`Failed to delete ${mood} image (${response.status}).`);
  }
  logDebug(settings, "moodImages", "sprites.delete ok", { characterName, mood, spriteName });
}

function countMoodImages(images: MoodImageSet | undefined): number {
  if (!images) return 0;
  return Object.values(images).filter(value => typeof value === "string" && value.trim()).length;
}

function parseCharacterEditorId(payload: unknown): number | null {
  if (typeof payload === "string") {
    const parsedRaw = Number(payload);
    return Number.isInteger(parsedRaw) ? parsedRaw : null;
  }
  if (typeof payload === "number" && Number.isInteger(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidate = obj.detail && typeof obj.detail === "object"
    ? (obj.detail as Record<string, unknown>).id
    : obj.id;
  if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) ? parsed : null;
}

export function initCharacterPanel(input: InitInput): void {
  let renderTimer: number | null = null;

  const scheduleRender = (): void => {
    if (renderTimer !== null) {
      window.clearTimeout(renderTimer);
    }
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderPanel(input, false);
    }, 120);
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, { childList: true, subtree: true });
  if (!editorListenerBound) {
    const context = input.getContext();
    const events = context?.event_types ?? {};
    const source = context?.eventSource;
    const eventName = events.CHARACTER_EDITOR_OPENED;
    if (source && eventName) {
      source.on(eventName, (payload: unknown) => {
        const id = parseCharacterEditorId(payload);
        if (id != null) {
          lastEditorCharacterId = id;
          scheduleRender();
        }
      });
      editorListenerBound = true;
    }
  }
  scheduleRender();
}

function renderPanel(input: InitInput, force = false): void {
  const context = input.getContext();
  const settings = input.getSettings();
  if (!context || !settings) return;

  const popup = findPopup();
  if (!popup) return;

  const container = findPanelContainer(popup);
  let panel = popup.querySelector(`#${PANEL_ID}`) as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "bst-character-panel";
    container.appendChild(panel);
  } else if (!force) {
    const active = document.activeElement;
    if (active && panel.contains(active)) {
      return;
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      if ((anchor && panel.contains(anchor)) || (focus && panel.contains(focus))) {
        return;
      }
    }
  }

  const nameInput = findNameInput(popup);
  const avatarInput = findAvatarInput(popup);
  const nameFromInput = nameInput?.value.trim() ?? "";
  const contextCharacterIdRaw = typeof context.characterId === "string" || typeof context.characterId === "number"
    ? Number(context.characterId)
    : Number.NaN;
  const contextCharacterId = Number.isInteger(contextCharacterIdRaw) ? contextCharacterIdRaw : null;
  const contextCharacter = contextCharacterId != null
    ? context.characters?.[contextCharacterId]
    : null;
  const editorCharacter = typeof lastEditorCharacterId === "number"
    ? context.characters?.[lastEditorCharacterId] ?? null
    : null;
  const avatarFromInput = avatarInput?.value.trim() ?? "";
  const avatarMatchedCharacter = avatarFromInput
    ? context.characters?.find(character => String(character?.avatar ?? "").trim() === avatarFromInput) ?? null
    : null;
  const characterName =
    nameFromInput ||
    avatarMatchedCharacter?.name?.trim() ||
    editorCharacter?.name?.trim() ||
    contextCharacter?.name?.trim() ||
    context.name2?.trim() ||
    context.name1?.trim() ||
    "";
  const normalizedName = characterName.trim().toLowerCase();
  const namedCharacter = normalizedName
    ? context.characters?.find(character => String(character?.name ?? "").trim().toLowerCase() === normalizedName) ?? null
    : null;
  const editorCharacterName = String(editorCharacter?.name ?? "").trim().toLowerCase();
  const editorCharacterMatchesSelection = Boolean(
    editorCharacterName &&
    normalizedName &&
    editorCharacterName === normalizedName,
  );
  const contextCharacterName = String(contextCharacter?.name ?? "").trim().toLowerCase();
  const contextCharacterMatchesSelection = Boolean(
    normalizedName &&
    contextCharacterName &&
    contextCharacterName === normalizedName,
  );
  const resolvedCharacter =
    avatarMatchedCharacter ??
    (editorCharacterMatchesSelection ? editorCharacter : null) ??
    namedCharacter ??
    (contextCharacterMatchesSelection ? contextCharacter : null) ??
    editorCharacter ??
    contextCharacter ??
    null;
  const resolvedCharacterName = String(resolvedCharacter?.name ?? "").trim() || characterName;
  const characterAvatar =
    resolvedCharacter?.avatar?.trim() ||
    avatarFromInput ||
    "";
  const characterIdentity: CharacterDefaultsIdentity = { name: resolvedCharacterName, avatar: characterAvatar };
  if (!characterName) {
    panel.innerHTML = `
      <div class="bst-character-title">BetterSimTracker</div>
      <div class="bst-character-sub">Open a character to edit defaults.</div>
    `;
    return;
  }

  const defaults = getDefaults(settings, characterIdentity);
  const moodImages = (defaults.moodImages as MoodImageSet | undefined) ?? {};
  const moodCount = countMoodImages(moodImages);
  const moodSourceOverride = normalizeMoodSource(String(defaults.moodSource ?? ""));
  const effectiveMoodSource = resolveEffectiveMoodSource(settings, defaults);
  const showStExpressionControls = effectiveMoodSource === "st_expressions";
  const showBstMoodImageControls = effectiveMoodSource === "bst_images";
  const moodExpressionMap = (defaults.moodExpressionMap as MoodExpressionMap | undefined) ?? {};
  const globalMoodExpressionMap = (settings.moodExpressionMap as MoodExpressionMap | undefined) ?? DEFAULT_MOOD_EXPRESSION_MAP;
  const globalStImageDefaults: StExpressionImageOptions = {
    zoom: settings.stExpressionImageZoom,
    positionX: settings.stExpressionImagePositionX,
    positionY: settings.stExpressionImagePositionY,
  };
  const stExpressionImageOptionsOverride = sanitizeStExpressionImageOptions(defaults.stExpressionImageOptions, globalStImageDefaults);
  const hasStExpressionImageOverride = Boolean(stExpressionImageOptionsOverride);
  const stExpressionImageOptions = stExpressionImageOptionsOverride ?? globalStImageDefaults;
  const customStatDefinitions = Array.isArray(settings.customStats)
    ? settings.customStats as CustomStatDefinition[]
    : [];
  const customNumericDefaultsRaw = defaults.customStatDefaults && typeof defaults.customStatDefaults === "object"
    ? defaults.customStatDefaults as Record<string, unknown>
    : {};
  const customNonNumericDefaultsRaw = defaults.customNonNumericStatDefaults && typeof defaults.customNonNumericStatDefaults === "object"
    ? defaults.customNonNumericStatDefaults as Record<string, unknown>
    : {};
  const normalizedCardColor = typeof defaults.cardColor === "string"
    ? normalizeHexColor(defaults.cardColor) ?? ""
    : "";
  const cardColorPreview = normalizedCardColor || "#1f2028";
  const customStatFieldsHtml = customStatDefinitions.map(definition => {
    const id = String(definition.id ?? "").trim().toLowerCase();
    const label = String(definition.label ?? "").trim();
    if (!id || !label) return "";
    const kind = normalizeCustomStatKind(definition.kind);
    if (kind === "numeric") {
      const rawValue = customNumericDefaultsRaw[id];
      const value = typeof rawValue === "number" && Number.isFinite(rawValue)
        ? String(Math.max(0, Math.min(100, Math.round(rawValue))))
        : "";
      return `
        <label>${escapeHtml(label)} Default
          <input type="number" min="0" max="100" step="1" data-bst-custom-default-num="${escapeHtml(id)}" value="${escapeHtml(value)}" placeholder="Use stat default">
        </label>
      `;
    }
    if (kind === "enum_single") {
      const options = normalizeCustomEnumOptions(definition.enumOptions);
      const rawValue = String(customNonNumericDefaultsRaw[id] ?? "").trim().toLowerCase();
      const selected = options.includes(rawValue) ? rawValue : "";
      return `
        <label>${escapeHtml(label)} Default
          <select data-bst-custom-default-enum="${escapeHtml(id)}">
            <option value="">Use stat default</option>
            ${options.map(option => `<option value="${escapeHtml(option)}" ${selected === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
          </select>
        </label>
      `;
    }
    if (kind === "boolean") {
      const rawValue = customNonNumericDefaultsRaw[id];
      const selected = typeof rawValue === "boolean" ? String(rawValue) : "";
      const trueLabel = String(definition.booleanTrueLabel ?? "enabled").trim() || "enabled";
      const falseLabel = String(definition.booleanFalseLabel ?? "disabled").trim() || "disabled";
      return `
        <label>${escapeHtml(label)} Default
          <select data-bst-custom-default-bool="${escapeHtml(id)}">
            <option value="">Use stat default</option>
            <option value="true" ${selected === "true" ? "selected" : ""}>${escapeHtml(trueLabel)}</option>
            <option value="false" ${selected === "false" ? "selected" : ""}>${escapeHtml(falseLabel)}</option>
          </select>
        </label>
      `;
    }
    const maxLength = Math.max(20, Math.min(200, Math.round(Number(definition.textMaxLength) || 120)));
    const rawValue = String(customNonNumericDefaultsRaw[id] ?? "").trim().replace(/\s+/g, " ");
    return `
      <label>${escapeHtml(label)} Default
        <input type="text" maxlength="${maxLength}" data-bst-custom-default-text="${escapeHtml(id)}" value="${escapeHtml(rawValue)}" placeholder="Use stat default">
      </label>
    `;
  }).filter(Boolean).join("");
  const getLiveSettings = (): BetterSimTrackerSettings => input.getSettings() ?? settings;
  const persistSettings = (next: BetterSimTrackerSettings): void => {
    input.setSettings(next);
    input.saveSettings(context, next);
    input.onSettingsUpdated();
  };
  const updateDefaults = (updater: (current: Record<string, unknown>) => Record<string, unknown>): void => {
    const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, updater);
    persistSettings(next);
  };

  panel.innerHTML = `
    <div class="bst-character-title">BetterSimTracker Defaults</div>
    <div class="bst-character-sub">Per-character defaults and optional mood source overrides.</div>
    <div class="bst-character-grid">
      <label>Affection Default <input type="number" min="0" max="100" step="1" data-bst-default="affection" value="${defaults.affection ?? ""}"></label>
      <label>Trust Default <input type="number" min="0" max="100" step="1" data-bst-default="trust" value="${defaults.trust ?? ""}"></label>
      <label>Desire Default <input type="number" min="0" max="100" step="1" data-bst-default="desire" value="${defaults.desire ?? ""}"></label>
      <label>Connection Default <input type="number" min="0" max="100" step="1" data-bst-default="connection" value="${defaults.connection ?? ""}"></label>
      <label class="bst-character-wide">Mood Default <input type="text" data-bst-default="mood" value="${defaults.mood ?? ""}" placeholder="Neutral"></label>
      <label class="bst-character-wide">Card Color (optional)
        <div class="bst-color-inputs">
          <input data-bst-color="cardColor" type="color" value="${escapeHtml(cardColorPreview)}">
          <input type="text" data-bst-default="cardColor" value="${escapeHtml(normalizedCardColor)}" placeholder="Auto">
        </div>
      </label>
    </div>
    <div class="bst-character-help">Leave card color empty to use the automatic palette for this character. Hex colors like #2b7cff.</div>
    <div class="bst-character-divider">Custom Stat Defaults</div>
    ${customStatFieldsHtml
      ? `<div class="bst-character-grid bst-character-grid-three">${customStatFieldsHtml}</div>`
      : `<div class="bst-character-help">No custom stats configured in extension settings yet.</div>`}
    <div class="bst-character-divider">Mood Source Override</div>
    <div class="bst-character-grid">
      <label class="bst-character-wide">Mood Source
        <select data-bst-default="moodSource">
          <option value="">Use global setting</option>
          <option value="bst_images" ${moodSourceOverride === "bst_images" ? "selected" : ""}>BST mood images</option>
          <option value="st_expressions" ${moodSourceOverride === "st_expressions" ? "selected" : ""}>ST expressions</option>
        </select>
      </label>
    </div>
    <div class="bst-character-help">
      Effective mood source right now: <strong>${effectiveMoodSource === "st_expressions" ? "ST expressions" : "BST mood images"}</strong>.
    </div>
    <div style="display:${showStExpressionControls ? "grid" : "none"}; gap:8px;">
      <div class="bst-character-divider">Mood to ST Expression Map</div>
      <div class="bst-character-help">
        Optional per-character overrides. Leave empty to use the global map from extension settings.
      </div>
      <div class="bst-character-map">
        ${moodLabels.map(label => {
          const safeLabel = escapeHtml(label);
          const value = typeof moodExpressionMap[label] === "string" ? moodExpressionMap[label] ?? "" : "";
          const safeValue = value ? escapeHtml(value) : "";
          const placeholder = globalMoodExpressionMap[label] || DEFAULT_MOOD_EXPRESSION_MAP[label];
          const safePlaceholder = escapeHtml(placeholder);
          return `
            <label class="bst-character-map-row">
              <span>${safeLabel}</span>
              <input type="text" data-bst-mood-map="${safeLabel}" value="${safeValue}" placeholder="${safePlaceholder}">
            </label>
          `;
        }).join("")}
      </div>
      <div class="bst-character-divider">ST Expression Image Options</div>
      <div class="bst-character-help">
        Optional per-character override for expression image framing.
      </div>
      <label class="bst-character-check">
        <input type="checkbox" data-bst-st-image-override ${hasStExpressionImageOverride ? "checked" : ""}>
        <span>Advanced image options (override global)</span>
      </label>
      <div class="bst-character-grid" data-bst-st-image-options style="display:${hasStExpressionImageOverride ? "grid" : "none"};">
        <div class="bst-character-wide bst-character-st-tools">
          <button type="button" class="bst-btn bst-btn-soft" data-action="open-st-image-editor">Adjust ST Expression Framing</button>
          <div class="bst-character-help bst-character-help-compact" data-bst-st-image-summary>
            Current override: ${formatStExpressionFrameSummary(stExpressionImageOptions)}
          </div>
        </div>
      </div>
    </div>
    <div class="bst-character-help" style="display:${showStExpressionControls ? "none" : "block"};">
      Switch effective mood source to ST expressions to edit expression mapping and framing.
    </div>
    <div style="display:${showBstMoodImageControls ? "grid" : "none"}; gap:8px;">
      <div class="bst-character-divider">Mood Images</div>
      <div class="bst-character-help">
        Upload one image per mood label. Missing images fall back to emoji.
        Max ${formatBytes(MAX_IMAGE_BYTES)} and ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}px. PNG/JPG/WebP only.
      </div>
      <div class="bst-character-help">Configured mood images: ${moodCount}/${moodLabels.length}</div>
      <div class="bst-character-moods">
        ${moodLabels.map(label => {
          const url = moodImages[label] ?? "";
          const safeUrl = url ? escapeHtml(url) : "";
          const safeLabel = escapeHtml(label);
          return `
            <div class="bst-mood-slot" data-mood="${safeLabel}">
              <div class="bst-mood-thumb">
                ${url ? `<img src="${safeUrl}" alt="${safeLabel} mood">` : `<span>No image</span>`}
              </div>
              <div class="bst-mood-label">${safeLabel}</div>
              <div class="bst-mood-actions">
                <button type="button" class="bst-btn bst-btn-soft bst-mood-upload" data-action="upload" data-mood="${safeLabel}">Upload</button>
                <button type="button" class="bst-btn bst-btn-danger bst-mood-clear" data-action="clear" data-mood="${safeLabel}">Clear</button>
                <input class="bst-mood-input" type="file" accept="image/*" data-mood="${safeLabel}">
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="bst-character-actions">
        <button type="button" class="bst-btn bst-btn-danger" data-action="clear-all">Clear All Mood Images</button>
      </div>
    </div>
    <div class="bst-character-help" style="display:${showBstMoodImageControls ? "none" : "block"};">
      Switch effective mood source to BST mood images to manage per-mood image uploads.
    </div>
  `;

  if (nameInput && !nameInput.dataset.bstListener) {
    nameInput.dataset.bstListener = "1";
    nameInput.addEventListener("input", () => renderPanel(input, false));
  }

  panel.querySelectorAll<HTMLInputElement>('input[type="number"][data-bst-default], input[type="number"][data-bst-custom-default-num]').forEach(node => {
    node.min = "0";
    node.max = "100";
    node.step = "1";
    node.addEventListener("input", () => clampPercentInputElement(node));
    node.addEventListener("blur", () => clampPercentInputElement(node));
  });

  const cardColorInput = panel.querySelector<HTMLInputElement>('input[type="color"][data-bst-color="cardColor"]');
  const cardColorText = panel.querySelector<HTMLInputElement>('input[type="text"][data-bst-default="cardColor"]');

  if (cardColorInput && cardColorText) {
    const applyFromPicker = () => {
      const normalized = normalizeHexColor(cardColorInput.value);
      cardColorText.value = normalized ?? "";
      cardColorText.dispatchEvent(new Event("change", { bubbles: true }));
    };
    cardColorInput.addEventListener("input", applyFromPicker);
    cardColorInput.addEventListener("change", applyFromPicker);
    cardColorText.addEventListener("input", () => {
      const normalized = normalizeHexColor(cardColorText.value);
      if (normalized) {
        cardColorInput.value = normalized;
      }
    });
  }

  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-bst-default]").forEach(node => {
    node.addEventListener("change", async () => {
      const key = node.dataset.bstDefault ?? "";
      const value = node.value;
      const liveSettings = getLiveSettings();
      const liveDefaults = getDefaults(liveSettings, characterIdentity);
      const currentMoodSource = normalizeMoodSource(String(liveDefaults.moodSource ?? "")) ?? "";
      if (key === "moodSource") {
        const selectedSource = normalizeMoodSource(value);
        if (selectedSource === "st_expressions") {
          const hasExpressions = await hasExpressionSpritesForCharacter(resolvedCharacterName);
          if (!hasExpressions) {
            node.value = currentMoodSource;
            notify("This character has no ST expression sprites. Set expressions first, then enable ST expressions.", "warning");
            return;
          }
        }
      }
      const next = withUpdatedDefaults(liveSettings, characterIdentity, current => {
        const copy = { ...current };
        if (key === "mood") {
          const sanitized = sanitizeMoodDefaultValue(value);
          node.value = sanitized ?? "";
          if (!sanitized) {
            delete copy.mood;
          } else {
            copy.mood = sanitized;
          }
        } else if (key === "cardColor") {
          const normalized = normalizeHexColor(value);
          if (cardColorInput) {
            cardColorInput.value = normalized ?? "#1f2028";
          }
          node.value = normalized ?? "";
          if (!normalized) {
            delete copy.cardColor;
          } else {
            copy.cardColor = normalized;
          }
        } else if (key === "moodSource") {
          const source = normalizeMoodSource(value);
          node.value = source ?? "";
          if (!source) {
            delete copy.moodSource;
          } else {
            copy.moodSource = source;
          }
        } else {
          const num = clampStat(value);
          node.value = num == null ? "" : String(num);
          if (num == null) {
            delete copy[key];
          } else {
            copy[key] = num;
          }
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  panel.querySelectorAll<HTMLInputElement>("[data-bst-custom-default-num]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstCustomDefaultNum ?? "").trim().toLowerCase();
      if (!id) return;
      const num = clampStat(node.value);
      node.value = num == null ? "" : String(num);
      const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
        const copy = { ...current };
        const existing = copy.customStatDefaults && typeof copy.customStatDefaults === "object"
          ? { ...(copy.customStatDefaults as Record<string, unknown>) }
          : {};
        if (num == null) {
          delete existing[id];
        } else {
          existing[id] = num;
        }
        if (Object.keys(existing).length === 0) {
          delete copy.customStatDefaults;
        } else {
          copy.customStatDefaults = existing;
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  panel.querySelectorAll<HTMLSelectElement>("[data-bst-custom-default-enum]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstCustomDefaultEnum ?? "").trim().toLowerCase();
      if (!id) return;
      const value = String(node.value ?? "").trim().toLowerCase();
      const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
        const copy = { ...current };
        const existing = copy.customNonNumericStatDefaults && typeof copy.customNonNumericStatDefaults === "object"
          ? { ...(copy.customNonNumericStatDefaults as Record<string, unknown>) }
          : {};
        if (!value) {
          delete existing[id];
        } else {
          existing[id] = value;
        }
        if (Object.keys(existing).length === 0) {
          delete copy.customNonNumericStatDefaults;
        } else {
          copy.customNonNumericStatDefaults = existing;
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  panel.querySelectorAll<HTMLSelectElement>("[data-bst-custom-default-bool]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstCustomDefaultBool ?? "").trim().toLowerCase();
      if (!id) return;
      const raw = String(node.value ?? "").trim().toLowerCase();
      const value = raw === "true" ? true : raw === "false" ? false : null;
      const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
        const copy = { ...current };
        const existing = copy.customNonNumericStatDefaults && typeof copy.customNonNumericStatDefaults === "object"
          ? { ...(copy.customNonNumericStatDefaults as Record<string, unknown>) }
          : {};
        if (value == null) {
          delete existing[id];
        } else {
          existing[id] = value;
        }
        if (Object.keys(existing).length === 0) {
          delete copy.customNonNumericStatDefaults;
        } else {
          copy.customNonNumericStatDefaults = existing;
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  panel.querySelectorAll<HTMLInputElement>("[data-bst-custom-default-text]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstCustomDefaultText ?? "").trim().toLowerCase();
      if (!id) return;
      const maxLength = Math.max(20, Math.min(200, Math.round(Number(node.maxLength) || 120)));
      const value = String(node.value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
      node.value = value;
      const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
        const copy = { ...current };
        const existing = copy.customNonNumericStatDefaults && typeof copy.customNonNumericStatDefaults === "object"
          ? { ...(copy.customNonNumericStatDefaults as Record<string, unknown>) }
          : {};
        if (!value) {
          delete existing[id];
        } else {
          existing[id] = value;
        }
        if (Object.keys(existing).length === 0) {
          delete copy.customNonNumericStatDefaults;
        } else {
          copy.customNonNumericStatDefaults = existing;
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  const moodSourceSelect = panel.querySelector<HTMLSelectElement>('select[data-bst-default="moodSource"]');
  const moodSourceStOption = moodSourceSelect?.querySelector('option[value="st_expressions"]') as HTMLOptionElement | null;
  if (moodSourceSelect && moodSourceStOption) {
    moodSourceStOption.disabled = true;
    moodSourceStOption.textContent = "ST expressions (checking...)";
    void hasExpressionSpritesForCharacter(resolvedCharacterName)
      .then(hasExpressions => {
        if (!panel.isConnected) return;
        moodSourceStOption.disabled = !hasExpressions;
        moodSourceStOption.textContent = hasExpressions ? "ST expressions" : "ST expressions (no sprites)";
        if (!hasExpressions && moodSourceSelect.value === "st_expressions") {
          moodSourceSelect.value = "";
          const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
            const copy = { ...current };
            delete copy.moodSource;
            return copy;
          });
          persistSettings(next);
        }
      })
      .catch(() => {
        if (!panel.isConnected) return;
        moodSourceStOption.disabled = true;
        moodSourceStOption.textContent = "ST expressions (check failed)";
      });
  }

  panel.querySelectorAll<HTMLInputElement>("[data-bst-mood-map]").forEach(node => {
    node.addEventListener("change", () => {
      const mood = normalizeMoodLabel(node.dataset.bstMoodMap ?? "");
      if (!mood) return;
      const expression = sanitizeExpressionValue(node.value);
      node.value = expression;
      const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
        const copy = { ...current };
        const map = { ...((copy.moodExpressionMap as MoodExpressionMap | undefined) ?? {}) };
        if (!expression) {
          delete map[mood];
        } else {
          map[mood] = expression;
        }
        if (Object.keys(map).length) {
          copy.moodExpressionMap = map;
        } else {
          delete copy.moodExpressionMap;
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  const stImageOverrideToggle = panel.querySelector<HTMLInputElement>("[data-bst-st-image-override]");
  const stImageOptionsBlock = panel.querySelector<HTMLElement>("[data-bst-st-image-options]");
  const stImageSummaryNode = panel.querySelector<HTMLElement>("[data-bst-st-image-summary]");
  const setStImageSummary = (value: StExpressionImageOptions): void => {
    if (!stImageSummaryNode) return;
    stImageSummaryNode.textContent = `Current override: ${formatStExpressionFrameSummary(value)}`;
  };
  if (hasStExpressionImageOverride) {
    setStImageSummary(stExpressionImageOptions);
  }
  stImageOverrideToggle?.addEventListener("change", () => {
    const enabled = stImageOverrideToggle.checked;
    if (stImageOptionsBlock) {
      stImageOptionsBlock.style.display = enabled ? "grid" : "none";
    }
    if (!enabled) {
      closeStExpressionFrameEditor();
    }
    const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
      const copy = { ...current };
      if (!enabled) {
        delete copy.stExpressionImageOptions;
      } else {
        copy.stExpressionImageOptions = {
          zoom: globalStImageDefaults.zoom,
          positionX: globalStImageDefaults.positionX,
          positionY: globalStImageDefaults.positionY,
        };
      }
      return copy;
    });
    persistSettings(next);
  });

  panel.querySelector('[data-action="open-st-image-editor"]')?.addEventListener("click", async event => {
    if (!stImageOverrideToggle?.checked) return;
    const button = event.currentTarget as HTMLButtonElement | null;
    const originalLabel = button?.textContent ?? "Adjust ST Expression Framing";
    if (button) {
      button.disabled = true;
      button.textContent = "Loading preview...";
    }
    const liveSettings = getLiveSettings();
    const liveDefaults = getDefaults(liveSettings, characterIdentity);
    const liveOverride = sanitizeStExpressionImageOptions(liveDefaults.stExpressionImageOptions, globalStImageDefaults);
    const initialFrame = liveOverride ?? globalStImageDefaults;
    let previewSpriteUrl: string | null = null;
    try {
      previewSpriteUrl = await fetchFirstExpressionSprite(resolvedCharacterName);
    } catch {
      previewSpriteUrl = null;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
    openStExpressionFrameEditor({
      title: `${resolvedCharacterName}: ST Expression Framing`,
      description: previewSpriteUrl
        ? "Per-character framing override with this character's ST expression preview."
        : "Per-character framing override used when this character resolves to ST expressions.",
      initial: initialFrame,
      fallback: globalStImageDefaults,
      previewChoices: previewSpriteUrl ? [{ name: resolvedCharacterName, imageUrl: previewSpriteUrl }] : [],
      selectedPreviewName: resolvedCharacterName,
      emptyPreviewText: "No ST expressions found for this character. Add at least one expression sprite and try again.",
      onChange: nextFrame => {
        if (!stImageOverrideToggle?.checked) return;
        const sanitized = sanitizeStExpressionFrame(nextFrame, globalStImageDefaults);
        setStImageSummary(sanitized);
        const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
          const copy = { ...current };
          copy.stExpressionImageOptions = sanitized;
          return copy;
        });
        persistSettings(next);
      },
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("[data-action='upload']").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const mood = (button.dataset.mood ?? "").trim();
      if (!mood) return;
      const inputNode = panel!.querySelector(`input.bst-mood-input[data-mood="${cssEscape(mood)}"]`) as HTMLInputElement | null;
      if (inputNode) {
        window.setTimeout(() => inputNode.click(), 0);
      }
    });
  });

  panel.querySelectorAll<HTMLInputElement>("input.bst-mood-input").forEach(inputNode => {
    inputNode.addEventListener("change", async () => {
      const moodRaw = inputNode.dataset.mood ?? "";
      const mood = normalizeMoodLabel(moodRaw);
      const file = inputNode.files?.[0];
      inputNode.value = "";
      if (!mood || !file) return;
      const validationError = await validateImageFile(file);
      if (validationError) {
        notify(validationError, "warning");
        return;
      }
      try {
        const liveSettings = getLiveSettings();
        notify(`Uploading ${mood} image...`, "info");
        const url = await uploadMoodImage(context, liveSettings, resolvedCharacterName, mood, file);
        const next = withUpdatedDefaults(liveSettings, characterIdentity, current => {
          const copy = { ...current };
          const existing = (copy.moodImages as MoodImageSet | undefined) ?? {};
          copy.moodImages = { ...existing, [mood]: url };
          return copy;
        });
        persistSettings(next);
        notify(`${mood} image saved.`, "success");
        renderPanel(input, true);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Mood image upload failed.", "error");
      }
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("[data-action='clear']").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const moodRaw = button.dataset.mood ?? "";
      const mood = normalizeMoodLabel(moodRaw);
      if (!mood) return;
      const liveSettings = getLiveSettings();
      deleteMoodImage(context, liveSettings, resolvedCharacterName, mood)
        .then(() => {
          const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
            const copy = { ...current };
            const existing = { ...((copy.moodImages as MoodImageSet | undefined) ?? {}) };
            delete existing[mood];
            if (Object.keys(existing).length) {
              copy.moodImages = existing;
            } else {
              delete copy.moodImages;
            }
            return copy;
          });
          persistSettings(next);
          renderPanel(input, true);
        })
        .catch(error => {
          notify(error instanceof Error ? error.message : "Failed to delete image.", "error");
        });
    });
  });

  panel.querySelector<HTMLButtonElement>("[data-action='clear-all']")?.addEventListener("click", event => {
    event.preventDefault();
    const currentDefaults = getDefaults(getLiveSettings(), characterIdentity);
    const existing = (currentDefaults.moodImages as MoodImageSet | undefined) ?? {};
    const moods = Object.keys(existing)
      .map(label => normalizeMoodLabel(label))
      .filter((label): label is MoodLabel => Boolean(label));
    if (!moods.length) return;
    const liveSettings = getLiveSettings();
    Promise.allSettled(moods.map(mood => deleteMoodImage(context, liveSettings, resolvedCharacterName, mood)))
      .then(results => {
        const failed: MoodLabel[] = [];
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            failed.push(moods[index]);
          }
        });
        const next = withUpdatedDefaults(getLiveSettings(), characterIdentity, current => {
          const copy = { ...current };
          if (failed.length === 0) {
            delete copy.moodImages;
            return copy;
          }
          const existingImages = (copy.moodImages as MoodImageSet | undefined) ?? {};
          const remaining: MoodImageSet = {};
          failed.forEach(mood => {
            if (existingImages[mood]) {
              remaining[mood] = existingImages[mood];
            }
          });
          if (Object.keys(remaining).length) {
            copy.moodImages = remaining;
          } else {
            delete copy.moodImages;
          }
          return copy;
        });
        persistSettings(next);
        if (failed.length) {
          notify(`Failed to delete ${failed.length} image(s).`, "warning");
        }
        renderPanel(input, true);
      });
  });
}
