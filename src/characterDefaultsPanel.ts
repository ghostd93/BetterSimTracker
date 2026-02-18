import type { BetterSimTrackerSettings, STContext } from "./types";

const PANEL_ID = "bst-character-defaults-panel";
const STYLE_ID = "bst-character-defaults-style";

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID} {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px;
  background: rgba(18,22,33,0.55);
}
#${PANEL_ID} .bst-char-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.35px;
  margin-bottom: 8px;
  text-transform: uppercase;
}
#${PANEL_ID} .bst-char-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
#${PANEL_ID} label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}
#${PANEL_ID} input {
  background: #0d1220;
  color: #f3f5f9;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 7px;
  padding: 5px;
}
#${PANEL_ID} .bst-char-note {
  margin-top: 8px;
  font-size: 11px;
  opacity: 0.82;
}
#${PANEL_ID} .bst-char-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
#${PANEL_ID} button {
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 7px;
  padding: 5px 8px;
  background: #1f2534;
  color: #fff;
  cursor: pointer;
}
`;
  document.head.appendChild(style);
}

function findPopupContainer(): HTMLElement | null {
  const popup = document.querySelector("#character_popup");
  if (!(popup instanceof HTMLElement)) return null;
  const target =
    (popup.querySelector("#character_popup_ok")?.parentElement as HTMLElement | null) ??
    (popup.querySelector(".popup-content") as HTMLElement | null) ??
    popup;
  return target;
}

function readCurrentCharacterName(): string {
  const el = document.querySelector("#character_name_pole") as HTMLInputElement | null;
  return String(el?.value ?? "").trim();
}

function getCurrentCharacterKey(context: STContext, name: string): string {
  const characters = context.characters ?? [];
  const fromSelected =
    typeof context.characterId === "number" && context.characterId >= 0
      ? characters[context.characterId]
      : undefined;
  if (fromSelected && fromSelected.name === name) {
    return fromSelected.avatar ? `avatar:${fromSelected.avatar}` : `name:${name}`;
  }

  const matches = characters.filter(character => character.name === name);
  if (matches.length === 1) {
    return matches[0].avatar ? `avatar:${matches[0].avatar}` : `name:${name}`;
  }

  return `name:${name}`;
}

type CharacterDefaults = BetterSimTrackerSettings["characterDefaults"][string];

function normalizeNumeric(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function readDefaultsFromPanel(panel: HTMLElement): CharacterDefaults {
  const read = (id: string): string =>
    String((panel.querySelector(`[data-bst="${id}"]`) as HTMLInputElement | null)?.value ?? "");
  return {
    affection: normalizeNumeric(read("affection")),
    trust: normalizeNumeric(read("trust")),
    desire: normalizeNumeric(read("desire")),
    connection: normalizeNumeric(read("connection")),
    mood: read("mood").trim() || undefined
  };
}

function setDefaultsToPanel(panel: HTMLElement, defaults: CharacterDefaults): void {
  const set = (id: string, value?: string | number): void => {
    const node = panel.querySelector(`[data-bst="${id}"]`) as HTMLInputElement | null;
    if (!node) return;
    node.value = value === undefined ? "" : String(value);
  };
  set("affection", defaults.affection);
  set("trust", defaults.trust);
  set("desire", defaults.desire);
  set("connection", defaults.connection);
  set("mood", defaults.mood);
}

function compactDefaults(defaults: CharacterDefaults): CharacterDefaults | null {
  const next: CharacterDefaults = {};
  if (typeof defaults.affection === "number") next.affection = defaults.affection;
  if (typeof defaults.trust === "number") next.trust = defaults.trust;
  if (typeof defaults.desire === "number") next.desire = defaults.desire;
  if (typeof defaults.connection === "number") next.connection = defaults.connection;
  if (typeof defaults.mood === "string" && defaults.mood.trim()) next.mood = defaults.mood.trim();
  return Object.keys(next).length ? next : null;
}

export function mountCharacterDefaultsPanel(input: {
  context: STContext;
  getSettings: () => BetterSimTrackerSettings | null;
  onSettingsUpdate: (next: BetterSimTrackerSettings) => void;
}): void {
  ensureStyle();

  const injectOrRefresh = (): void => {
    const container = findPopupContainer();
    if (!container) return;

    let panel = document.getElementById(PANEL_ID) as HTMLDivElement | null;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="bst-char-title">BetterSimTracker Character Defaults</div>
        <div class="bst-char-grid">
          <label>Affection <input data-bst="affection" type="number" min="0" max="100" placeholder="context"></label>
          <label>Trust <input data-bst="trust" type="number" min="0" max="100" placeholder="context"></label>
          <label>Desire <input data-bst="desire" type="number" min="0" max="100" placeholder="context"></label>
          <label>Connection <input data-bst="connection" type="number" min="0" max="100" placeholder="context"></label>
          <label style="grid-column:1 / -1;">Mood <input data-bst="mood" type="text" placeholder="context"></label>
        </div>
        <div class="bst-char-note">Leave fields empty to use contextual baseline.</div>
        <div class="bst-char-actions">
          <button type="button" data-bst="clear">Clear Character Defaults</button>
        </div>
      `;
      container.appendChild(panel);
    }

    const name = readCurrentCharacterName();
    const key = getCurrentCharacterKey(input.context, name);
    const settings = input.getSettings();
    if (!settings) return;
    const current = settings.characterDefaults[key] ?? settings.characterDefaults[name] ?? {};
    setDefaultsToPanel(panel, current);

    const persist = (): void => {
      const characterName = readCurrentCharacterName();
      if (!characterName) return;
      const characterKey = getCurrentCharacterKey(input.context, characterName);
      const activeSettings = input.getSettings();
      if (!activeSettings) return;
      const collected = readDefaultsFromPanel(panel!);
      const compact = compactDefaults(collected);
      const next: BetterSimTrackerSettings = {
        ...activeSettings,
        characterDefaults: { ...activeSettings.characterDefaults }
      };
      delete next.characterDefaults[characterName];
      if (!compact) {
        delete next.characterDefaults[characterKey];
      } else {
        next.characterDefaults[characterKey] = compact;
      }
      input.onSettingsUpdate(next);
    };

    if (!panel.dataset.bstBound) {
      panel.dataset.bstBound = "1";
      panel.querySelectorAll("input").forEach(node => {
        node.addEventListener("change", persist);
        node.addEventListener("input", persist);
      });
      panel.querySelector('[data-bst="clear"]')?.addEventListener("click", () => {
        panel!.querySelectorAll("input").forEach(node => {
          (node as HTMLInputElement).value = "";
        });
        persist();
      });
    }
  };

  let intervalTicks = 0;
  const timer = window.setInterval(() => {
    intervalTicks += 1;
    const popup = document.querySelector("#character_popup") as HTMLElement | null;
    const isVisible = Boolean(popup && (popup.classList.contains("open") || popup.style.display !== "none"));
    if (isVisible) {
      injectOrRefresh();
    }
    if (intervalTicks >= 120) {
      // stop after ~60s; next popup open/input events still call injectOrRefresh
      window.clearInterval(timer);
    }
  }, 500);
  injectOrRefresh();

  const nameInput = document.querySelector("#character_name_pole");
  if (nameInput instanceof HTMLInputElement) {
    nameInput.addEventListener("input", () => injectOrRefresh());
  }
}
