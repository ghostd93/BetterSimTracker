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
  return {
    name: persona.personaName,
    avatar: persona.avatarId ? `persona:${persona.avatarId}` : null,
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

export function initPersonaPanel(input: InitInput): void {
  if (initDone) return;
  initDone = true;
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

