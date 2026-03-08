import {
  cloneCardStyle,
  createDefaultCardVisualEditorSettings,
  sanitizeCardVisualEditorSettings,
} from "./cardVisualEditor";
import type {
  CardVisualEditorCardStyleOverride,
  CardVisualEditorPreset,
  CardVisualEditorSettings,
  CardVisualEditorStylePreset,
} from "./types";
import { escapeHtml } from "./ui";

type CardType = "character" | "user" | "scene";
type PreviewViewport = "desktop" | "mobile";
type LayerNodeType = "container" | "leaf";
type LayerNode = {
  id: string;
  label: string;
  parentId: string | null;
  movable: boolean;
  type: LayerNodeType;
};
type LayerCatalog = {
  character: LayerNode[];
  user: LayerNode[];
  scene: LayerNode[];
};

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
  layerCatalog?: Partial<LayerCatalog>;
  onApply: (next: CardVisualEditorSettings) => void;
};

type PresetTransferPayload = {
  id?: string;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
  schemaVersion?: number;
  base?: CardVisualEditorCardStyleOverride;
  character?: CardVisualEditorCardStyleOverride;
  user?: CardVisualEditorCardStyleOverride;
  scene?: CardVisualEditorCardStyleOverride;
};

const HISTORY_LIMIT = 80;
const BACKDROP_CLASS = "bst-card-editor-backdrop";
const MODAL_CLASS = "bst-card-editor-modal";
const BASE_CHARACTER_TREE: LayerNode[] = [
  { id: "root", label: "Root", parentId: null, movable: false, type: "container" },
  { id: "header", label: "Header", parentId: "root", movable: false, type: "container" },
  { id: "body", label: "Body", parentId: "root", movable: false, type: "container" },
  { id: "footer", label: "Footer", parentId: "root", movable: false, type: "container" },
  { id: "stats.numeric.row", label: "Numeric stats", parentId: "body", movable: false, type: "container" },
  { id: "stats.nonNumeric.row", label: "Custom stats", parentId: "body", movable: false, type: "container" },
  { id: "mood.container", label: "Mood", parentId: "body", movable: false, type: "container" },
  { id: "thought.panel", label: "Thought", parentId: "body", movable: false, type: "container" },
];
const BASE_SCENE_TREE: LayerNode[] = [
  { id: "root", label: "Root", parentId: null, movable: false, type: "container" },
  { id: "scene.header", label: "Header", parentId: "root", movable: false, type: "container" },
  { id: "scene.body", label: "Body", parentId: "root", movable: false, type: "container" },
  { id: "scene.footer", label: "Footer", parentId: "root", movable: false, type: "container" },
  { id: "scene.stat.row", label: "Scene stats", parentId: "scene.body", movable: false, type: "container" },
  { id: "scene.stat.array.container", label: "Scene array stats", parentId: "scene.body", movable: false, type: "container" },
];
const LEGACY_DEFAULT_LAYER_IDS: Record<CardType, readonly string[]> = {
  character: ["root", "header", "body", "footer", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"],
  user: ["root", "header", "body", "footer", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"],
  scene: ["root", "scene.header", "scene.body", "scene.footer", "scene.stat.row", "scene.stat.array.container"],
};

function normalizeLayerNode(input: LayerNode): LayerNode {
  return {
    id: String(input.id ?? "").trim(),
    label: String(input.label ?? "").trim() || String(input.id ?? "").trim(),
    parentId: input.parentId ? String(input.parentId).trim() : null,
    movable: Boolean(input.movable),
    type: input.type === "leaf" ? "leaf" : "container",
  };
}

function dedupeLayerNodes(nodes: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const normalized = normalizeLayerNode(node);
    if (!normalized.id || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

function buildLayerCatalog(input?: Partial<LayerCatalog>): LayerCatalog {
  const character = dedupeLayerNodes([...BASE_CHARACTER_TREE, ...(input?.character ?? [])]);
  const user = dedupeLayerNodes([...BASE_CHARACTER_TREE, ...(input?.user ?? [])]);
  const scene = dedupeLayerNodes([...BASE_SCENE_TREE, ...(input?.scene ?? [])]);
  return { character, user, scene };
}

function getLayerNodesForType(catalog: LayerCatalog, type: CardType): LayerNode[] {
  return type === "scene" ? [...catalog.scene] : type === "user" ? [...catalog.user] : [...catalog.character];
}

function getLayerIdsForType(catalog: LayerCatalog, type: CardType): readonly string[] {
  return getLayerNodesForType(catalog, type).map(node => node.id);
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

export function toPresetId(name: string): string {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "preset";
}

export function parsePresetTransferPayload(input: string): PresetTransferPayload | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const payload: PresetTransferPayload = {};
    if (typeof obj.id === "string") payload.id = obj.id.trim();
    if (typeof obj.name === "string") payload.name = obj.name.trim();
    if (typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)) payload.createdAt = obj.createdAt;
    if (typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)) payload.updatedAt = obj.updatedAt;
    if (typeof obj.schemaVersion === "number" && Number.isFinite(obj.schemaVersion)) payload.schemaVersion = obj.schemaVersion;
    if (obj.base && typeof obj.base === "object") payload.base = obj.base as CardVisualEditorCardStyleOverride;
    if (obj.character && typeof obj.character === "object") payload.character = obj.character as CardVisualEditorCardStyleOverride;
    if (obj.user && typeof obj.user === "object") payload.user = obj.user as CardVisualEditorCardStyleOverride;
    if (obj.scene && typeof obj.scene === "object") payload.scene = obj.scene as CardVisualEditorCardStyleOverride;
    if (!payload.name && !payload.id) return null;
    return payload;
  } catch {
    return null;
  }
}

function cloneCardOverride(
  source: CardVisualEditorCardStyleOverride | undefined,
): CardVisualEditorCardStyleOverride {
  if (!source) return {};
  return {
    motionEnabled: source.motionEnabled,
    motionIntensity: source.motionIntensity,
    root: source.root ? { ...source.root } : undefined,
    elements: source.elements
      ? Object.fromEntries(Object.entries(source.elements).map(([key, value]) => [key, { ...value }]))
      : undefined,
    layerOrder: Array.isArray(source.layerOrder) ? [...source.layerOrder] : undefined,
  };
}

function buildPresetSnapshot(
  draft: CardVisualEditorSettings,
  id: string,
  name: string,
  previous?: CardVisualEditorPreset,
): CardVisualEditorPreset {
  const now = Date.now();
  return {
    id,
    name,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    schemaVersion: draft.schemaVersion,
    base: cloneCardOverride(draft.base),
    character: cloneCardOverride(draft.character),
    user: cloneCardOverride(draft.user),
    scene: cloneCardOverride(draft.scene),
  };
}

export function applyPresetToDraft(
  draft: CardVisualEditorSettings,
  preset: CardVisualEditorPreset,
): CardVisualEditorSettings {
  const next = sanitizeCardVisualEditorSettings(draft, {
    accentColor: "",
    userCardColor: "",
    sceneCardColor: "",
    sceneCardValueColor: "",
    cardOpacity: draft.base.root.backgroundOpacity,
    borderRadius: draft.base.root.borderRadius,
    fontSize: draft.base.root.fontSize,
    sceneCardLayout: "chips",
    sceneCardArrayCollapsedLimit: draft.base.root.arrayCollapsedLimit,
  });
  next.base = cloneCardStyle({
    motionEnabled: preset.base.motionEnabled ?? next.base.motionEnabled,
    motionIntensity: preset.base.motionIntensity ?? next.base.motionIntensity,
    root: { ...next.base.root, ...(preset.base.root ?? {}) },
    elements: Object.fromEntries(
      Object.entries(preset.base.elements ?? {}).map(([key, value]) => [key, { ...next.base.root, ...value }]),
    ) as Record<string, CardVisualEditorStylePreset>,
    layerOrder: Array.isArray(preset.base.layerOrder) ? [...preset.base.layerOrder] : undefined,
  });
  next.character = cloneCardOverride(preset.character);
  next.user = cloneCardOverride(preset.user);
  next.scene = cloneCardOverride(preset.scene);
  const hasPreset = next.presets.some(row => row.id === preset.id);
  if (!hasPreset) {
    next.presets = [...next.presets, buildPresetSnapshot(next, preset.id, preset.name, preset)];
  }
  next.activePresetId = preset.id;
  return sanitizeCardVisualEditorSettings(next, {
    accentColor: "",
    userCardColor: "",
    sceneCardColor: "",
    sceneCardValueColor: "",
    cardOpacity: next.base.root.backgroundOpacity,
    borderRadius: next.base.root.borderRadius,
    fontSize: next.base.root.fontSize,
    sceneCardLayout: "chips",
    sceneCardArrayCollapsedLimit: next.base.root.arrayCollapsedLimit,
  });
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

const ROOT_INSPECTOR_KEYS: Array<keyof CardVisualEditorStylePreset> = [
  "visible",
  "backgroundColor",
  "textColor",
  "borderColor",
  "backgroundOpacity",
  "borderWidth",
  "borderRadius",
  "fontSize",
  "titleFontSize",
  "padding",
  "rowGap",
  "sectionGap",
];

const CONTENT_INSPECTOR_KEYS: Array<keyof CardVisualEditorStylePreset> = [
  "visible",
  "textColor",
  "labelColor",
  "valueColor",
  "borderColor",
  "borderWidth",
  "borderRadius",
  "labelFontSize",
  "valueFontSize",
  "padding",
  "rowGap",
  "sectionGap",
];

export function isLayerMovable(layerId: string): boolean {
  return !new Set(["root", "header", "body", "footer", "scene.header", "scene.body", "scene.footer", "scene.stat.row", "scene.stat.array.container", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"]).has(layerId);
}

function getLayerNodeById(nodes: LayerNode[]): Map<string, LayerNode> {
  return new Map(nodes.map(node => [node.id, node]));
}

function isLayerNodeMovable(nodeById: Map<string, LayerNode>, layerId: string): boolean {
  const node = nodeById.get(layerId);
  return Boolean(node?.movable);
}

function getOrderedMovableLayerIds(
  draft: CardVisualEditorSettings,
  type: CardType,
  nodes: LayerNode[],
): string[] {
  const movableDefaults = nodes.filter(node => node.movable).map(node => node.id);
  return resolvePreviewLayerOrder(draft, type, movableDefaults);
}

function renderLayerTree(
  nodes: LayerNode[],
  orderedMovable: string[],
  selectedLayerId: string,
  draft: CardVisualEditorSettings,
  activeType: CardType,
): string {
  const childrenMap = new Map<string, LayerNode[]>();
  for (const node of nodes) {
    const parentKey = node.parentId ?? "__root__";
    const list = childrenMap.get(parentKey) ?? [];
    list.push(node);
    childrenMap.set(parentKey, list);
  }
  const defaultIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const movableOrder = new Map(orderedMovable.map((id, index) => [id, index]));
  const renderBranch = (parentId: string | null, depth: number): string => {
    const key = parentId ?? "__root__";
    const children = [...(childrenMap.get(key) ?? [])].sort((a, b) => {
      const ai = movableOrder.get(a.id);
      const bi = movableOrder.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      return (defaultIndex.get(a.id) ?? 0) - (defaultIndex.get(b.id) ?? 0);
    });
    return children.map(node => `
      <div class="bst-card-editor-layer-row ${selectedLayerId === node.id ? "is-active" : ""}" data-layer-row="${escapeHtml(node.id)}" style="--bst-layer-depth:${String(depth)};">
        <button
          type="button"
          draggable="${node.movable ? "true" : "false"}"
          class="bst-card-editor-layer-btn ${selectedLayerId === node.id ? "is-active" : ""}"
          data-layer-pick="${escapeHtml(node.id)}"
          data-layer-drag="${escapeHtml(node.id)}">
          ${escapeHtml(node.label)} <span class="bst-card-editor-layer-id">${escapeHtml(node.id)}</span>
        </button>
        <button type="button" class="bst-card-editor-layer-mini" data-layer-up="${escapeHtml(node.id)}" title="Move up" ${node.movable ? "" : "disabled"}>&uarr;</button>
        <button type="button" class="bst-card-editor-layer-mini" data-layer-down="${escapeHtml(node.id)}" title="Move down" ${node.movable ? "" : "disabled"}>&darr;</button>
        <button type="button" class="bst-card-editor-layer-mini" data-layer-visible="${escapeHtml(node.id)}" title="Toggle visibility">
          ${resolvePreviewLayerStyle(draft, activeType, node.id).visible === false ? "Hidden" : "Shown"}
        </button>
        <button type="button" class="bst-card-editor-layer-mini" data-layer-reset="${escapeHtml(node.id)}" title="Reset layer style" ${node.id === "root" ? "disabled" : ""}>Reset</button>
      </div>
      ${renderBranch(node.id, depth + 1)}
    `).join("");
  };
  return renderBranch(null, 0);
}

function resolveInspectorKeys(
  layerId: string,
  nodeById: Map<string, LayerNode>,
): Array<keyof CardVisualEditorStylePreset> {
  if (layerId === "root") return ROOT_INSPECTOR_KEYS;
  const node = nodeById.get(layerId);
  if (!node) return CONTENT_INSPECTOR_KEYS;
  if (node.type === "container") {
    if (layerId.includes("header")) {
      return ["visible", "backgroundColor", "textColor", "borderColor", "backgroundOpacity", "borderWidth", "borderRadius", "titleFontSize", "padding", "rowGap", "sectionGap"];
    }
    return ["visible", "backgroundColor", "textColor", "borderColor", "backgroundOpacity", "borderWidth", "borderRadius", "padding", "rowGap", "sectionGap"];
  }
  if (layerId.includes("mood")) {
    return ["visible", "textColor", "valueColor", "borderColor", "borderWidth", "borderRadius", "valueFontSize", "padding", "rowGap"];
  }
  if (layerId.includes("thought")) {
    return ["visible", "textColor", "valueColor", "borderColor", "backgroundColor", "backgroundOpacity", "borderWidth", "borderRadius", "valueFontSize", "padding"];
  }
  return ["visible", "textColor", "labelColor", "valueColor", "borderColor", "backgroundColor", "backgroundOpacity", "borderWidth", "borderRadius", "labelFontSize", "valueFontSize", "padding", "rowGap"];
}

function shouldShowInspectorField(
  key: keyof CardVisualEditorStylePreset,
  inspectorKeys: Array<keyof CardVisualEditorStylePreset>,
): boolean {
  return inspectorKeys.includes(key);
}

function moveLayerByDirectionWithinSiblings(
  layerIds: readonly string[],
  nodeById: Map<string, LayerNode>,
  layerId: string,
  direction: "up" | "down",
): string[] {
  const node = nodeById.get(layerId);
  if (!node?.movable) return [...layerIds];
  const siblingIds = layerIds.filter(id => nodeById.get(id)?.parentId === node.parentId && nodeById.get(id)?.movable);
  const siblingIndex = siblingIds.indexOf(layerId);
  if (siblingIndex < 0) return [...layerIds];
  const targetSiblingIndex = direction === "up" ? siblingIndex - 1 : siblingIndex + 1;
  if (targetSiblingIndex < 0 || targetSiblingIndex >= siblingIds.length) return [...layerIds];
  const targetId = siblingIds[targetSiblingIndex];
  return reorderLayerIds(layerIds, layerId, targetId);
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
  layerIds?: readonly string[],
): string[] {
  const defaults = [...(layerIds ?? LEGACY_DEFAULT_LAYER_IDS[type])];
  if (!defaults.length) return [];
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
  layerIds: readonly string[],
  layerLabelById: Record<string, string>,
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
  const orderedLayerIds = resolvePreviewLayerOrder(draft, type, layerIds);
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
          font-size:${String(row.labelFontSize || root.labelFontSize)}px;">${escapeHtml(layerLabelById[rowId] || "Label")}</div>
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
  for (const layerId of layerIds) {
    if (ownerBlockMarkupByLayer[layerId]) continue;
    if (layerId === "root" || layerId === headerId || layerId === bodyId || layerId === "footer") continue;
    const layerStyle = resolvePreviewLayerStyle(draft, type, layerId);
    ownerBlockMarkupByLayer[layerId] = `
      <div class="bst-card-editor-preview-row${selectedClass(layerId)}" data-layer="${layerId}" style="
        margin-top:${String(root.rowGap)};
        color:${escapeHtml(layerStyle.valueColor || layerStyle.textColor || root.valueColor || root.textColor || "#f1f3f8")};
        border:${String(layerStyle.borderWidth ?? 0)}px solid ${escapeHtml(layerStyle.borderColor || "transparent")};
        border-radius:${String(layerStyle.borderRadius ?? root.borderRadius)};
        padding:${String(Math.max(2, Math.round((layerStyle.padding ?? root.padding) * 0.5)))}px;
        ${layerStyle.visible === false ? "display:none;" : ""}
      ">
        ${escapeHtml(layerLabelById[layerId] || layerId)} preview
      </div>
    `;
  }
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
          font-size:${String(row.labelFontSize || root.labelFontSize)}px;">${escapeHtml(layerLabelById[rowId] || "Label")}</div>
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
  for (const layerId of layerIds) {
    if (sceneBlockMarkupByLayer[layerId]) continue;
    if (layerId === "root" || layerId === headerId || layerId === bodyId || layerId === "scene.footer") continue;
    const layerStyle = resolvePreviewLayerStyle(draft, type, layerId);
    sceneBlockMarkupByLayer[layerId] = `
      <div class="bst-card-editor-preview-row${selectedClass(layerId)}" data-layer="${layerId}" style="
        margin-top:${String(root.rowGap)};
        color:${escapeHtml(layerStyle.valueColor || layerStyle.textColor || root.valueColor || root.textColor || "#f1f3f8")};
        border:${String(layerStyle.borderWidth ?? 0)}px solid ${escapeHtml(layerStyle.borderColor || "transparent")};
        border-radius:${String(layerStyle.borderRadius ?? root.borderRadius)};
        padding:${String(Math.max(2, Math.round((layerStyle.padding ?? root.padding) * 0.5)))}px;
        ${layerStyle.visible === false ? "display:none;" : ""}
      ">
        ${escapeHtml(layerLabelById[layerId] || layerId)} preview
      </div>
    `;
  }
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
  let selectedPresetId = draft.activePresetId || "";
  let presetNameDraft = "";
  let presetTransferMode: "none" | "import" | "export" = "none";
  let presetTransferText = "";
  let presetTransferError = "";
  let draggedLayerId: string | null = null;
  let historyStack: CardVisualEditorSettings[] = [];
  let futureStack: CardVisualEditorSettings[] = [];
  const layerCatalog = buildLayerCatalog(input.layerCatalog);

  const backdrop = document.createElement("div");
  backdrop.className = BACKDROP_CLASS;
  backdrop.addEventListener("click", () => closeExisting());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  modal.tabIndex = -1;
  document.body.appendChild(modal);

  const render = (): void => {
    const nodes = getLayerNodesForType(layerCatalog, activeType);
    const nodeById = getLayerNodeById(nodes);
    const layerIds = getOrderedMovableLayerIds(draft, activeType, nodes);
    const layerLabelById = Object.fromEntries(nodes.map(node => [node.id, node.label])) as Record<string, string>;
    if (!nodeById.has(selectedLayerId)) {
      selectedLayerId = "root";
    }
    const root = resolvePreviewLayerStyle(draft, activeType, selectedLayerId);
    const inspectorKeys = resolveInspectorKeys(selectedLayerId, nodeById);
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
          <select data-k="presetSelect" class="bst-input bst-card-editor-preset-select">
            <option value="">Preset: none</option>
            ${draft.presets.map(preset => `
              <option value="${escapeHtml(preset.id)}" ${selectedPresetId === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>
            `).join("")}
          </select>
          <input data-k="presetName" class="bst-input bst-card-editor-preset-name" type="text" maxlength="80" value="${escapeHtml(presetNameDraft)}" placeholder="Preset name">
          <button type="button" data-act="preset-save" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Save current style as preset">Save preset</button>
          <button type="button" data-act="preset-load" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${selectedPresetId ? "" : "disabled"} title="Load selected preset">Load</button>
          <button type="button" data-act="preset-delete" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${selectedPresetId ? "" : "disabled"} title="Delete selected preset">Delete</button>
          <button type="button" data-act="preset-export" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${selectedPresetId ? "" : "disabled"} title="Export selected preset as JSON">Export</button>
          <button type="button" data-act="preset-import" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Import preset from JSON">Import</button>
          <button type="button" data-act="undo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${historyStack.length === 0 ? "disabled" : ""}>Undo</button>
          <button type="button" data-act="redo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${futureStack.length === 0 ? "disabled" : ""}>Redo</button>
        </div>
      </div>
      <div class="bst-card-editor-toggle-hints">
        <div><strong>Use Editor Styling</strong>: applies saved editor styles to real cards. Turn OFF to keep original styling.</div>
        <div><strong>Live mode</strong>: applies edits instantly while editing. If OFF, edits are preview-only until <strong>Apply</strong>.</div>
      </div>
      ${presetTransferMode === "none" ? "" : `
        <div class="bst-card-editor-transfer-panel">
          <div class="bst-card-editor-transfer-head">
            <strong>${presetTransferMode === "export" ? "Preset Export" : "Preset Import"}</strong>
          </div>
          <textarea data-k="presetTransferText" rows="7" placeholder="${presetTransferMode === "export" ? "" : "Paste preset JSON here..."}">${escapeHtml(presetTransferText)}</textarea>
          ${presetTransferError ? `<div class="bst-card-editor-transfer-error">${escapeHtml(presetTransferError)}</div>` : ""}
          <div class="bst-card-editor-transfer-actions">
            ${presetTransferMode === "import" ? `<button type="button" data-act="preset-import-apply" class="bst-btn">Import Preset</button>` : ""}
            <button type="button" data-act="preset-transfer-close" class="bst-btn bst-btn-soft">Close</button>
          </div>
        </div>
      `}
      <div class="bst-card-editor-grid">
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Preview</div>
          <div class="bst-card-editor-live-preview" style="max-width:${String(resolvePreviewViewportWidth(previewViewport))}px;">
            ${renderPreviewCard(draft, activeType, selectedLayerId, getLayerIdsForType(layerCatalog, activeType), layerLabelById)}
          </div>
          <div class="bst-card-editor-pane-title">Inspector</div>
          <div class="bst-card-editor-help">Editing layer: <code>${escapeHtml(selectedLayerId)}</code></div>
          <div class="bst-card-editor-inspector">
            ${shouldShowInspectorField("visible", inspectorKeys) ? `
              <label class="bst-card-editor-switch">
                <input data-k="visible" type="checkbox" ${root.visible !== false ? "checked" : ""}>
                <span class="bst-card-editor-switch-pill" aria-hidden="true"></span>
                <span class="bst-card-editor-switch-label">Visible</span>
              </label>
            ` : ""}
            ${shouldShowInspectorField("backgroundColor", inspectorKeys) ? `<label class="bst-card-editor-field">Background <input data-k="backgroundColor" type="text" value="${escapeHtml(root.backgroundColor || "")}" placeholder="#1a2134 / rgb(...)"></label>` : ""}
            ${shouldShowInspectorField("textColor", inspectorKeys) ? `<label class="bst-card-editor-field">Text color <input data-k="textColor" type="text" value="${escapeHtml(root.textColor || "")}" placeholder="#f1f3f8"></label>` : ""}
            ${shouldShowInspectorField("labelColor", inspectorKeys) ? `<label class="bst-card-editor-field">Label color <input data-k="labelColor" type="text" value="${escapeHtml(root.labelColor || "")}" placeholder="#c7d0e0"></label>` : ""}
            ${shouldShowInspectorField("valueColor", inspectorKeys) ? `<label class="bst-card-editor-field">Value color <input data-k="valueColor" type="text" value="${escapeHtml(root.valueColor || "")}" placeholder="#f1f3f8"></label>` : ""}
            ${shouldShowInspectorField("borderColor", inspectorKeys) ? `<label class="bst-card-editor-field">Border color <input data-k="borderColor" type="text" value="${escapeHtml(root.borderColor || "")}" placeholder="#3a4966"></label>` : ""}
            ${shouldShowInspectorField("backgroundOpacity", inspectorKeys) ? `<label class="bst-card-editor-field">Opacity <input data-k="backgroundOpacity" type="number" min="0" max="1" step="0.01" value="${String(root.backgroundOpacity)}"></label>` : ""}
            ${shouldShowInspectorField("borderWidth", inspectorKeys) ? `<label class="bst-card-editor-field">Border width <input data-k="borderWidth" type="number" min="0" max="12" step="0.1" value="${String(root.borderWidth)}"></label>` : ""}
            ${shouldShowInspectorField("borderRadius", inspectorKeys) ? `<label class="bst-card-editor-field">Border radius <input data-k="borderRadius" type="number" min="0" max="48" value="${String(root.borderRadius)}"></label>` : ""}
            ${shouldShowInspectorField("fontSize", inspectorKeys) ? `<label class="bst-card-editor-field">Font size <input data-k="fontSize" type="number" min="10" max="32" value="${String(root.fontSize)}"></label>` : ""}
            ${shouldShowInspectorField("titleFontSize", inspectorKeys) ? `<label class="bst-card-editor-field">Title size <input data-k="titleFontSize" type="number" min="10" max="48" value="${String(root.titleFontSize)}"></label>` : ""}
            ${shouldShowInspectorField("labelFontSize", inspectorKeys) ? `<label class="bst-card-editor-field">Label size <input data-k="labelFontSize" type="number" min="10" max="48" value="${String(root.labelFontSize)}"></label>` : ""}
            ${shouldShowInspectorField("valueFontSize", inspectorKeys) ? `<label class="bst-card-editor-field">Value size <input data-k="valueFontSize" type="number" min="10" max="48" value="${String(root.valueFontSize)}"></label>` : ""}
            ${shouldShowInspectorField("padding", inspectorKeys) ? `<label class="bst-card-editor-field">Padding <input data-k="padding" type="number" min="0" max="64" value="${String(root.padding)}"></label>` : ""}
            ${shouldShowInspectorField("rowGap", inspectorKeys) ? `<label class="bst-card-editor-field">Row gap <input data-k="rowGap" type="number" min="0" max="64" value="${String(root.rowGap)}"></label>` : ""}
            ${shouldShowInspectorField("sectionGap", inspectorKeys) ? `<label class="bst-card-editor-field">Section gap <input data-k="sectionGap" type="number" min="0" max="64" value="${String(root.sectionGap)}"></label>` : ""}
          </div>
        </div>
        <div class="bst-card-editor-pane">
          <div class="bst-card-editor-pane-title">Layers</div>
          <div class="bst-card-editor-layers">
            ${renderLayerTree(nodes, layerIds, selectedLayerId, draft, activeType)}
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
        if (!isLayerMovable(draggedLayerId)) {
          event.preventDefault();
          draggedLayerId = null;
          return;
        }
        const transfer = (event as DragEvent).dataTransfer;
        transfer?.setData("text/plain", draggedLayerId);
        if (transfer) transfer.effectAllowed = "move";
      });
      node.addEventListener("dragover", (event) => {
        event.preventDefault();
        const transfer = (event as DragEvent).dataTransfer;
        if (transfer) transfer.dropEffect = "move";
      });
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        const targetLayerId = String((node as HTMLElement).getAttribute("data-layer-drag") || "");
        const sourceLayerId = draggedLayerId || (event as DragEvent).dataTransfer?.getData("text/plain") || "";
        if (!isLayerMovable(sourceLayerId)) return;
        if (!sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return;
        const sourceNode = nodeById.get(sourceLayerId);
        const targetNode = nodeById.get(targetLayerId);
        if (!sourceNode || !targetNode) return;
        if (sourceNode.parentId !== targetNode.parentId) return;
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
        const nextOrder = moveLayerByDirectionWithinSiblings(layerIds, nodeById, layerId, "up");
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
        const nextOrder = moveLayerByDirectionWithinSiblings(layerIds, nodeById, layerId, "down");
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
    (modal.querySelector('[data-k="presetSelect"]') as HTMLSelectElement | null)?.addEventListener("change", (event) => {
      selectedPresetId = String((event.target as HTMLSelectElement).value || "");
      render();
    });
    (modal.querySelector('[data-k="presetName"]') as HTMLInputElement | null)?.addEventListener("input", (event) => {
      presetNameDraft = String((event.target as HTMLInputElement).value || "");
    });
    (modal.querySelector('[data-k="presetTransferText"]') as HTMLTextAreaElement | null)?.addEventListener("input", (event) => {
      presetTransferText = String((event.target as HTMLTextAreaElement).value || "");
      presetTransferError = "";
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
      previewNode.innerHTML = renderPreviewCard(draft, activeType, selectedLayerId, getLayerIdsForType(layerCatalog, activeType), layerLabelById);
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
    bindText("labelColor");
    bindText("valueColor");
    bindText("borderColor");
    bindNumber("backgroundOpacity", 0, 1, root.backgroundOpacity);
    bindNumber("borderWidth", 0, 12, root.borderWidth);
    bindNumber("borderRadius", 0, 48, root.borderRadius);
    bindNumber("fontSize", 10, 32, root.fontSize);
    bindNumber("titleFontSize", 10, 48, root.titleFontSize);
    bindNumber("labelFontSize", 10, 48, root.labelFontSize);
    bindNumber("valueFontSize", 10, 48, root.valueFontSize);
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
    (modal.querySelector('[data-act="preset-save"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const name = presetNameDraft.trim();
      if (!name) return;
      captureHistory();
      const id = toPresetId(name);
      const previous = draft.presets.find(preset => preset.id === id);
      const nextPreset = buildPresetSnapshot(draft, id, name, previous);
      const nextPresets = [...draft.presets.filter(preset => preset.id !== id), nextPreset]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      draft.presets = nextPresets;
      draft.activePresetId = id;
      selectedPresetId = id;
      presetNameDraft = "";
      render();
      maybeApplyLive();
    });
    (modal.querySelector('[data-act="preset-load"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      if (!selectedPresetId) return;
      const preset = draft.presets.find(row => row.id === selectedPresetId);
      if (!preset) return;
      captureHistory();
      draft = applyPresetToDraft(draft, preset);
      render();
      maybeApplyLive();
    });
    (modal.querySelector('[data-act="preset-delete"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      if (!selectedPresetId) return;
      captureHistory();
      draft.presets = draft.presets.filter(preset => preset.id !== selectedPresetId);
      if (draft.activePresetId === selectedPresetId) draft.activePresetId = null;
      selectedPresetId = "";
      presetNameDraft = "";
      render();
      maybeApplyLive();
    });
    (modal.querySelector('[data-act="preset-export"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      if (!selectedPresetId) return;
      const preset = draft.presets.find(row => row.id === selectedPresetId);
      if (!preset) return;
      presetTransferMode = "export";
      presetTransferError = "";
      presetTransferText = JSON.stringify(preset, null, 2);
      render();
    });
    (modal.querySelector('[data-act="preset-import"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      presetTransferMode = "import";
      presetTransferError = "";
      presetTransferText = "";
      render();
    });
    (modal.querySelector('[data-act="preset-transfer-close"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      presetTransferMode = "none";
      presetTransferError = "";
      presetTransferText = "";
      render();
    });
    (modal.querySelector('[data-act="preset-import-apply"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const payload = parsePresetTransferPayload(presetTransferText);
      if (!payload) {
        presetTransferError = "Invalid preset JSON.";
        render();
        return;
      }
      const resolvedName = String(payload.name || payload.id || "").trim();
      if (!resolvedName) {
        presetTransferError = "Preset must include name or id.";
        render();
        return;
      }
      captureHistory();
      const presetId = toPresetId(payload.id || resolvedName);
      const existing = draft.presets.find(row => row.id === presetId);
      const mergedBaseElements: Record<string, CardVisualEditorStylePreset> = {};
      for (const [key, value] of Object.entries(draft.base.elements ?? {})) {
        mergedBaseElements[key] = { ...draft.base.root, ...value };
      }
      for (const [key, value] of Object.entries(payload.base?.elements ?? {})) {
        mergedBaseElements[key] = { ...draft.base.root, ...(mergedBaseElements[key] ?? {}), ...value };
      }
      const nextPreset = buildPresetSnapshot(
        {
          ...draft,
          base: {
            ...draft.base,
            root: { ...draft.base.root, ...(payload.base?.root ?? {}) },
            elements: mergedBaseElements,
            layerOrder: Array.isArray(payload.base?.layerOrder) ? [...payload.base.layerOrder] : draft.base.layerOrder,
            motionEnabled: payload.base?.motionEnabled ?? draft.base.motionEnabled,
            motionIntensity: payload.base?.motionIntensity ?? draft.base.motionIntensity,
          },
          character: payload.character ? cloneCardOverride(payload.character) : draft.character,
          user: payload.user ? cloneCardOverride(payload.user) : draft.user,
          scene: payload.scene ? cloneCardOverride(payload.scene) : draft.scene,
        },
        presetId,
        resolvedName,
        existing,
      );
      draft.presets = [...draft.presets.filter(row => row.id !== presetId), nextPreset]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      draft.activePresetId = presetId;
      selectedPresetId = presetId;
      presetTransferMode = "none";
      presetTransferError = "";
      presetTransferText = "";
      render();
      maybeApplyLive();
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


