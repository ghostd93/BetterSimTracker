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
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(6,10,18,0.66);z-index:10049;";
  backdrop.addEventListener("click", () => closeExisting());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  modal.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1100px,96vw);max-height:92vh;overflow:auto;background:#0b1222;border:1px solid #2f3f63;border-radius:14px;z-index:10050;padding:14px;color:#f1f3f8;";
  document.body.appendChild(modal);

  const render = (): void => {
    const root = { ...draft.base.root, ...resolveOverrideRoot(draft, activeType) };
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="font-weight:700;font-size:18px;">Visual Card Editor (Experimental)</div>
        <button type="button" data-act="close" class="bst-btn bst-close-btn" style="min-width:44px;">&times;</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
        <button type="button" data-tab="character" class="bst-btn bst-btn-soft"${activeType === "character" ? ` style="outline:1px solid #8fb4ff"` : ""}>Character</button>
        <button type="button" data-tab="user" class="bst-btn bst-btn-soft"${activeType === "user" ? ` style="outline:1px solid #8fb4ff"` : ""}>User</button>
        <button type="button" data-tab="scene" class="bst-btn bst-btn-soft"${activeType === "scene" ? ` style="outline:1px solid #8fb4ff"` : ""}>Scene</button>
        <label class="bst-check" style="margin-left:auto;"><input type="checkbox" data-k="editorEnabled" ${draft.enabled ? "checked" : ""}>Enable Visual Editor</label>
        <label class="bst-check"><input type="checkbox" data-k="useEditorStyling" ${draft.useEditorStyling ? "checked" : ""}>Use Editor Styling</label>
      </div>
      <div style="display:grid;grid-template-columns:minmax(360px,1fr) minmax(320px,420px);gap:14px;margin-top:12px;">
        <div style="border:1px solid #2f3f63;border-radius:12px;padding:10px;background:#081024;">
          <div style="font-weight:600;margin-bottom:8px;">Preview</div>
          ${renderPreviewCard(draft, activeType)}
        </div>
        <div style="border:1px solid #2f3f63;border-radius:12px;padding:10px;background:#081024;">
          <div style="font-weight:600;margin-bottom:8px;">Inspector</div>
          <div style="display:grid;gap:8px;">
            <label>Background <input data-k="backgroundColor" type="text" value="${escapeHtml(root.backgroundColor || "")}" placeholder="#1a2134 / rgb(...)"></label>
            <label>Text color <input data-k="textColor" type="text" value="${escapeHtml(root.textColor || "")}" placeholder="#f1f3f8"></label>
            <label>Border color <input data-k="borderColor" type="text" value="${escapeHtml(root.borderColor || "")}" placeholder="#3a4966"></label>
            <label>Opacity <input data-k="backgroundOpacity" type="number" min="0" max="1" step="0.01" value="${String(root.backgroundOpacity)}"></label>
            <label>Border width <input data-k="borderWidth" type="number" min="0" max="12" step="0.1" value="${String(root.borderWidth)}"></label>
            <label>Border radius <input data-k="borderRadius" type="number" min="0" max="48" value="${String(root.borderRadius)}"></label>
            <label>Font size <input data-k="fontSize" type="number" min="10" max="32" value="${String(root.fontSize)}"></label>
            <label>Title size <input data-k="titleFontSize" type="number" min="10" max="48" value="${String(root.titleFontSize)}"></label>
            <label>Padding <input data-k="padding" type="number" min="0" max="64" value="${String(root.padding)}"></label>
            <label>Row gap <input data-k="rowGap" type="number" min="0" max="64" value="${String(root.rowGap)}"></label>
            <label>Section gap <input data-k="sectionGap" type="number" min="0" max="64" value="${String(root.sectionGap)}"></label>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
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
    (modal.querySelector('[data-k="editorEnabled"]') as HTMLInputElement | null)?.addEventListener("change", (event) => {
      draft.enabled = (event.target as HTMLInputElement).checked;
      render();
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
