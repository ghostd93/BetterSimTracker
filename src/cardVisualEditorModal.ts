import {
  cloneCardStyle,
  createDefaultCardVisualEditorSettings,
  sanitizeCardVisualEditorSettings,
} from "./cardVisualEditor";
import type {
  CardVisualEditorCardStyleOverride,
  CardVisualEditorSettings,
  CardVisualEditorStylePreset,
} from "./types";
import { escapeHtml } from "./ui";

type CardType = "character" | "user" | "scene";

type OpenCardVisualEditorModalInput = {
  current: CardVisualEditorSettings;
  legacy: {
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
  onApply: (next: CardVisualEditorSettings) => void;
};

const BACKDROP_CLASS = "bst-card-editor-backdrop";
const MODAL_CLASS = "bst-card-editor-modal";

function readNumber(node: HTMLInputElement, fallback: number, min: number, max: number): number {
  const parsed = Number(node.value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function closeExisting(): void {
  document.querySelector(`.${BACKDROP_CLASS}`)?.remove();
  document.querySelector(`.${MODAL_CLASS}`)?.remove();
}

function resolveOverrideRoot(
  draft: CardVisualEditorSettings,
  type: CardType,
): Partial<CardVisualEditorStylePreset> {
  const source =
    type === "character"
      ? draft.character
      : type === "user"
        ? draft.user
        : draft.scene;
  return source.root ? { ...source.root } : {};
}

export function resolvePreviewRootStyle(
  draft: CardVisualEditorSettings,
  type: CardType,
): CardVisualEditorStylePreset {
  const base = cloneCardStyle(draft.base);
  return { ...base.root, ...resolveOverrideRoot(draft, type) };
}

function writeOverrideRoot(
  draft: CardVisualEditorSettings,
  type: CardType,
  root: Partial<CardVisualEditorStylePreset>,
): void {
  const targetKey = type === "character" ? "character" : type === "user" ? "user" : "scene";
  const current = draft[targetKey] as CardVisualEditorCardStyleOverride;
  draft[targetKey] = { ...current, root: { ...(current.root ?? {}), ...root } };
}

function renderPreviewCard(
  draft: CardVisualEditorSettings,
  type: CardType,
): string {
  const root = resolvePreviewRootStyle(draft, type);
  const title = type === "character" ? "Character" : type === "user" ? "User" : "Scene";
  const valueText = type === "scene" ? "Scene Date/Time: 2026-03-08 20:00" : "Affection 58%";
  return `
    <div class="bst-card-editor-preview-card" style="
      background:${escapeHtml(root.backgroundColor || "#1a2134")};
      color:${escapeHtml(root.textColor || "#f1f3f8")};
      border:${String(root.borderWidth)}px solid ${escapeHtml(root.borderColor || "#3a4966")};
      border-radius:${String(root.borderRadius)}px;
      opacity:${String(root.backgroundOpacity)};
      font-size:${String(root.fontSize)}px;
      padding:${String(root.padding)}px;
      box-shadow:${root.shadowEnabled ? `0 0 ${String(root.shadowBlur)}px ${String(root.shadowSpread)}px ${escapeHtml(root.shadowColor || "#00000044")}` : "none"};
      ">
      <div class="bst-card-editor-preview-title" style="font-size:${String(root.titleFontSize)}px;">${title} Preview</div>
      <div class="bst-card-editor-preview-row" style="margin-top:${String(root.rowGap)}px;color:${escapeHtml(root.labelColor || root.textColor || "#c7d0e0")};font-size:${String(root.labelFontSize)}px;">Label</div>
      <div class="bst-card-editor-preview-row" style="margin-top:6px;color:${escapeHtml(root.valueColor || root.textColor || "#f1f3f8")};font-size:${String(root.valueFontSize)}px;">${escapeHtml(valueText)}</div>
      <div class="bst-card-editor-preview-chip-row" style="margin-top:${String(root.sectionGap)}px;">
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip A</span>
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip B</span>
      </div>
    </div>
  `;
}

export function openCardVisualEditorModal(input: OpenCardVisualEditorModalInput): void {
  closeExisting();
  const defaultEditor = createDefaultCardVisualEditorSettings();
  const base = sanitizeCardVisualEditorSettings(input.current, input.legacy);
  const draft = sanitizeCardVisualEditorSettings(base, input.legacy);
  let activeType: CardType = "character";

  const backdrop = document.createElement("div");
  backdrop.className = BACKDROP_CLASS;
  backdrop.addEventListener("click", () => closeExisting());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  document.body.appendChild(modal);

  const render = (): void => {
    const root = { ...draft.base.root, ...resolveOverrideRoot(draft, activeType) };
    modal.innerHTML = `
      <div class="bst-card-editor-head">
        <div class="bst-card-editor-title">Visual Card Editor (Experimental)</div>
        <button type="button" data-act="close" class="bst-btn bst-close-btn">&times;</button>
      </div>
      <div class="bst-card-editor-toolbar">
        <div class="bst-card-editor-tabs">
          <button type="button" data-tab="character" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "character" ? "is-active" : ""}">Character</button>
          <button type="button" data-tab="user" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "user" ? "is-active" : ""}">User</button>
          <button type="button" data-tab="scene" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "scene" ? "is-active" : ""}">Scene</button>
        </div>
        <div class="bst-card-editor-toggles">
          <label class="bst-check"><input type="checkbox" data-k="useEditorStyling" ${draft.useEditorStyling ? "checked" : ""}>Use Editor Styling</label>
        </div>
      </div>
      <div class="bst-card-editor-grid">
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Preview</div>
          ${renderPreviewCard(draft, activeType)}
        </div>
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Inspector</div>
          <div class="bst-card-editor-inspector">
            <label class="bst-card-editor-field">Background <input data-k="backgroundColor" type="text" value="${escapeHtml(root.backgroundColor || "")}" placeholder="#1a2134 / rgb(...)"></label>
            <label class="bst-card-editor-field">Text color <input data-k="textColor" type="text" value="${escapeHtml(root.textColor || "")}" placeholder="#f1f3f8"></label>
            <label class="bst-card-editor-field">Border color <input data-k="borderColor" type="text" value="${escapeHtml(root.borderColor || "")}" placeholder="#3a4966"></label>
            <label class="bst-card-editor-field">Opacity <input data-k="backgroundOpacity" type="number" min="0" max="1" step="0.01" value="${String(root.backgroundOpacity)}"></label>
            <label class="bst-card-editor-field">Border width <input data-k="borderWidth" type="number" min="0" max="12" step="0.1" value="${String(root.borderWidth)}"></label>
            <label class="bst-card-editor-field">Border radius <input data-k="borderRadius" type="number" min="0" max="48" value="${String(root.borderRadius)}"></label>
            <label class="bst-card-editor-field">Font size <input data-k="fontSize" type="number" min="10" max="32" value="${String(root.fontSize)}"></label>
            <label class="bst-card-editor-field">Title size <input data-k="titleFontSize" type="number" min="10" max="48" value="${String(root.titleFontSize)}"></label>
            <label class="bst-card-editor-field">Padding <input data-k="padding" type="number" min="0" max="64" value="${String(root.padding)}"></label>
            <label class="bst-card-editor-field">Row gap <input data-k="rowGap" type="number" min="0" max="64" value="${String(root.rowGap)}"></label>
            <label class="bst-card-editor-field">Section gap <input data-k="sectionGap" type="number" min="0" max="64" value="${String(root.sectionGap)}"></label>
          </div>
        </div>
      </div>
      <div class="bst-card-editor-actions">
        <button type="button" data-act="default" class="bst-btn bst-btn-soft">Default</button>
        <button type="button" data-act="cancel" class="bst-btn bst-btn-soft">Cancel</button>
        <button type="button" data-act="apply" class="bst-btn">Apply</button>
      </div>
    `;

    modal.querySelectorAll("[data-tab]").forEach(node => {
      node.addEventListener("click", () => {
        activeType = String((node as HTMLElement).getAttribute("data-tab")) as CardType;
        render();
      });
    });
    (modal.querySelector('[data-k="useEditorStyling"]') as HTMLInputElement | null)?.addEventListener("change", (event) => {
      draft.useEditorStyling = (event.target as HTMLInputElement).checked;
      render();
    });

    const bindNumber = (
      key: keyof CardVisualEditorStylePreset,
      min: number,
      max: number,
      fallback: number,
    ): void => {
      const node = modal.querySelector(`[data-k="${String(key)}"]`) as HTMLInputElement | null;
      if (!node) return;
      node.addEventListener("input", () => {
        writeOverrideRoot(draft, activeType, { [key]: readNumber(node, fallback, min, max) });
        render();
      });
    };
    const bindText = (key: keyof CardVisualEditorStylePreset): void => {
      const node = modal.querySelector(`[data-k="${String(key)}"]`) as HTMLInputElement | null;
      if (!node) return;
      node.addEventListener("input", () => {
        writeOverrideRoot(draft, activeType, { [key]: node.value.trim() });
        render();
      });
    };
    bindText("backgroundColor");
    bindText("textColor");
    bindText("borderColor");
    bindNumber("backgroundOpacity", 0, 1, root.backgroundOpacity);
    bindNumber("borderWidth", 0, 12, root.borderWidth);
    bindNumber("borderRadius", 0, 48, root.borderRadius);
    bindNumber("fontSize", 10, 32, root.fontSize);
    bindNumber("titleFontSize", 10, 48, root.titleFontSize);
    bindNumber("padding", 0, 64, root.padding);
    bindNumber("rowGap", 0, 64, root.rowGap);
    bindNumber("sectionGap", 0, 64, root.sectionGap);

    const close = (): void => closeExisting();
    (modal.querySelector('[data-act="close"]') as HTMLButtonElement | null)?.addEventListener("click", close);
    (modal.querySelector('[data-act="cancel"]') as HTMLButtonElement | null)?.addEventListener("click", close);
    (modal.querySelector('[data-act="default"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const fresh = createDefaultCardVisualEditorSettings();
      draft.base = cloneCardStyle(fresh.base);
      draft.character = {};
      draft.user = {};
      draft.scene = {};
      render();
    });
    (modal.querySelector('[data-act="apply"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const next = sanitizeCardVisualEditorSettings(draft, input.legacy);
      input.onApply(next);
      close();
    });
  };

  render();
}
