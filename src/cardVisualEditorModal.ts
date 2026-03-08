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
type PreviewViewport = "desktop" | "mobile";

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

const HISTORY_LIMIT = 80;
const BACKDROP_CLASS = "bst-card-editor-backdrop";
const MODAL_CLASS = "bst-card-editor-modal";
const COMMON_LAYER_IDS = ["root", "header", "body", "footer"] as const;
const OWNER_LAYER_IDS = ["stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"] as const;
const SCENE_LAYER_IDS = ["scene.header", "scene.body", "scene.stat.row", "scene.stat.array.container"] as const;

function getLayerIdsForType(type: CardType): readonly string[] {
  return type === "scene" ? [...COMMON_LAYER_IDS, ...SCENE_LAYER_IDS] : [...COMMON_LAYER_IDS, ...OWNER_LAYER_IDS];
}

export function shouldLiveApply(liveMode: boolean, useEditorStyling: boolean): boolean {
  return Boolean(liveMode && useEditorStyling);
}

export function pushDraftHistory(
  history: CardVisualEditorSettings[],
  snapshot: CardVisualEditorSettings,
  maxEntries = HISTORY_LIMIT,
): CardVisualEditorSettings[] {
  const next = [...history];
  const signature = JSON.stringify(snapshot);
  if (next.length > 0 && JSON.stringify(next[next.length - 1]) === signature) return next;
  next.push(snapshot);
  if (next.length > maxEntries) next.splice(0, next.length - maxEntries);
  return next;
}

export function resolvePreviewViewportWidth(mode: PreviewViewport): number {
  return mode === "mobile" ? 360 : 720;
}

export function reorderLayerIds(layerIds: readonly string[], fromId: string, toId: string): string[] {
  const list = [...layerIds];
  const fromIndex = list.indexOf(fromId);
  const toIndex = list.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return list;
}

export function moveLayerByDirection(
  layerIds: readonly string[],
  layerId: string,
  direction: "up" | "down",
): string[] {
  const list = [...layerIds];
  const index = list.indexOf(layerId);
  if (index < 0) return list;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return list;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  return list;
}

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

function resolveOverrideElements(
  draft: CardVisualEditorSettings,
  type: CardType,
): Record<string, Partial<CardVisualEditorStylePreset>> {
  const source =
    type === "character"
      ? draft.character
      : type === "user"
        ? draft.user
        : draft.scene;
  return { ...(source.elements ?? {}) };
}

function resolveOverrideLayerOrder(
  draft: CardVisualEditorSettings,
  type: CardType,
): string[] {
  const source =
    type === "character"
      ? draft.character
      : type === "user"
        ? draft.user
        : draft.scene;
  return Array.isArray(source.layerOrder) ? [...source.layerOrder] : [];
}

export function resolvePreviewLayerOrder(
  draft: CardVisualEditorSettings,
  type: CardType,
): string[] {
  const defaults = [...getLayerIdsForType(type)];
  const override = resolveOverrideLayerOrder(draft, type);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of override) {
    if (!defaults.includes(id)) continue;
    if (seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }
  for (const id of defaults) {
    if (seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }
  return merged;
}

export function resolvePreviewRootStyle(
  draft: CardVisualEditorSettings,
  type: CardType,
): CardVisualEditorStylePreset {
  const base = cloneCardStyle(draft.base);
  return { ...base.root, ...resolveOverrideRoot(draft, type) };
}

export function resolvePreviewLayerStyle(
  draft: CardVisualEditorSettings,
  type: CardType,
  layerId: string,
): CardVisualEditorStylePreset {
  const root = resolvePreviewRootStyle(draft, type);
  if (layerId === "root") return root;
  const elements = resolveOverrideElements(draft, type);
  return { ...root, ...(elements[layerId] ?? {}) };
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

function writeOverrideElement(
  draft: CardVisualEditorSettings,
  type: CardType,
  layerId: string,
  elementStyle: Partial<CardVisualEditorStylePreset>,
): void {
  const targetKey = type === "character" ? "character" : type === "user" ? "user" : "scene";
  const current = draft[targetKey] as CardVisualEditorCardStyleOverride;
  const nextElements = { ...(current.elements ?? {}) };
  nextElements[layerId] = {
    ...(nextElements[layerId] ?? {}),
    ...elementStyle,
  } as CardVisualEditorStylePreset;
  draft[targetKey] = { ...current, elements: nextElements };
}

function clearOverrideElement(
  draft: CardVisualEditorSettings,
  type: CardType,
  layerId: string,
): void {
  const targetKey = type === "character" ? "character" : type === "user" ? "user" : "scene";
  const current = draft[targetKey] as CardVisualEditorCardStyleOverride;
  const nextElements = { ...(current.elements ?? {}) };
  delete nextElements[layerId];
  draft[targetKey] = { ...current, elements: nextElements };
}

function writeOverrideLayerOrder(
  draft: CardVisualEditorSettings,
  type: CardType,
  layerOrder: string[],
): void {
  const targetKey = type === "character" ? "character" : type === "user" ? "user" : "scene";
  const current = draft[targetKey] as CardVisualEditorCardStyleOverride;
  draft[targetKey] = { ...current, layerOrder: [...layerOrder] };
}

function renderPreviewCard(
  draft: CardVisualEditorSettings,
  type: CardType,
  selectedLayerId: string,
): string {
  const root = resolvePreviewLayerStyle(draft, type, "root");
  const headerId = type === "scene" ? "scene.header" : "header";
  const bodyId = type === "scene" ? "scene.body" : "body";
  const rowId = type === "scene" ? "scene.stat.row" : "stats.numeric.row";
  const nonNumericId = type === "scene" ? "scene.stat.array.container" : "stats.nonNumeric.row";
  const header = resolvePreviewLayerStyle(draft, type, headerId);
  const body = resolvePreviewLayerStyle(draft, type, bodyId);
  const row = resolvePreviewLayerStyle(draft, type, rowId);
  const nonNumeric = resolvePreviewLayerStyle(draft, type, nonNumericId);
  const mood = resolvePreviewLayerStyle(draft, type, "mood.container");
  const thought = resolvePreviewLayerStyle(draft, type, "thought.panel");
  const orderedLayerIds = resolvePreviewLayerOrder(draft, type);
  const title = type === "character" ? "Character" : type === "user" ? "User" : "Scene";
  const valueText = type === "scene" ? "Scene Date/Time: 2026-03-08 20:00" : "Affection 58%";
  const selectedClass = (id: string): string => (selectedLayerId === id ? " is-selected" : "");
  const isLayerVisible = (layerId: string): boolean => resolvePreviewLayerStyle(draft, type, layerId).visible !== false;
  const ownerBlockMarkupByLayer: Record<string, string> = {
    "stats.numeric.row": `
      <div class="bst-card-editor-preview-section${selectedClass(bodyId)}" data-layer="${bodyId}" style="
        margin-top:${String(root.rowGap)}px;
        color:${escapeHtml(body.textColor || root.textColor || "#f1f3f8")};
        border:${String(body.borderWidth ?? 0)}px solid ${escapeHtml(body.borderColor || "transparent")};
        border-radius:${String(body.borderRadius)}px;
        padding:${String(Math.max(4, Math.round((body.padding ?? root.padding) * 0.7)))}px;">
        <div class="bst-card-editor-preview-row${selectedClass(rowId)}" data-layer="${rowId}" style="
          color:${escapeHtml(row.labelColor || root.labelColor || root.textColor || "#c7d0e0")};
          font-size:${String(row.labelFontSize || root.labelFontSize)}px;">Label</div>
        <div class="bst-card-editor-preview-row${selectedClass(rowId)}" data-layer="${rowId}" style="
          margin-top:6px;
          color:${escapeHtml(row.valueColor || root.valueColor || root.textColor || "#f1f3f8")};
          font-size:${String(row.valueFontSize || root.valueFontSize)}px;">${escapeHtml(valueText)}</div>
      </div>
    `,
    "stats.nonNumeric.row": `
      <div class="bst-card-editor-preview-chip-row${selectedClass(nonNumericId)}" data-layer="${nonNumericId}" style="
        margin-top:${String(root.sectionGap)};
        color:${escapeHtml(nonNumeric.valueColor || root.valueColor || root.textColor || "#f1f3f8")}">
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip A</span>
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip B</span>
      </div>
    `,
    "mood.container": `<div class="bst-card-editor-preview-row${selectedClass("mood.container")}" data-layer="mood.container" style="margin-top:${String(root.sectionGap)};color:${escapeHtml(mood.valueColor || root.valueColor || "#f1f3f8")}">Mood: Hopeful</div>`,
    "thought.panel": `<div class="bst-card-editor-preview-row${selectedClass("thought.panel")}" data-layer="thought.panel" style="margin-top:${String(root.rowGap)};color:${escapeHtml(thought.valueColor || root.valueColor || "#f1f3f8")}">Thought preview text...</div>`,
  };
  const sceneBlockMarkupByLayer: Record<string, string> = {
    "scene.stat.row": `
      <div class="bst-card-editor-preview-section${selectedClass(bodyId)}" data-layer="${bodyId}" style="
        margin-top:${String(root.rowGap)}px;
        color:${escapeHtml(body.textColor || root.textColor || "#f1f3f8")};
        border:${String(body.borderWidth ?? 0)}px solid ${escapeHtml(body.borderColor || "transparent")};
        border-radius:${String(body.borderRadius)}px;
        padding:${String(Math.max(4, Math.round((body.padding ?? root.padding) * 0.7)))}px;">
        <div class="bst-card-editor-preview-row${selectedClass(rowId)}" data-layer="${rowId}" style="
          color:${escapeHtml(row.labelColor || root.labelColor || root.textColor || "#c7d0e0")};
          font-size:${String(row.labelFontSize || root.labelFontSize)}px;">Label</div>
        <div class="bst-card-editor-preview-row${selectedClass(rowId)}" data-layer="${rowId}" style="
          margin-top:6px;
          color:${escapeHtml(row.valueColor || root.valueColor || root.textColor || "#f1f3f8")};
          font-size:${String(row.valueFontSize || root.valueFontSize)}px;">${escapeHtml(valueText)}</div>
      </div>
    `,
    "scene.stat.array.container": `
      <div class="bst-card-editor-preview-chip-row${selectedClass(nonNumericId)}" data-layer="${nonNumericId}" style="
        margin-top:${String(root.sectionGap)};
        color:${escapeHtml(nonNumeric.valueColor || root.valueColor || root.textColor || "#f1f3f8")}">
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip A</span>
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px;">chip B</span>
      </div>
    `,
  };
  const ownerBlocks = orderedLayerIds
    .filter(id => isLayerVisible(id))
    .filter(id => Object.prototype.hasOwnProperty.call(ownerBlockMarkupByLayer, id))
    .map(id => ownerBlockMarkupByLayer[id])
    .join("");
  const sceneBlocks = orderedLayerIds
    .filter(id => isLayerVisible(id))
    .filter(id => Object.prototype.hasOwnProperty.call(sceneBlockMarkupByLayer, id))
    .map(id => sceneBlockMarkupByLayer[id])
    .join("");
  return `
    <div class="bst-card-editor-preview-card${selectedClass("root")}" style="
      background:${escapeHtml(root.backgroundColor || "#1a2134")};
      color:${escapeHtml(root.textColor || "#f1f3f8")};
      border:${String(root.borderWidth)}px solid ${escapeHtml(root.borderColor || "#3a4966")};
      border-radius:${String(root.borderRadius)}px;
      opacity:${String(root.backgroundOpacity)};
      font-size:${String(root.fontSize)}px;
      padding:${String(root.padding)}px;
      box-shadow:${root.shadowEnabled ? `0 0 ${String(root.shadowBlur)}px ${String(root.shadowSpread)}px ${escapeHtml(root.shadowColor || "#00000044")}` : "none"};
      ${root.visible === false ? "display:none;" : ""}
      " data-layer="root">
      <div class="bst-card-editor-preview-section${selectedClass(headerId)}" data-layer="${headerId}" style="
        color:${escapeHtml(header.textColor || root.textColor || "#f1f3f8")};
        border:${String(header.borderWidth ?? 0)}px solid ${escapeHtml(header.borderColor || "transparent")};
        border-radius:${String(header.borderRadius)}px;
        padding:${String(Math.max(4, Math.round((header.padding ?? root.padding) * 0.7)))}px;">
        ${header.visible === false ? "" : `<div class="bst-card-editor-preview-title" style="font-size:${String(header.titleFontSize || root.titleFontSize)}px;">${title} Preview</div>`}
      </div>
      ${type === "scene" ? sceneBlocks : ownerBlocks}
    </div>
  `;
}

export function openCardVisualEditorModal(input: OpenCardVisualEditorModalInput): void {
  closeExisting();
  const base = sanitizeCardVisualEditorSettings(input.current, input.legacy);
  let draft = sanitizeCardVisualEditorSettings(base, input.legacy);
  let activeType: CardType = "character";
  let selectedLayerId = "root";
  let liveMode = false;
  let previewViewport: PreviewViewport = "desktop";
  let draggedLayerId: string | null = null;
  let historyStack: CardVisualEditorSettings[] = [];
  let futureStack: CardVisualEditorSettings[] = [];

  const backdrop = document.createElement("div");
  backdrop.className = BACKDROP_CLASS;
  backdrop.addEventListener("click", () => closeExisting());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  modal.tabIndex = -1;
  document.body.appendChild(modal);

  const render = (): void => {
    const root = resolvePreviewLayerStyle(draft, activeType, selectedLayerId);
    const layerIds = resolvePreviewLayerOrder(draft, activeType);
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
        <div class="bst-card-editor-preview-viewport">
          <button type="button" data-vp="desktop" class="bst-btn bst-btn-soft bst-card-editor-vp-btn ${previewViewport === "desktop" ? "is-active" : ""}">Desktop</button>
          <button type="button" data-vp="mobile" class="bst-btn bst-btn-soft bst-card-editor-vp-btn ${previewViewport === "mobile" ? "is-active" : ""}">Mobile</button>
        </div>
        <div class="bst-card-editor-toggles">
          <label class="bst-card-editor-switch">
            <input type="checkbox" data-k="useEditorStyling" ${draft.useEditorStyling ? "checked" : ""} title="Apply saved editor styles to real tracker cards. Turn off to use original styling.">
            <span class="bst-card-editor-switch-pill" aria-hidden="true"></span>
            <span class="bst-card-editor-switch-label">Use Editor Styling</span>
          </label>
          <label class="bst-card-editor-switch">
            <input type="checkbox" data-k="liveMode" ${liveMode ? "checked" : ""} title="When enabled, changes update real cards immediately (only if Use Editor Styling is on).">
            <span class="bst-card-editor-switch-pill" aria-hidden="true"></span>
            <span class="bst-card-editor-switch-label">Live mode</span>
          </label>
        </div>
        <div class="bst-card-editor-history-controls">
          <button type="button" data-act="undo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${historyStack.length === 0 ? "disabled" : ""}>Undo</button>
          <button type="button" data-act="redo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${futureStack.length === 0 ? "disabled" : ""}>Redo</button>
        </div>
      </div>
      <div class="bst-card-editor-toggle-hints">
        <div><strong>Use Editor Styling</strong>: applies saved editor styles to real cards. Turn OFF to keep original styling.</div>
        <div><strong>Live mode</strong>: applies edits instantly while editing. If OFF, edits are preview-only until <strong>Apply</strong>.</div>
      </div>
      <div class="bst-card-editor-grid">
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Preview</div>
          <div class="bst-card-editor-live-preview" style="max-width:${String(resolvePreviewViewportWidth(previewViewport))}px;">
            ${renderPreviewCard(draft, activeType, selectedLayerId)}
          </div>
        </div>
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Layers</div>
          <div class="bst-card-editor-layers">
            ${layerIds.map(layerId => `
              <div class="bst-card-editor-layer-row ${selectedLayerId === layerId ? "is-active" : ""}" data-layer-row="${escapeHtml(layerId)}">
                <button
                  type="button"
                  draggable="true"
                  class="bst-card-editor-layer-btn ${selectedLayerId === layerId ? "is-active" : ""}"
                  data-layer-pick="${escapeHtml(layerId)}"
                  data-layer-drag="${escapeHtml(layerId)}">
                  ${escapeHtml(layerId)}
                </button>
                <button type="button" class="bst-card-editor-layer-mini" data-layer-up="${escapeHtml(layerId)}" title="Move up">↑</button>
                <button type="button" class="bst-card-editor-layer-mini" data-layer-down="${escapeHtml(layerId)}" title="Move down">↓</button>
                <button type="button" class="bst-card-editor-layer-mini" data-layer-visible="${escapeHtml(layerId)}" title="Toggle visibility">
                  ${resolvePreviewLayerStyle(draft, activeType, layerId).visible === false ? "🙈" : "👁"}
                </button>
                <button type="button" class="bst-card-editor-layer-mini" data-layer-reset="${escapeHtml(layerId)}" title="Reset layer style">⟲</button>
              </div>
            `).join("")}
          </div>
          <div class="bst-card-editor-pane-title">Inspector</div>
          <div class="bst-card-editor-help">Editing layer: <code>${escapeHtml(selectedLayerId)}</code></div>
          <div class="bst-card-editor-inspector">
            <label class="bst-card-editor-switch">
              <input data-k="visible" type="checkbox" ${root.visible !== false ? "checked" : ""}>
              <span class="bst-card-editor-switch-pill" aria-hidden="true"></span>
              <span class="bst-card-editor-switch-label">Visible</span>
            </label>
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
        selectedLayerId = "root";
        render();
      });
    });
    modal.querySelectorAll("[data-vp]").forEach(node => {
      node.addEventListener("click", () => {
        previewViewport = String((node as HTMLElement).getAttribute("data-vp")) as PreviewViewport;
        render();
      });
    });
    modal.querySelectorAll("[data-layer-pick]").forEach(node => {
      node.addEventListener("click", () => {
        selectedLayerId = String((node as HTMLElement).getAttribute("data-layer-pick") || "root");
        render();
      });
    });
    modal.querySelectorAll("[data-layer-drag]").forEach(node => {
      node.addEventListener("dragstart", (event) => {
        draggedLayerId = String((node as HTMLElement).getAttribute("data-layer-drag") || "");
        (event as DragEvent).dataTransfer?.setData("text/plain", draggedLayerId);
      });
      node.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        const targetLayerId = String((node as HTMLElement).getAttribute("data-layer-drag") || "");
        const sourceLayerId = draggedLayerId || (event as DragEvent).dataTransfer?.getData("text/plain") || "";
        if (!sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return;
        captureHistory();
        const nextOrder = reorderLayerIds(layerIds, sourceLayerId, targetLayerId);
        writeOverrideLayerOrder(draft, activeType, nextOrder);
        render();
        maybeApplyLive();
      });
      node.addEventListener("dragend", () => {
        draggedLayerId = null;
      });
    });
    modal.querySelectorAll("[data-layer-up]").forEach(node => {
      node.addEventListener("click", () => {
        const layerId = String((node as HTMLElement).getAttribute("data-layer-up") || "");
        if (!layerId) return;
        captureHistory();
        const nextOrder = moveLayerByDirection(layerIds, layerId, "up");
        writeOverrideLayerOrder(draft, activeType, nextOrder);
        selectedLayerId = layerId;
        render();
        maybeApplyLive();
      });
    });
    modal.querySelectorAll("[data-layer-down]").forEach(node => {
      node.addEventListener("click", () => {
        const layerId = String((node as HTMLElement).getAttribute("data-layer-down") || "");
        if (!layerId) return;
        captureHistory();
        const nextOrder = moveLayerByDirection(layerIds, layerId, "down");
        writeOverrideLayerOrder(draft, activeType, nextOrder);
        selectedLayerId = layerId;
        render();
        maybeApplyLive();
      });
    });
    modal.querySelectorAll("[data-layer-visible]").forEach(node => {
      node.addEventListener("click", () => {
        const layerId = String((node as HTMLElement).getAttribute("data-layer-visible") || "");
        if (!layerId) return;
        captureHistory();
        const currentVisible = resolvePreviewLayerStyle(draft, activeType, layerId).visible !== false;
        if (layerId === "root") {
          writeOverrideRoot(draft, activeType, { visible: !currentVisible });
        } else {
          writeOverrideElement(draft, activeType, layerId, { visible: !currentVisible });
        }
        selectedLayerId = layerId;
        render();
        maybeApplyLive();
      });
    });
    modal.querySelectorAll("[data-layer-reset]").forEach(node => {
      node.addEventListener("click", () => {
        const layerId = String((node as HTMLElement).getAttribute("data-layer-reset") || "");
        if (!layerId || layerId === "root") return;
        captureHistory();
        clearOverrideElement(draft, activeType, layerId);
        selectedLayerId = layerId;
        render();
        maybeApplyLive();
      });
    });
    (modal.querySelector('[data-k="useEditorStyling"]') as HTMLInputElement | null)?.addEventListener("change", (event) => {
      captureHistory();
      draft.useEditorStyling = (event.target as HTMLInputElement).checked;
      render();
    });
    (modal.querySelector('[data-k="liveMode"]') as HTMLInputElement | null)?.addEventListener("change", (event) => {
      liveMode = (event.target as HTMLInputElement).checked;
      render();
    });
    (modal.querySelector('[data-k="visible"]') as HTMLInputElement | null)?.addEventListener("change", (event) => {
      captureHistory();
      const value = (event.target as HTMLInputElement).checked;
      if (selectedLayerId === "root") {
        writeOverrideRoot(draft, activeType, { visible: value });
      } else {
        writeOverrideElement(draft, activeType, selectedLayerId, { visible: value });
      }
      refreshPreview();
      maybeApplyLive();
    });

    const maybeApplyLive = (): void => {
      if (!shouldLiveApply(liveMode, draft.useEditorStyling)) return;
      const next = sanitizeCardVisualEditorSettings(draft, input.legacy);
      input.onApply(next);
    };

    const captureHistory = (): void => {
      historyStack = pushDraftHistory(historyStack, sanitizeCardVisualEditorSettings(draft, input.legacy), HISTORY_LIMIT);
      futureStack = [];
    };

    const applyUndo = (): void => {
      if (historyStack.length === 0) return;
      futureStack = pushDraftHistory(futureStack, sanitizeCardVisualEditorSettings(draft, input.legacy), HISTORY_LIMIT);
      const previous = historyStack[historyStack.length - 1];
      historyStack = historyStack.slice(0, -1);
      draft = sanitizeCardVisualEditorSettings(previous, input.legacy);
      render();
      maybeApplyLive();
    };

    const applyRedo = (): void => {
      if (futureStack.length === 0) return;
      historyStack = pushDraftHistory(historyStack, sanitizeCardVisualEditorSettings(draft, input.legacy), HISTORY_LIMIT);
      const nextDraft = futureStack[futureStack.length - 1];
      futureStack = futureStack.slice(0, -1);
      draft = sanitizeCardVisualEditorSettings(nextDraft, input.legacy);
      render();
      maybeApplyLive();
    };

    const refreshPreview = (): void => {
      const previewNode = modal.querySelector(".bst-card-editor-live-preview") as HTMLElement | null;
      if (!previewNode) return;
      previewNode.style.maxWidth = `${String(resolvePreviewViewportWidth(previewViewport))}px`;
      previewNode.innerHTML = renderPreviewCard(draft, activeType, selectedLayerId);
      previewNode.querySelectorAll("[data-layer]").forEach(node => {
        node.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectedLayerId = String((node as HTMLElement).getAttribute("data-layer") || "root");
          render();
        });
      });
    };

    const bindNumber = (
      key: keyof CardVisualEditorStylePreset,
      min: number,
      max: number,
      fallback: number,
    ): void => {
      const node = modal.querySelector(`[data-k="${String(key)}"]`) as HTMLInputElement | null;
      if (!node) return;
      node.addEventListener("input", () => {
        captureHistory();
        if (selectedLayerId === "root") {
          writeOverrideRoot(draft, activeType, { [key]: readNumber(node, fallback, min, max) });
        } else {
          writeOverrideElement(draft, activeType, selectedLayerId, { [key]: readNumber(node, fallback, min, max) });
        }
        refreshPreview();
        maybeApplyLive();
      });
    };
    const bindText = (key: keyof CardVisualEditorStylePreset): void => {
      const node = modal.querySelector(`[data-k="${String(key)}"]`) as HTMLInputElement | null;
      if (!node) return;
      node.addEventListener("input", () => {
        captureHistory();
        if (selectedLayerId === "root") {
          writeOverrideRoot(draft, activeType, { [key]: node.value.trim() });
        } else {
          writeOverrideElement(draft, activeType, selectedLayerId, { [key]: node.value.trim() });
        }
        refreshPreview();
        maybeApplyLive();
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
    refreshPreview();

    const close = (): void => closeExisting();
    (modal.querySelector('[data-act="close"]') as HTMLButtonElement | null)?.addEventListener("click", close);
    (modal.querySelector('[data-act="cancel"]') as HTMLButtonElement | null)?.addEventListener("click", close);
    (modal.querySelector('[data-act="default"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      captureHistory();
      const fresh = createDefaultCardVisualEditorSettings();
      draft.base = cloneCardStyle(fresh.base);
      draft.character = {};
      draft.user = {};
      draft.scene = {};
      selectedLayerId = "root";
      render();
      maybeApplyLive();
    });
    (modal.querySelector('[data-act="undo"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      applyUndo();
    });
    (modal.querySelector('[data-act="redo"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      applyRedo();
    });
    (modal.querySelector('[data-act="apply"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const next = sanitizeCardVisualEditorSettings(draft, input.legacy);
      input.onApply(next);
      close();
    });
    modal.onkeydown = (event) => {
      const key = event.key.toLowerCase();
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z";
      const isRedo = ((event.ctrlKey || event.metaKey) && key === "y")
        || ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "z");
      if (isUndo) {
        event.preventDefault();
        applyUndo();
      } else if (isRedo) {
        event.preventDefault();
        applyRedo();
      }
    };
    modal.focus();
  };

  render();
}
