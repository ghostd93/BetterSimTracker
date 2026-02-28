import { moodOptions } from "./prompts";
import { logDebug } from "./settings";
import {
  type CharacterDefaultsIdentity,
  resolveCharacterDefaultsEntry,
  updateCharacterDefaultsEntry,
} from "./characterDefaults";
import { fetchExpressionSpritePaths } from "./stExpressionSprites";
import type {
  BetterSimTrackerSettings,
  CustomStatDefinition,
  CustomStatKind,
  MoodLabel,
  MoodSource,
  STContext,
} from "./types";

const PANEL_ID = "bst-persona-panel";
const DRAWER_SELECTOR = "#persona-management-button";
const DRAWER_CONTENT_SELECTOR = "#persona-management-button .drawer-content";
const DRAWER_RIGHT_COLUMN_SELECTOR = "#persona-management-button .persona_management_right_column";
const PERSONA_LIST_SELECTOR = "#user_avatar_block";
const PERSONA_NAME_SELECTOR = "#your_name";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXPRESSION_CHECK_TTL_MS = 30_000;
const expressionAvailabilityCache = new Map<string, { checkedAt: number; hasExpressions: boolean }>();
const moodLabelSet = new Set(moodOptions.map(label => label.toLowerCase()));
const moodLabels = moodOptions as MoodLabel[];

type InitInput = {
  getContext: () => STContext | null;
  getSettings: () => BetterSimTrackerSettings | null;
  setSettings: (next: BetterSimTrackerSettings) => void;
  saveSettings: (context: STContext, settings: BetterSimTrackerSettings) => void;
  onSettingsUpdated: () => void;
};

type MoodImageSet = Partial<Record<MoodLabel, string>>;

type SelectedPersona = {
  avatarId: string;
  personaName: string;
};

let initDone = false;

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

function normalizeMoodLabel(raw: string): MoodLabel | null {
  const key = raw.trim().toLowerCase();
  if (!key || !moodLabelSet.has(key)) return null;
  return moodOptions.find(label => label.toLowerCase() === key) as MoodLabel;
}

function normalizeMoodSource(raw: string): MoodSource | null {
  if (raw === "bst_images" || raw === "st_expressions") return raw;
  return null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "persona";
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getPersonaSpriteFolder(avatarId: string, personaName: string): string {
  const seed = avatarId || personaName || "persona";
  const suffix = hashString(seed).toString(36);
  return `bst_persona_${slugify(seed)}_${suffix}`;
}

function moodSpriteName(mood: MoodLabel): string {
  return `bst_mood_${slugify(mood)}`;
}

function countMoodImages(images: MoodImageSet | undefined): number {
  if (!images) return 0;
  return Object.values(images).filter(value => typeof value === "string" && value.trim()).length;
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
  folderName: string,
  settings: BetterSimTrackerSettings,
): Promise<Array<{ label?: string; path?: string }>> {
  const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(folderName)}`, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    logDebug(settings, "moodImages", "persona.sprites.get.failed", { status: response.status, folderName });
    throw new Error("Upload succeeded but sprite list could not be loaded.");
  }
  const data = await response.json();
  const list = normalizeSpriteList(data);
  logDebug(settings, "moodImages", "persona.sprites.get.ok", { folderName, count: list.length });
  return list;
}

async function uploadMoodImage(
  context: STContext,
  settings: BetterSimTrackerSettings,
  folderName: string,
  mood: MoodLabel,
  file: File,
): Promise<string> {
  const label = moodSpriteName(mood);
  const headers: Record<string, string> = {};
  if (context.csrf_token) {
    headers["X-CSRF-Token"] = context.csrf_token;
  }

  const beforeSprites = await fetchSpriteList(headers, folderName, settings).catch(() => []);
  logDebug(settings, "moodImages", "persona.sprites.upload.start", { folderName, mood, label, beforeCount: beforeSprites.length });
  const form = new FormData();
  form.append("name", folderName);
  form.append("label", label);
  form.append("spriteName", label);
  form.append("avatar", file);

  const response = await fetch("/api/sprites/upload", {
    method: "POST",
    body: form,
    headers,
  });

  if (!response.ok) {
    logDebug(settings, "moodImages", "persona.sprites.upload.failed", { status: response.status, folderName, mood, label });
    throw new Error(`Upload failed (${response.status})`);
  }

  const sprites = await fetchSpriteList(headers, folderName, settings);
  const normalizedLabel = label.toLowerCase();
  const match = sprites.find(sprite => String(sprite.label ?? "").toLowerCase() === normalizedLabel);
  if (match?.path) return match.path;

  const beforePaths = new Set(beforeSprites.map(sprite => sprite.path).filter(Boolean) as string[]);
  const added = sprites.filter(sprite => sprite.path && !beforePaths.has(sprite.path));
  if (added.length === 1 && added[0].path) return added[0].path;

  throw new Error("Upload succeeded but sprite was not found in list.");
}

async function deleteMoodImage(
  context: STContext,
  settings: BetterSimTrackerSettings,
  folderName: string,
  mood: MoodLabel,
): Promise<void> {
  const spriteName = moodSpriteName(mood);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (context.csrf_token) {
    headers["X-CSRF-Token"] = context.csrf_token;
  }
  const response = await fetch("/api/sprites/delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: folderName, label: spriteName, spriteName }),
  });

  if (!response.ok) {
    logDebug(settings, "moodImages", "persona.sprites.delete.failed", { status: response.status, folderName, mood, spriteName });
    throw new Error(`Failed to delete ${mood} image (${response.status}).`);
  }
}

async function hasExpressionSpritesForPersonaName(personaName: string): Promise<boolean> {
  const key = personaName.trim().toLowerCase();
  if (!key) return false;
  const cached = expressionAvailabilityCache.get(key);
  if (cached && Date.now() - cached.checkedAt < EXPRESSION_CHECK_TTL_MS) {
    return cached.hasExpressions;
  }
  const sprites = await fetchExpressionSpritePaths(personaName);
  const hasExpressions = sprites.length > 0;
  expressionAvailabilityCache.set(key, { checkedAt: Date.now(), hasExpressions });
  return hasExpressions;
}

function getPersonaRoot(): HTMLElement | null {
  const drawer = document.querySelector(DRAWER_SELECTOR) as HTMLElement | null;
  if (!drawer) return null;
  const content = document.querySelector(DRAWER_CONTENT_SELECTOR) as HTMLElement | null;
  if (!content || !content.classList.contains("openDrawer")) return null;
  return (document.querySelector(DRAWER_RIGHT_COLUMN_SELECTOR) as HTMLElement | null) ?? content;
}

function getSelectedPersona(context: STContext): SelectedPersona | null {
  const selected = document.querySelector(`${PERSONA_LIST_SELECTOR} .avatar-container.selected`) as HTMLElement | null;
  const avatarId = String(selected?.getAttribute("data-avatar-id") ?? "").trim();
  const headerName = String((document.querySelector(PERSONA_NAME_SELECTOR) as HTMLElement | null)?.textContent ?? "").trim();
  const selectedName = String((selected?.querySelector(".ch_name") as HTMLElement | null)?.textContent ?? "").trim();
  const personaName = headerName || selectedName || String(context.name1 ?? "").trim();
  if (!avatarId && !personaName) return null;
  return { avatarId, personaName: personaName || "User" };
}

function getPersonaIdentity(persona: SelectedPersona): CharacterDefaultsIdentity {
  const fallbackPersonaKey = persona.avatarId
    ? `persona:${persona.avatarId}`
    : `persona_name:${slugify(persona.personaName || "user")}`;
  return {
    // Keep persona-scoped defaults isolated from character defaults.
    // Always prefer avatar-key namespace (including fallback when avatar id is unavailable).
    name: null,
    avatar: fallbackPersonaKey,
  };
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

function resolveEffectiveMoodSource(settings: BetterSimTrackerSettings, defaults: Record<string, unknown>): MoodSource {
  return normalizeMoodSource(String(defaults.moodSource ?? "")) ?? normalizeMoodSource(String(settings.moodSource ?? "")) ?? "bst_images";
}

function clampStat(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeCustomStatKind(value: unknown): CustomStatKind {
  if (value === "enum_single" || value === "boolean" || value === "text_short" || value === "array") return value;
  return "numeric";
}

function normalizeCustomEnumOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeArrayItems(value: unknown, maxLength: number): string[] {
  const boundedMaxLength = Math.max(20, Math.min(200, Math.round(Number(maxLength) || 120)));
  const values = Array.isArray(value)
    ? value.map(item => String(item ?? ""))
    : (typeof value === "string" ? value.split(/\r?\n|[,;]/g) : []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const text = String(item ?? "").trim().replace(/\s+/g, " ").slice(0, boundedMaxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

function renderPersonaArrayDefaultRowHtml(id: string, value: string, maxLength: number): string {
  return `
    <div class="bst-array-default-row">
      <input type="text" data-bst-persona-custom-default-array-item="${escapeHtml(id)}" maxlength="${maxLength}" value="${escapeHtml(value)}" placeholder="Item value">
      <button type="button" class="bst-btn bst-btn-danger bst-icon-btn" data-action="persona-default-array-remove" aria-label="Remove item" title="Remove item"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    </div>
  `;
}

export function initPersonaPanel(input: InitInput): void {
  if (initDone) return;
  initDone = true;
  let renderTimer: number | null = null;
  let renderQueued = false;
  let lastRenderAt = 0;
  const RENDER_THROTTLE_MS = 120;
  const runRender = (): void => {
    renderTimer = null;
    renderQueued = false;
    lastRenderAt = Date.now();
    renderPanel(input, false);
  };
  const scheduleRender = (): void => {
    if (renderQueued) return;
    renderQueued = true;
    const elapsed = Date.now() - lastRenderAt;
    const waitMs = Math.max(0, RENDER_THROTTLE_MS - elapsed);
    renderTimer = window.setTimeout(runRender, waitMs);
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-avatar-id"],
  });

  document.addEventListener("click", event => {
    const target = event.target as Element | null;
    if (!target) return;
    if (target.closest(DRAWER_SELECTOR)) {
      scheduleRender();
    }
  }, true);

  const context = input.getContext();
  const eventSource = context?.eventSource;
  const eventTypes = context?.event_types ?? {};
  if (eventSource) {
    if (eventTypes.CHAT_CHANGED) {
      eventSource.on(eventTypes.CHAT_CHANGED, () => scheduleRender());
    }
    if (eventTypes.SETTINGS_UPDATED) {
      eventSource.on(eventTypes.SETTINGS_UPDATED, () => scheduleRender());
    }
    if (eventTypes.APP_READY) {
      eventSource.on(eventTypes.APP_READY, () => scheduleRender());
    }
  }

  scheduleRender();
}

function renderPanel(input: InitInput, force = false): void {
  const context = input.getContext();
  const settings = input.getSettings();
  const root = getPersonaRoot();
  const stalePanels = Array.from(document.querySelectorAll(`#${PANEL_ID}`)) as HTMLElement[];
  if (!context || !settings || !root) {
    stalePanels.forEach(panel => panel.remove());
    return;
  }

  let panel = root.querySelector(`#${PANEL_ID}`) as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "bst-character-panel bst-persona-panel";
    const globalSettings = root.querySelector(".persona_management_global_settings");
    if (globalSettings && globalSettings.parentElement === root) {
      root.insertBefore(panel, globalSettings);
    } else {
      root.appendChild(panel);
    }
  } else if (!force) {
    const active = document.activeElement;
    if (active && panel.contains(active)) return;
  }

  const persona = getSelectedPersona(context);
  if (!persona) {
    panel.innerHTML = `
      <div class="bst-character-title">BetterSimTracker Persona Mood</div>
      <div class="bst-character-sub">Select a persona to edit BST mood images.</div>
    `;
    return;
  }

  const identity = getPersonaIdentity(persona);
  const spriteFolder = getPersonaSpriteFolder(persona.avatarId, persona.personaName);
  const defaults = getDefaults(settings, identity);
  const moodImages = (defaults.moodImages as MoodImageSet | undefined) ?? {};
  const moodCount = countMoodImages(moodImages);
  const moodSourceOverride = normalizeMoodSource(String(defaults.moodSource ?? ""));
  const effectiveMoodSource = resolveEffectiveMoodSource(settings, defaults);
  const showBstMoodImageControls = effectiveMoodSource === "bst_images";
  const customStatDefinitions = Array.isArray(settings.customStats)
    ? settings.customStats as CustomStatDefinition[]
    : [];
  const customNumericDefaultsRaw = defaults.customStatDefaults && typeof defaults.customStatDefaults === "object"
    ? defaults.customStatDefaults as Record<string, unknown>
    : {};
  const customNonNumericDefaultsRaw = defaults.customNonNumericStatDefaults && typeof defaults.customNonNumericStatDefaults === "object"
    ? defaults.customNonNumericStatDefaults as Record<string, unknown>
    : {};
  const userCustomDefaultFieldsHtml = customStatDefinitions.map(definition => {
    if (definition.track === false || definition.trackUser === false) return "";
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
          <input type="number" min="0" max="100" step="1" data-bst-persona-custom-default-num="${escapeHtml(id)}" value="${escapeHtml(value)}" placeholder="Use stat default">
        </label>
      `;
    }
    if (kind === "enum_single") {
      const options = normalizeCustomEnumOptions(definition.enumOptions);
      const rawValue = customNonNumericDefaultsRaw[id];
      const selected = typeof rawValue === "string" && options.includes(rawValue) ? rawValue : "";
      return `
        <label>${escapeHtml(label)} Default
          <select data-bst-persona-custom-default-enum="${escapeHtml(id)}">
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
          <select data-bst-persona-custom-default-bool="${escapeHtml(id)}">
            <option value="">Use stat default</option>
            <option value="true" ${selected === "true" ? "selected" : ""}>${escapeHtml(trueLabel)}</option>
            <option value="false" ${selected === "false" ? "selected" : ""}>${escapeHtml(falseLabel)}</option>
          </select>
        </label>
      `;
    }
    if (kind === "array") {
      const maxLength = Math.max(20, Math.min(200, Math.round(Number(definition.textMaxLength) || 120)));
      const items = normalizeArrayItems(customNonNumericDefaultsRaw[id], maxLength);
      const rows = (items.length ? items : [""]).slice(0, 20);
      return `
        <div class="bst-array-default-editor" data-bst-persona-custom-default-array-editor="${escapeHtml(id)}" data-bst-max-length="${maxLength}">
          <label>${escapeHtml(label)} Default</label>
          <div class="bst-array-default-list" data-bst-persona-custom-default-array-list="${escapeHtml(id)}">
            ${rows.map(item => renderPersonaArrayDefaultRowHtml(id, item, maxLength)).join("")}
          </div>
          <div class="bst-array-default-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-icon-btn" data-action="persona-default-array-add" data-bst-persona-custom-default-array-add="${escapeHtml(id)}" aria-label="Add item" title="Add item"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            <span class="bst-editor-counter" data-bst-persona-custom-default-array-counter="${escapeHtml(id)}">${items.length}/20 items</span>
          </div>
          <textarea rows="1" style="display:none" data-bst-persona-custom-default-array="${escapeHtml(id)}" data-bst-max-length="${maxLength}" aria-hidden="true">${escapeHtml(items.join("\n"))}</textarea>
        </div>
      `;
    }
    const maxLength = Math.max(20, Math.min(200, Math.round(Number(definition.textMaxLength) || 120)));
    const rawValue = String(customNonNumericDefaultsRaw[id] ?? "").trim().replace(/\s+/g, " ");
    return `
      <label>${escapeHtml(label)} Default
        <input type="text" maxlength="${maxLength}" data-bst-persona-custom-default-text="${escapeHtml(id)}" value="${escapeHtml(rawValue)}" placeholder="Use stat default">
      </label>
    `;
  }).filter(Boolean).join("");

  const persistSettings = (next: BetterSimTrackerSettings): void => {
    input.setSettings(next);
    input.saveSettings(context, next);
    input.onSettingsUpdated();
  };

  panel.innerHTML = `
    <div class="bst-character-title">BetterSimTracker Persona Mood</div>
    <div class="bst-character-sub">Per-persona mood source and BST mood images for the user tracker card.</div>
    <div class="bst-character-help">Active persona: <strong>${escapeHtml(persona.personaName)}</strong></div>
    <div class="bst-character-help">Persona avatar key: <code>${escapeHtml(persona.avatarId || "(missing)")}</code></div>
    <div class="bst-character-divider">Mood Source Override</div>
    <div class="bst-character-grid">
      <label class="bst-character-wide">Mood Source
        <select data-bst-persona="moodSource">
          <option value="">Use global setting</option>
          <option value="bst_images" ${moodSourceOverride === "bst_images" ? "selected" : ""}>BST mood images</option>
          <option value="st_expressions" ${moodSourceOverride === "st_expressions" ? "selected" : ""}>ST expressions</option>
        </select>
      </label>
    </div>
    <div class="bst-character-help">
      Effective mood source right now: <strong>${effectiveMoodSource === "st_expressions" ? "ST expressions" : "BST mood images"}</strong>.
    </div>
    <div class="bst-character-divider">User Defaults (Persona Scoped)</div>
    <div class="bst-character-help">
      These defaults apply to the user tracker when this persona is active.
    </div>
    <div class="bst-character-grid">
      <label class="bst-character-wide">Mood Default
        <input type="text" data-bst-persona-default="mood" value="${escapeHtml(String(defaults.mood ?? ""))}" placeholder="Use stat default" ${settings.userTrackMood ? "" : "disabled"}>
      </label>
    </div>
    ${settings.userTrackMood ? "" : `<div class="bst-character-help">Mood default is unavailable because User Mood tracking is disabled.</div>`}
    ${userCustomDefaultFieldsHtml
      ? `<div class="bst-character-grid bst-character-grid-single">${userCustomDefaultFieldsHtml}</div>`
      : `<div class="bst-character-help">No user-trackable custom stats configured yet.</div>`}
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
      Switch effective mood source to BST mood images to manage per-mood image uploads for this persona.
    </div>
  `;

  const moodSourceSelect = panel.querySelector<HTMLSelectElement>('select[data-bst-persona="moodSource"]');
  const moodSourceStOption = moodSourceSelect?.querySelector('option[value="st_expressions"]') as HTMLOptionElement | null;
  if (moodSourceSelect && moodSourceStOption) {
    moodSourceStOption.disabled = true;
    moodSourceStOption.textContent = "ST expressions (checking...)";
    void hasExpressionSpritesForPersonaName(persona.personaName)
      .then(hasExpressions => {
        if (!panel?.isConnected) return;
        moodSourceStOption.disabled = !hasExpressions;
        moodSourceStOption.textContent = hasExpressions ? "ST expressions" : "ST expressions (no sprites)";
        if (!hasExpressions && moodSourceSelect.value === "st_expressions") {
          moodSourceSelect.value = "";
          const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
            const copy = { ...current };
            delete copy.moodSource;
            return copy;
          });
          persistSettings(next);
        }
      })
      .catch(() => {
        if (!panel?.isConnected) return;
        moodSourceStOption.disabled = true;
        moodSourceStOption.textContent = "ST expressions (check failed)";
      });
  }

  moodSourceSelect?.addEventListener("change", async () => {
    const value = String(moodSourceSelect.value ?? "");
    const selectedSource = normalizeMoodSource(value);
    const liveSettings = input.getSettings() ?? settings;
    const liveDefaults = getDefaults(liveSettings, identity);
    const currentMoodSource = normalizeMoodSource(String(liveDefaults.moodSource ?? "")) ?? "";
    if (selectedSource === "st_expressions") {
      const hasExpressions = await hasExpressionSpritesForPersonaName(persona.personaName);
      if (!hasExpressions) {
        moodSourceSelect.value = currentMoodSource;
        notify("This persona has no ST expression sprites. Add expressions first, then enable ST expressions.", "warning");
        return;
      }
    }
    const next = withUpdatedDefaults(liveSettings, identity, current => {
      const copy = { ...current };
      if (!selectedSource) {
        delete copy.moodSource;
      } else {
        copy.moodSource = selectedSource;
      }
      return copy;
    });
    persistSettings(next);
    renderPanel(input, true);
  });

  panel.querySelectorAll<HTMLInputElement>("[data-bst-persona-default]").forEach(node => {
    node.addEventListener("change", () => {
      const key = String(node.dataset.bstPersonaDefault ?? "").trim();
      if (!key) return;
      const value = node.value.trim();
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
        const copy = { ...current };
        if (key === "mood") {
          if (!settings.userTrackMood || !value) {
            delete copy.mood;
          } else {
            copy.mood = value.slice(0, 80);
            node.value = String(copy.mood);
          }
        }
        return copy;
      });
      persistSettings(next);
    });
  });

  panel.querySelectorAll<HTMLInputElement>("[data-bst-persona-custom-default-num]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstPersonaCustomDefaultNum ?? "").trim().toLowerCase();
      if (!id) return;
      const num = clampStat(node.value);
      node.value = num == null ? "" : String(num);
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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

  panel.querySelectorAll<HTMLSelectElement>("[data-bst-persona-custom-default-enum]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstPersonaCustomDefaultEnum ?? "").trim().toLowerCase();
      if (!id) return;
      const value = String(node.value ?? "");
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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

  panel.querySelectorAll<HTMLSelectElement>("[data-bst-persona-custom-default-bool]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstPersonaCustomDefaultBool ?? "").trim().toLowerCase();
      if (!id) return;
      const raw = String(node.value ?? "").trim().toLowerCase();
      const value = raw === "true" ? true : raw === "false" ? false : null;
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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

  panel.querySelectorAll<HTMLInputElement>("[data-bst-persona-custom-default-text]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstPersonaCustomDefaultText ?? "").trim().toLowerCase();
      if (!id) return;
      const maxLength = Math.max(20, Math.min(200, Math.round(Number(node.maxLength) || 120)));
      const value = String(node.value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
      node.value = value;
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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

  panel.querySelectorAll<HTMLElement>("[data-bst-persona-custom-default-array-editor]").forEach(editor => {
    const id = String(editor.dataset.bstPersonaCustomDefaultArrayEditor ?? "").trim().toLowerCase();
    if (!id) return;
    const maxLength = Math.max(20, Math.min(200, Math.round(Number(editor.dataset.bstMaxLength) || 120)));
    const listNode = editor.querySelector<HTMLElement>(`[data-bst-persona-custom-default-array-list="${cssEscape(id)}"]`);
    const counterNode = editor.querySelector<HTMLElement>(`[data-bst-persona-custom-default-array-counter="${cssEscape(id)}"]`);
    const addBtn = editor.querySelector<HTMLButtonElement>(`[data-bst-persona-custom-default-array-add="${cssEscape(id)}"]`);
    const hiddenNode = editor.querySelector<HTMLTextAreaElement>(`textarea[data-bst-persona-custom-default-array="${cssEscape(id)}"]`);
    if (!listNode || !counterNode || !addBtn || !hiddenNode) return;

    const getItemInputs = (): HTMLInputElement[] =>
      Array.from(listNode.querySelectorAll<HTMLInputElement>(`input[data-bst-persona-custom-default-array-item="${cssEscape(id)}"]`));

    const syncEditorUi = (): string[] => {
      const values = getItemInputs().map(inputNode => inputNode.value);
      const normalized = normalizeArrayItems(values, maxLength);
      hiddenNode.value = normalized.join("\n");
      counterNode.textContent = `${normalized.length}/20 items`;
      counterNode.setAttribute("data-state", normalized.length >= 20 ? "limit" : normalized.length >= 16 ? "warn" : "ok");
      addBtn.disabled = getItemInputs().length >= 20;
      return normalized;
    };

    const ensureAtLeastOneRow = (): void => {
      if (getItemInputs().length > 0) return;
      listNode.insertAdjacentHTML("beforeend", renderPersonaArrayDefaultRowHtml(id, "", maxLength));
    };

    addBtn.addEventListener("click", () => {
      if (getItemInputs().length >= 20) return;
      listNode.insertAdjacentHTML("beforeend", renderPersonaArrayDefaultRowHtml(id, "", maxLength));
      syncEditorUi();
    });

    listNode.addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const removeBtn = target?.closest<HTMLButtonElement>('[data-action="persona-default-array-remove"]');
      if (!removeBtn) return;
      const row = removeBtn.closest(".bst-array-default-row");
      if (!row) return;
      const inputs = getItemInputs();
      if (inputs.length <= 1) {
        const onlyInput = inputs[0];
        if (onlyInput) onlyInput.value = "";
      } else {
        row.remove();
      }
      ensureAtLeastOneRow();
      syncEditorUi();
      hiddenNode.dispatchEvent(new Event("change"));
    });

    listNode.addEventListener("input", event => {
      const target = event.target as HTMLInputElement | null;
      if (!target?.matches(`input[data-bst-persona-custom-default-array-item="${cssEscape(id)}"]`)) return;
      syncEditorUi();
    });

    listNode.addEventListener("change", event => {
      const target = event.target as HTMLInputElement | null;
      if (!target?.matches(`input[data-bst-persona-custom-default-array-item="${cssEscape(id)}"]`)) return;
      syncEditorUi();
      hiddenNode.dispatchEvent(new Event("change"));
    });

    ensureAtLeastOneRow();
    syncEditorUi();
  });

  panel.querySelectorAll<HTMLTextAreaElement>("[data-bst-persona-custom-default-array]").forEach(node => {
    node.addEventListener("change", () => {
      const id = String(node.dataset.bstPersonaCustomDefaultArray ?? "").trim().toLowerCase();
      if (!id) return;
      const maxLength = Math.max(20, Math.min(200, Math.round(Number(node.dataset.bstMaxLength) || 120)));
      const items = normalizeArrayItems(node.value, maxLength);
      node.value = items.join("\n");
      const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
        const copy = { ...current };
        const existing = copy.customNonNumericStatDefaults && typeof copy.customNonNumericStatDefaults === "object"
          ? { ...(copy.customNonNumericStatDefaults as Record<string, unknown>) }
          : {};
        if (!items.length) {
          delete existing[id];
        } else {
          existing[id] = items;
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

  panel.querySelectorAll<HTMLButtonElement>("[data-action='upload']").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const mood = String(button.dataset.mood ?? "").trim();
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
        const liveSettings = input.getSettings() ?? settings;
        notify(`Uploading ${mood} image...`, "info");
        const url = await uploadMoodImage(context, liveSettings, spriteFolder, mood, file);
        const next = withUpdatedDefaults(liveSettings, identity, current => {
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
      const liveSettings = input.getSettings() ?? settings;
      deleteMoodImage(context, liveSettings, spriteFolder, mood)
        .then(() => {
          const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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
    const liveSettings = input.getSettings() ?? settings;
    const currentDefaults = getDefaults(liveSettings, identity);
    const existing = (currentDefaults.moodImages as MoodImageSet | undefined) ?? {};
    const moods = Object.keys(existing)
      .map(label => normalizeMoodLabel(label))
      .filter((label): label is MoodLabel => Boolean(label));
    if (!moods.length) return;
    Promise.allSettled(moods.map(mood => deleteMoodImage(context, liveSettings, spriteFolder, mood)))
      .then(results => {
        const failed: MoodLabel[] = [];
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            failed.push(moods[index]);
          }
        });
        const next = withUpdatedDefaults(input.getSettings() ?? settings, identity, current => {
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
