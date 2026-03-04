import type { BetterSimTrackerSettings } from "./types";

declare const __BST_VERSION__: string;

const PANEL_ID = "bst-extension-settings-panel";
const VERSION_NODE_SELECTOR = "[data-bst-version]";
const MANIFEST_URL = "/scripts/extensions/third-party/BetterSimTracker/manifest.json";
let runtimeVersionPromise: Promise<string | null> | null = null;

const selectors = [
  "#extensions_settings2",
  "#extensions_settings",
  "#extensions-menu .extensions_settings",
  "#extensions-menu"
];

function findContainer(): HTMLElement | null {
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found instanceof HTMLElement) return found;
  }
  return null;
}

function getFallbackVersion(): string {
  return String(__BST_VERSION__ || "").trim() || "dev";
}

function getRuntimeVersion(): Promise<string | null> {
  if (runtimeVersionPromise) return runtimeVersionPromise;
  runtimeVersionPromise = (async () => {
    try {
      const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = await response.json() as { version?: unknown };
      const version = typeof payload?.version === "string" ? payload.version.trim() : "";
      return version || null;
    } catch {
      return null;
    }
  })();
  return runtimeVersionPromise;
}

function updateVersionNode(panel: HTMLElement, version: string): void {
  const node = panel.querySelector(VERSION_NODE_SELECTOR);
  if (!(node instanceof HTMLElement)) return;
  node.textContent = `v${version}`;
}

export function upsertSettingsPanel(input: {
  settings: BetterSimTrackerSettings;
  onSave: (patch: Partial<BetterSimTrackerSettings>) => void;
  onOpenModal: () => void;
}): void {
  const container = findContainer();
  if (!container) return;

  let panel = document.getElementById(PANEL_ID) as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "extension_block";
    container.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>BetterSimTracker <small data-bst-version style="font-size:0.8em; opacity:0.8; font-weight:600;">v${getFallbackVersion()}</small></b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;margin:8px 0;">
          <input id="bst-settings-enabled" type="checkbox" ${input.settings.enabled ? "checked" : ""}>
          <span>Enabled</span>
        </label>
        <button id="bst-open-settings" class="menu_button bst-open-settings-btn">
          <span class="fa-solid fa-gear" aria-hidden="true"></span>
          Open Settings
        </button>
      </div>
    </div>
  `;

  const enabled = panel.querySelector("#bst-settings-enabled");
  if (enabled instanceof HTMLInputElement) {
    enabled.addEventListener("change", () => {
      input.onSave({ enabled: enabled.checked });
    });
  }

  panel.querySelector("#bst-open-settings")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    input.onOpenModal();
  });

  void getRuntimeVersion().then(version => {
    if (!panel || !panel.isConnected || !version) return;
    updateVersionNode(panel, version);
  });
}

export function removeSettingsPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}
