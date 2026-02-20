import { moodOptions } from "./prompts";
import type { BetterSimTrackerSettings, MoodLabel, STContext } from "./types";

const PANEL_ID = "bst-character-panel";
const NAME_INPUT_SELECTORS = ["#character_name_pole", "#character_name", "input[name='name']"];
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
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

function normalizeMoodLabel(raw: string): MoodLabel | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (moodLabelSet.has(key)) return moodOptions.find(label => label.toLowerCase() === key) as MoodLabel;
  return null;
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

function getDefaults(settings: BetterSimTrackerSettings, name: string): Record<string, unknown> {
  return (settings.characterDefaults?.[name] as Record<string, unknown> | undefined) ?? {};
}

function withUpdatedDefaults(
  settings: BetterSimTrackerSettings,
  name: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): BetterSimTrackerSettings {
  const current = getDefaults(settings, name);
  const nextDefaults = updater(current);
  const trimmedName = name.trim();
  const nextMap = { ...(settings.characterDefaults ?? {}) };
  if (!trimmedName) return settings;
  if (Object.keys(nextDefaults).length === 0) {
    delete nextMap[trimmedName];
  } else {
    nextMap[trimmedName] = nextDefaults;
  }
  return { ...settings, characterDefaults: nextMap };
}

function clampStat(value: string): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

async function uploadMoodImage(context: STContext, characterName: string, mood: MoodLabel, file: File): Promise<string> {
  const label = `bst_mood_${slugify(mood)}`;
  const headers: Record<string, string> = {};
  if (context.csrf_token) {
    headers["X-CSRF-Token"] = context.csrf_token;
  }

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
    throw new Error(`Upload failed (${response.status})`);
  }

  const spriteListResponse = await fetch(`/api/sprites/get?name=${encodeURIComponent(characterName)}`, {
    method: "GET",
    headers
  });
  if (!spriteListResponse.ok) {
    throw new Error("Upload succeeded but sprite list could not be loaded.");
  }

  const sprites = await spriteListResponse.json() as Array<{ label?: string; path?: string }>;
  const normalizedLabel = label.toLowerCase();
  const match = sprites.find(sprite => String(sprite.label ?? "").toLowerCase() === normalizedLabel);
  if (match?.path) return match.path;

  throw new Error("Upload succeeded but sprite was not found in list.");
}

function countMoodImages(images: MoodImageSet | undefined): number {
  if (!images) return 0;
  return Object.values(images).filter(value => typeof value === "string" && value.trim()).length;
}

export function initCharacterPanel(input: InitInput): void {
  let renderTimer: number | null = null;

  const scheduleRender = (): void => {
    if (renderTimer !== null) {
      window.clearTimeout(renderTimer);
    }
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderPanel(input);
    }, 120);
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRender();
}

function renderPanel(input: InitInput): void {
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
  }

  const nameInput = findNameInput(popup);
  const nameFromInput = nameInput?.value.trim() ?? "";
  const contextCharacter = typeof context.characterId === "number"
    ? context.characters?.[context.characterId]
    : null;
  const characterName =
    nameFromInput ||
    contextCharacter?.name?.trim() ||
    context.name2?.trim() ||
    context.name1?.trim() ||
    "";
  if (!characterName) {
    panel.innerHTML = `
      <div class="bst-character-title">BetterSimTracker</div>
      <div class="bst-character-sub">Open a character to edit defaults.</div>
    `;
    return;
  }

  const defaults = getDefaults(settings, characterName);
  const moodImages = (defaults.moodImages as MoodImageSet | undefined) ?? {};
  const moodCount = countMoodImages(moodImages);
  const allSet = moodCount === moodLabels.length;
  const partialSet = moodCount > 0 && !allSet;

  panel.innerHTML = `
    <div class="bst-character-title">BetterSimTracker Defaults</div>
    <div class="bst-character-sub">Per-character defaults and mood images.</div>
    <div class="bst-character-grid">
      <label>Affection Default <input type="number" min="0" max="100" step="1" data-bst-default="affection" value="${defaults.affection ?? ""}"></label>
      <label>Trust Default <input type="number" min="0" max="100" step="1" data-bst-default="trust" value="${defaults.trust ?? ""}"></label>
      <label>Desire Default <input type="number" min="0" max="100" step="1" data-bst-default="desire" value="${defaults.desire ?? ""}"></label>
      <label>Connection Default <input type="number" min="0" max="100" step="1" data-bst-default="connection" value="${defaults.connection ?? ""}"></label>
      <label class="bst-character-wide">Mood Default <input type="text" data-bst-default="mood" value="${defaults.mood ?? ""}" placeholder="Neutral"></label>
    </div>
    <div class="bst-character-divider">Mood Images</div>
    <div class="bst-character-help">
      Upload one image per mood. All 15 must be set or the tracker will keep using emoji-only mood display.
      Max ${formatBytes(MAX_IMAGE_BYTES)} and ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}px. PNG/JPG/WebP only.
    </div>
    ${partialSet ? `<div class="bst-character-warning">Mood image set incomplete (${moodCount}/15). Add the remaining images to activate.</div>` : ""}
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
  `;

  if (nameInput && !nameInput.dataset.bstListener) {
    nameInput.dataset.bstListener = "1";
    nameInput.addEventListener("input", () => renderPanel(input));
  }

  panel.querySelectorAll<HTMLInputElement>("[data-bst-default]").forEach(node => {
    node.addEventListener("change", () => {
      const key = node.dataset.bstDefault ?? "";
      const value = node.value;
      const next = withUpdatedDefaults(settings, characterName, current => {
        const copy = { ...current };
        if (key === "mood") {
          if (!value.trim()) {
            delete copy.mood;
          } else {
            copy.mood = value.trim().slice(0, 80);
          }
        } else {
          const num = clampStat(value);
          if (num == null) {
            delete copy[key];
          } else {
            copy[key] = num;
          }
        }
        return copy;
      });
      input.setSettings(next);
      input.saveSettings(context, next);
      input.onSettingsUpdated();
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
        notify(`Uploading ${mood} image...`, "info");
        const url = await uploadMoodImage(context, characterName, mood, file);
        const next = withUpdatedDefaults(settings, characterName, current => {
          const copy = { ...current };
          const existing = (copy.moodImages as MoodImageSet | undefined) ?? {};
          copy.moodImages = { ...existing, [mood]: url };
          return copy;
        });
        input.setSettings(next);
        input.saveSettings(context, next);
        input.onSettingsUpdated();
        notify(`${mood} image saved.`, "success");
        renderPanel(input);
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
      const next = withUpdatedDefaults(settings, characterName, current => {
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
      input.setSettings(next);
      input.saveSettings(context, next);
      input.onSettingsUpdated();
      renderPanel(input);
    });
  });

  panel.querySelector<HTMLButtonElement>("[data-action='clear-all']")?.addEventListener("click", event => {
    event.preventDefault();
    const next = withUpdatedDefaults(settings, characterName, current => {
      const copy = { ...current };
      delete copy.moodImages;
      return copy;
    });
    input.setSettings(next);
    input.saveSettings(context, next);
    input.onSettingsUpdated();
    renderPanel(input);
  });
}
