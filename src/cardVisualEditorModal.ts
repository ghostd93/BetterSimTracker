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
  previewKind?: "numeric" | "text" | "array" | "date_time" | "boolean" | "enum_single";
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
  { id: "stats.numeric.row", label: "Numeric stats", parentId: "body", movable: false, type: "container" },
  { id: "stats.nonNumeric.row", label: "Custom stats", parentId: "body", movable: false, type: "container" },
  { id: "mood.container", label: "Mood", parentId: "body", movable: false, type: "container" },
  { id: "thought.panel", label: "Thought", parentId: "body", movable: false, type: "container" },
];
const BASE_SCENE_TREE: LayerNode[] = [
  { id: "root", label: "Root", parentId: null, movable: false, type: "container" },
  { id: "scene.header", label: "Header", parentId: "root", movable: false, type: "container" },
  { id: "scene.body", label: "Body", parentId: "root", movable: false, type: "container" },
  { id: "scene.stat.row", label: "Scene stats", parentId: "scene.body", movable: false, type: "container" },
  { id: "scene.stat.array.container", label: "Scene array stats", parentId: "scene.body", movable: false, type: "container" },
];
const LEGACY_DEFAULT_LAYER_IDS: Record<CardType, readonly string[]> = {
  character: ["root", "header", "body", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"],
  user: ["root", "header", "body", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"],
  scene: ["root", "scene.header", "scene.body", "scene.stat.row", "scene.stat.array.container"],
};

function normalizeLayerNode(input: LayerNode): LayerNode {
  const previewKind = input.previewKind;
  return {
    id: String(input.id ?? "").trim(),
    label: String(input.label ?? "").trim() || String(input.id ?? "").trim(),
    parentId: input.parentId ? String(input.parentId).trim() : null,
    movable: Boolean(input.movable),
    type: input.type === "leaf" ? "leaf" : "container",
    previewKind: previewKind === "numeric" || previewKind === "text" || previewKind === "array" || previewKind === "date_time" || previewKind === "boolean" || previewKind === "enum_single"
      ? previewKind
      : undefined,
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

export function buildAppliedEditorSettings(
  draft: CardVisualEditorSettings,
  legacy: OpenCardVisualEditorModalInput["legacy"],
): CardVisualEditorSettings {
  const next = sanitizeCardVisualEditorSettings(draft, legacy);
  next.useEditorStyling = true;
  return next;
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

function reorderLayerIdsWithDropPosition(
  layerIds: readonly string[],
  fromId: string,
  targetId: string,
  dropPosition: "before" | "after",
): string[] {
  if (!fromId || !targetId || fromId === targetId) return [...layerIds];
  const next = [...layerIds].filter(id => id !== fromId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return [...layerIds];
  const insertIndex = dropPosition === "after" ? targetIndex + 1 : targetIndex;
  next.splice(insertIndex, 0, fromId);
  return next;
}

function readNumber(node: HTMLInputElement, fallback: number, min: number, max: number): number {
  const parsed = Number(node.value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const ROOT_INSPECTOR_KEYS: Array<keyof CardVisualEditorStylePreset> = [
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
  return !new Set(["root", "header", "body", "scene.header", "scene.body", "scene.stat.row", "scene.stat.array.container", "stats.numeric.row", "stats.nonNumeric.row", "mood.container", "thought.panel"]).has(layerId);
}

function getLayerNodeById(nodes: LayerNode[]): Map<string, LayerNode> {
  return new Map(nodes.map(node => [node.id, node]));
}

export function hasLayerStyleOverride(
  draft: CardVisualEditorSettings,
  type: CardType,
  layerId: string,
): boolean {
  if (layerId === "root") {
    const rootOverride = type === "scene"
      ? draft.scene.root
      : type === "user"
        ? draft.user.root
        : draft.character.root;
    return Boolean(rootOverride && Object.keys(rootOverride).length > 0);
  }
  const elements = type === "scene"
    ? draft.scene.elements
    : type === "user"
      ? draft.user.elements
      : draft.character.elements;
  const layer = elements?.[layerId];
  return Boolean(layer && Object.keys(layer).length > 0);
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
  const lockBadge = (node: LayerNode): string => (node.movable ? "movable" : "locked");
  const roleLabel = (node: LayerNode): string => {
    if (node.id === "root") return "card";
    if (node.type === "container") return "section";
    if (node.id.startsWith("stat.")) return "built-in";
    if (node.id.startsWith("custom.")) return "custom";
    if (node.id.startsWith("scene.")) return "scene";
    return "layer";
  };
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
      <div class="bst-card-editor-layer-row ${selectedLayerId === node.id ? "is-active" : ""} ${node.movable ? "has-actions" : "is-locked-row"}" data-layer-row="${escapeHtml(node.id)}" style="--bst-layer-depth:${String(depth)};">
        <button
          type="button"
          draggable="${node.movable ? "true" : "false"}"
          class="bst-card-editor-layer-btn ${selectedLayerId === node.id ? "is-active" : ""}"
          data-layer-pick="${escapeHtml(node.id)}"
          data-layer-drag="${escapeHtml(node.id)}">
          <span class="bst-card-editor-layer-title-wrap">
            <span class="bst-card-editor-layer-title">${escapeHtml(node.label)}</span>
            <span class="bst-card-editor-layer-role">${escapeHtml(roleLabel(node))}</span>
            <span class="bst-card-editor-layer-lock ${node.movable ? "is-movable" : "is-locked"}">${lockBadge(node)}</span>
          </span>
          <span class="bst-card-editor-layer-id" title="${escapeHtml(node.id)}">${escapeHtml(node.id)}</span>
        </button>
        ${node.movable
          ? `<button type="button" class="bst-card-editor-layer-mini bst-card-editor-layer-mini-icon" data-layer-up="${escapeHtml(node.id)}" title="Move up within siblings" aria-label="Move up">&#8593;</button>
             <button type="button" class="bst-card-editor-layer-mini bst-card-editor-layer-mini-icon" data-layer-down="${escapeHtml(node.id)}" title="Move down within siblings" aria-label="Move down">&#8595;</button>`
          : ""
        }
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
      return ["backgroundColor", "textColor", "borderColor", "backgroundOpacity", "borderWidth", "borderRadius", "titleFontSize", "padding", "rowGap", "sectionGap"];
    }
    return ["backgroundColor", "textColor", "borderColor", "backgroundOpacity", "borderWidth", "borderRadius", "padding", "rowGap", "sectionGap"];
  }
  if (layerId.includes("mood")) {
    return ["textColor", "valueColor", "borderColor", "borderWidth", "borderRadius", "valueFontSize", "padding", "rowGap"];
  }
  if (layerId.includes("thought")) {
    return ["textColor", "valueColor", "borderColor", "backgroundColor", "backgroundOpacity", "borderWidth", "borderRadius", "valueFontSize", "padding"];
  }
  return ["textColor", "labelColor", "valueColor", "borderColor", "backgroundColor", "backgroundOpacity", "borderWidth", "borderRadius", "labelFontSize", "valueFontSize", "padding", "rowGap"];
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
  nodes: LayerNode[],
): string {
  const root = resolvePreviewLayerStyle(draft, type, "root");
  const headerId = type === "scene" ? "scene.header" : "header";
  const bodyId = type === "scene" ? "scene.body" : "body";
  const numericContainerId = type === "scene" ? "scene.stat.row" : "stats.numeric.row";
  const customContainerId = type === "scene" ? "scene.stat.array.container" : "stats.nonNumeric.row";
  const selectedClass = (id: string): string => (selectedLayerId === id ? " is-selected" : "");
  const visible = (_id: string): boolean => true;
  const orderedLayerIds = resolvePreviewLayerOrder(draft, type, layerIds);
  const nodeById = getLayerNodeById(nodes);
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "__root__";
    const list = childrenMap.get(key) ?? [];
    list.push(node.id);
    childrenMap.set(key, list);
  }
  const getContainerLeafIds = (containerId: string): string[] => {
    const directChildren = childrenMap.get(containerId) ?? [];
    return directChildren
      .filter(id => {
        const node = nodeById.get(id);
        return Boolean(node && node.type === "leaf");
      })
      .sort((a, b) => {
        const ai = orderedLayerIds.indexOf(a);
        const bi = orderedLayerIds.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.localeCompare(b);
      });
  };

  const rootStyle = `
    background:${escapeHtml(root.backgroundColor || "#1a2134")};
    color:${escapeHtml(root.textColor || "#f1f3f8")};
    border:${String(root.borderWidth)}px solid ${escapeHtml(root.borderColor || "#3a4966")};
    border-radius:${String(root.borderRadius)}px;
    opacity:${String(root.backgroundOpacity)};
    font-size:${String(root.fontSize)}px;
    padding:${String(root.padding)}px;
    box-shadow:${root.shadowEnabled ? `0 0 ${String(root.shadowBlur)}px ${String(root.shadowSpread)}px ${escapeHtml(root.shadowColor || "#00000044")}` : "none"};
    ${root.visible === false ? "display:none;" : ""}
  `;

  const headerStyleToken = resolvePreviewLayerStyle(draft, type, headerId);
  const headerStyle = `
    color:${escapeHtml(headerStyleToken.textColor || root.textColor || "#f1f3f8")};
    border:${String(headerStyleToken.borderWidth ?? 0)}px solid ${escapeHtml(headerStyleToken.borderColor || "transparent")};
    border-radius:${String(headerStyleToken.borderRadius ?? root.borderRadius)}px;
    padding:${String(Math.max(6, Math.round((headerStyleToken.padding ?? root.padding) * 0.7)))}px;
  `;
  const sectionToken = resolvePreviewLayerStyle(draft, type, bodyId);
  const sectionStyle = `
    margin-top:${String(root.sectionGap)}px;
    border:${String(sectionToken.borderWidth ?? 0)}px solid ${escapeHtml(sectionToken.borderColor || "transparent")};
    border-radius:${String(sectionToken.borderRadius ?? root.borderRadius)}px;
    padding:${String(Math.max(6, Math.round((sectionToken.padding ?? root.padding) * 0.7)))}px;
    color:${escapeHtml(sectionToken.textColor || root.textColor || "#f1f3f8")};
  `;

  const numericSample: Record<string, number> = {
    "stat.affection": 92,
    "stat.trust": 84,
    "stat.desire": 67,
    "stat.connection": 88,
  };
  const customSample: Record<string, string> = {
    "custom.clothes": "white summer dress, lace bra, silk ribbon, silver necklace, sandal heels",
    "custom.pose": "Leaning close, shoulders relaxed, one hand brushing hair behind ear.",
    "custom.physicality": "Soft skin glow, flushed cheeks, visible breathing, slightly trembling fingers.",
    "scene.scene_date_time": "Wednesday - March 4th, 2026 - 20:22 - Late Evening",
    "scene.characters_in_scene": "Seraphina, User, Guard Captain, Innkeeper",
    "scene.tv_screen_scene": "Rainy neon alley, camera dolly-in, tense violin swells before reveal.",
  };

  const numericLeafIds = getContainerLeafIds(numericContainerId).filter(visible);
  const customLeafIds = getContainerLeafIds(customContainerId).filter(visible);
  const isNumericLeaf = (statId: string): boolean => {
    const node = nodeById.get(statId);
    if (node?.previewKind === "numeric") return true;
    return statId === "stat.affection" || statId === "stat.trust" || statId === "stat.desire" || statId === "stat.connection";
  };

  const renderBar = (statId: string): string => {
    const token = resolvePreviewLayerStyle(draft, type, statId);
    const baseValue = numericSample[statId];
    const value = Number.isFinite(baseValue)
      ? Number(baseValue)
      : Math.max(58, Math.min(97, 58 + (Math.abs(statId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 40)));
    const label = layerLabelById[statId] || statId.replace(/^stat\./, "");
    return `
      <div class="bst-card-editor-preview-bar-row${selectedClass(statId)}" data-layer="${statId}">
        <div class="bst-card-editor-preview-bar-head" style="font-size:${String(token.labelFontSize || root.labelFontSize)}px;color:${escapeHtml(token.labelColor || root.labelColor || "#c7d0e0")}">
          <span>${escapeHtml(label)}</span><span>${String(value)}%</span>
        </div>
        <div class="bst-card-editor-preview-bar-track" style="height:${String(token.barHeight || root.barHeight)}px;border-radius:${String(token.barHeight || root.barHeight)}px;background:rgba(255,255,255,0.16);">
          <div class="bst-card-editor-preview-bar-fill" style="width:${String(value)}%;background:${escapeHtml(token.accentColor || root.accentColor || "#8fb4ff")};"></div>
        </div>
      </div>
    `;
  };

  const renderCustom = (statId: string): string => {
    const token = resolvePreviewLayerStyle(draft, type, statId);
    const label = layerLabelById[statId] || statId;
    const fallbackValue = "Sample value near max length to preview spacing, wrapping and card rhythm.";
    const value = customSample[statId] || fallbackValue;
    const kind = nodeById.get(statId)?.previewKind;
    const isDateTimeLike = kind === "date_time" || statId.includes("date_time");
    const isArrayLike = kind === "array" || statId.includes("clothes") || statId.includes("characters_in_scene");
    const isBooleanLike = kind === "boolean";
    const chipLike = (value.length < 70 && !value.includes(",")) || isDateTimeLike || isArrayLike;
    const chipContent = isDateTimeLike
      ? `<span class="bst-card-editor-preview-chip">Wednesday</span><span class="bst-card-editor-preview-chip">March 4th, 2026</span><span class="bst-card-editor-preview-chip">20:22</span><span class="bst-card-editor-preview-chip">Late Evening</span>`
      : isArrayLike
        ? value
            .split(",")
            .map(item => item.trim())
            .filter(Boolean)
            .slice(0, 5)
            .map(item => `<span class="bst-card-editor-preview-chip">${escapeHtml(item)}</span>`)
            .join("")
        : isBooleanLike
          ? `<span class="bst-card-editor-preview-chip">Enabled</span>`
        : "";
    return `
      <div class="bst-card-editor-preview-custom-row${selectedClass(statId)}" data-layer="${statId}">
        <div class="bst-card-editor-preview-custom-label" style="font-size:${String(token.labelFontSize || root.labelFontSize)}px;color:${escapeHtml(token.labelColor || root.labelColor || "#c7d0e0")}">${escapeHtml(label)}</div>
        <div class="${chipLike ? "bst-card-editor-preview-custom-chiplist" : "bst-card-editor-preview-custom-value"}" style="
          border-radius:${String(token.chipRadius || root.chipRadius)}px;
          color:${escapeHtml(token.valueColor || root.valueColor || "#f1f3f8")};
          border:${String(token.borderWidth ?? 1)}px solid ${escapeHtml(token.borderColor || "rgba(143,180,255,0.35)")};
          background:${escapeHtml(token.backgroundColor || "rgba(18, 30, 52, 0.58)")};
          padding:${chipLike ? "6px 8px" : "8px 10px"};
          font-size:${String(token.valueFontSize || root.valueFontSize)}px;
        ">${chipLike ? chipContent : escapeHtml(value)}</div>
      </div>
    `;
  };

  const numericToken = resolvePreviewLayerStyle(draft, type, numericContainerId);
  const customToken = resolvePreviewLayerStyle(draft, type, customContainerId);
  const moodToken = resolvePreviewLayerStyle(draft, type, "mood.container");
  const thoughtToken = resolvePreviewLayerStyle(draft, type, "thought.panel");

  const showMood = type !== "scene" && visible("mood.container");
  const showThought = type !== "scene" && visible("thought.panel");
  const ownerTitle = type === "character" ? "Seraphina" : type === "user" ? "User (Persona)" : "Scene";

  const sceneBadge = type === "scene" ? `<span class="bst-card-editor-preview-badge">Global</span>` : "";
  const actionBadge = type === "scene"
    ? `<div class="bst-card-editor-preview-actions"><span class="bst-card-editor-preview-action-icon" title="Collapse">&#9662;</span><span class="bst-card-editor-preview-action-icon" title="Edit">&#9998;</span></div>`
    : `<div class="bst-card-editor-preview-actions"><span class="bst-card-editor-preview-action">Graph</span><span class="bst-card-editor-preview-action-icon" title="Edit">&#9998;</span><span class="bst-card-editor-preview-action">Active</span></div>`;

  const numericBarLeafIds = numericLeafIds.filter(isNumericLeaf);
  const numericTextLeafIds = numericLeafIds.filter(id => !isNumericLeaf(id));
  const sceneStatLeafIds = type === "scene" ? numericLeafIds : [];

  const numericBlock = type !== "scene" && visible(numericContainerId) && (numericBarLeafIds.length || numericTextLeafIds.length)
    ? `
      <div class="bst-card-editor-preview-section${selectedClass(numericContainerId)}" data-layer="${numericContainerId}" style="${sectionStyle}
        border-color:${escapeHtml(numericToken.borderColor || sectionToken.borderColor || "transparent")};
        color:${escapeHtml(numericToken.textColor || sectionToken.textColor || root.textColor || "#f1f3f8")};">
        ${numericBarLeafIds.map(renderBar).join("")}
        ${numericTextLeafIds.map(renderCustom).join("")}
      </div>
    `
    : "";

  const sceneStatsBlock = type === "scene" && visible(numericContainerId) && sceneStatLeafIds.length
    ? `
      <div class="bst-card-editor-preview-section${selectedClass(numericContainerId)}" data-layer="${numericContainerId}" style="${sectionStyle}
        border-color:${escapeHtml(numericToken.borderColor || sectionToken.borderColor || "transparent")};
        color:${escapeHtml(numericToken.textColor || sectionToken.textColor || root.textColor || "#f1f3f8")};">
        ${sceneStatLeafIds.map(renderCustom).join("")}
      </div>
    `
    : "";

  const customBlock = visible(customContainerId) && customLeafIds.length
    ? `
      <div class="bst-card-editor-preview-section${selectedClass(customContainerId)}" data-layer="${customContainerId}" style="${sectionStyle}
        border-color:${escapeHtml(customToken.borderColor || sectionToken.borderColor || "transparent")};
        color:${escapeHtml(customToken.textColor || sectionToken.textColor || root.textColor || "#f1f3f8")};">
        ${customLeafIds.map(renderCustom).join("")}
      </div>
    `
    : "";

  const moodBlock = showMood
    ? `
      <div class="bst-card-editor-preview-mood${selectedClass("mood.container")}" data-layer="mood.container" style="margin-top:${String(root.sectionGap)}px;
        color:${escapeHtml(moodToken.valueColor || root.valueColor || "#f1f3f8")}">
        <span class="bst-card-editor-preview-avatar">:)</span>
        <span class="bst-card-editor-preview-chip" style="border-radius:${String(root.chipRadius)}px">Hopeful (stable)</span>
      </div>
    `
    : "";
  const thoughtBlock = showThought
    ? `
      <div class="bst-card-editor-preview-thought${selectedClass("thought.panel")}" data-layer="thought.panel" style="
        margin-top:${String(root.rowGap)}px;
        border:${String(thoughtToken.borderWidth ?? 1)}px solid ${escapeHtml(thoughtToken.borderColor || "rgba(143,180,255,0.35)")};
        border-radius:${String(thoughtToken.borderRadius ?? root.borderRadius)}px;
        background:${escapeHtml(thoughtToken.backgroundColor || "rgba(13,20,34,0.68)")};
        color:${escapeHtml(thoughtToken.valueColor || root.valueColor || "#f1f3f8")};
        padding:${String(Math.max(8, thoughtToken.padding || root.padding))}px;
        font-size:${String(thoughtToken.valueFontSize || root.valueFontSize)}px;">
        I am relieved, but still alert. I need to keep the scene stable and safe.
      </div>
    `
    : "";

  return `
    <div class="bst-card-editor-preview-card${selectedClass("root")}" style="${rootStyle}" data-layer="root">
      <div class="bst-card-editor-preview-header${selectedClass(headerId)}" data-layer="${headerId}" style="${headerStyle}">
        <div class="bst-card-editor-preview-header-top">
          <strong style="font-size:${String(headerStyleToken.titleFontSize || root.titleFontSize)}px">${ownerTitle}</strong>
          <div class="bst-card-editor-preview-actions-wrap">${sceneBadge}${actionBadge}</div>
        </div>
      </div>
      ${numericBlock}
      ${sceneStatsBlock}
      ${customBlock}
      ${moodBlock}
      ${thoughtBlock}
    </div>
  `;
}

export function openCardVisualEditorModal(input: OpenCardVisualEditorModalInput): void {
  closeExisting();
  const base = sanitizeCardVisualEditorSettings(input.current, input.legacy);
  let draft = sanitizeCardVisualEditorSettings(base, input.legacy);
  let activeType: CardType = "character";
  let selectedLayerId = "root";
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

  const clearDropIndicators = (): void => {
    modal.querySelectorAll(".bst-card-editor-layer-row").forEach(row => {
      row.classList.remove("is-drop-before");
      row.classList.remove("is-drop-after");
      row.classList.remove("is-drop-target");
      if (row instanceof HTMLElement) {
        row.removeAttribute("data-drop-position");
      }
    });
  };

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
        <div class="bst-card-editor-primary">
          <div class="bst-card-editor-group-title">Card + viewport</div>
          <div class="bst-card-editor-tabs">
            <button type="button" data-tab="character" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "character" ? "is-active" : ""}">&#128100; Character</button>
            <button type="button" data-tab="user" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "user" ? "is-active" : ""}">&#128101; User</button>
            <button type="button" data-tab="scene" class="bst-btn bst-btn-soft bst-card-editor-tab ${activeType === "scene" ? "is-active" : ""}">&#127970; Scene</button>
          </div>
          <div class="bst-card-editor-preview-viewport">
            <button type="button" data-vp="desktop" class="bst-btn bst-btn-soft bst-card-editor-vp-btn ${previewViewport === "desktop" ? "is-active" : ""}">&#128421; Desktop</button>
            <button type="button" data-vp="mobile" class="bst-btn bst-btn-soft bst-card-editor-vp-btn ${previewViewport === "mobile" ? "is-active" : ""}">&#128241; Mobile</button>
          </div>
        </div>
        <div class="bst-card-editor-presets">
          <div class="bst-card-editor-group-title">&#128190; Presets + history</div>
          <div class="bst-card-editor-history-controls">
            <select data-k="presetSelect" class="bst-input bst-card-editor-preset-select">
              <option value="">Preset: none</option>
              ${draft.presets.map(preset => `
                <option value="${escapeHtml(preset.id)}" ${selectedPresetId === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>
              `).join("")}
            </select>
            <input data-k="presetName" class="bst-input bst-card-editor-preset-name" type="text" maxlength="80" value="${escapeHtml(presetNameDraft)}" placeholder="Preset name">
            <button type="button" data-act="preset-save" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Save current style as preset">&#128190; Save</button>
            ${selectedPresetId
              ? `<button type="button" data-act="preset-load" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Load selected preset">&#128194; Load</button>
                 <button type="button" data-act="preset-delete" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Delete selected preset">&#128465; Delete</button>
                 <button type="button" data-act="preset-export" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Export selected preset as JSON">&#11015; Export</button>`
              : ""
            }
            <button type="button" data-act="preset-import" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" title="Import preset from JSON">&#11014; Import</button>
            <button type="button" data-act="undo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${historyStack.length === 0 ? "disabled" : ""}>&#8630; Undo</button>
            <button type="button" data-act="redo" class="bst-btn bst-btn-soft bst-card-editor-hist-btn" ${futureStack.length === 0 ? "disabled" : ""}>&#8631; Redo</button>
          </div>
        </div>
      </div>
      <div class="bst-card-editor-toggle-hints">
        <div>Changes are preview-only until <strong>Apply</strong>. Use the global <strong>Use Editor Styling</strong> toggle in Display settings to enable/disable editor styles on real cards.</div>
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
            ${renderPreviewCard(draft, activeType, selectedLayerId, getLayerIdsForType(layerCatalog, activeType), layerLabelById, nodes)}
          </div>
          <div class="bst-card-editor-pane-title">Inspector</div>
          <div class="bst-card-editor-help bst-card-editor-help-row">
            <span>Editing layer: <code>${escapeHtml(selectedLayerId)}</code></span>
            ${hasLayerStyleOverride(draft, activeType, selectedLayerId)
              ? `<button type="button" data-act="inspector-reset-layer" class="bst-btn bst-btn-soft bst-card-editor-inspector-reset">Reset Layer</button>`
              : ""
            }
          </div>
          <div class="bst-card-editor-inspector">
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
          <div class="bst-card-editor-pane-title">Layers (tree)</div>
          <div class="bst-card-editor-help">Locked layers stay fixed. Drag movable stat layers; drop line shows exact target.</div>
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
        const targetLayerId = String((node as HTMLElement).getAttribute("data-layer-drag") || "");
        const sourceLayerId = draggedLayerId || (event as DragEvent).dataTransfer?.getData("text/plain") || "";
        const row = (node as HTMLElement).closest(".bst-card-editor-layer-row") as HTMLElement | null;
        clearDropIndicators();
        if (!row || !sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return;
        const sourceNode = nodeById.get(sourceLayerId);
        const targetNode = nodeById.get(targetLayerId);
        if (!sourceNode || !targetNode) return;
        if (sourceNode.parentId !== targetNode.parentId) return;
        const rect = row.getBoundingClientRect();
        const pointY = (event as DragEvent).clientY;
        const position: "before" | "after" = pointY < rect.top + rect.height / 2 ? "before" : "after";
        row.classList.add(position === "before" ? "is-drop-before" : "is-drop-after");
        row.classList.add("is-drop-target");
        row.setAttribute("data-drop-position", position);
      });
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        const targetLayerId = String((node as HTMLElement).getAttribute("data-layer-drag") || "");
        const sourceLayerId = draggedLayerId || (event as DragEvent).dataTransfer?.getData("text/plain") || "";
        const row = (node as HTMLElement).closest(".bst-card-editor-layer-row") as HTMLElement | null;
        const dropPosition: "before" | "after" = row?.classList.contains("is-drop-after") ? "after" : "before";
        clearDropIndicators();
        if (!isLayerMovable(sourceLayerId)) return;
        if (!sourceLayerId || !targetLayerId || sourceLayerId === targetLayerId) return;
        const sourceNode = nodeById.get(sourceLayerId);
        const targetNode = nodeById.get(targetLayerId);
        if (!sourceNode || !targetNode) return;
        if (sourceNode.parentId !== targetNode.parentId) return;
        captureHistory();
        const nextOrder = reorderLayerIdsWithDropPosition(layerIds, sourceLayerId, targetLayerId, dropPosition);
        writeOverrideLayerOrder(draft, activeType, nextOrder);
        render();
      });
      node.addEventListener("dragend", () => {
        draggedLayerId = null;
        clearDropIndicators();
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
      });
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
    (modal.querySelector('[data-act="inspector-reset-layer"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      captureHistory();
      if (selectedLayerId === "root") {
        const targetKey = activeType === "character" ? "character" : activeType === "user" ? "user" : "scene";
        const current = draft[targetKey] as CardVisualEditorCardStyleOverride;
        draft[targetKey] = { ...current, root: undefined };
      } else {
        clearOverrideElement(draft, activeType, selectedLayerId);
      }
      render();
    });

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
    };

    const applyRedo = (): void => {
      if (futureStack.length === 0) return;
      historyStack = pushDraftHistory(historyStack, sanitizeCardVisualEditorSettings(draft, input.legacy), HISTORY_LIMIT);
      const nextDraft = futureStack[futureStack.length - 1];
      futureStack = futureStack.slice(0, -1);
      draft = sanitizeCardVisualEditorSettings(nextDraft, input.legacy);
      render();
    };

    const refreshPreview = (): void => {
      const previewNode = modal.querySelector(".bst-card-editor-live-preview") as HTMLElement | null;
      if (!previewNode) return;
      previewNode.style.maxWidth = `${String(resolvePreviewViewportWidth(previewViewport))}px`;
      previewNode.innerHTML = renderPreviewCard(draft, activeType, selectedLayerId, getLayerIdsForType(layerCatalog, activeType), layerLabelById, nodes);
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
    });
    (modal.querySelector('[data-act="preset-load"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      if (!selectedPresetId) return;
      const preset = draft.presets.find(row => row.id === selectedPresetId);
      if (!preset) return;
      captureHistory();
      draft = applyPresetToDraft(draft, preset);
      render();
    });
    (modal.querySelector('[data-act="preset-delete"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      if (!selectedPresetId) return;
      captureHistory();
      draft.presets = draft.presets.filter(preset => preset.id !== selectedPresetId);
      if (draft.activePresetId === selectedPresetId) draft.activePresetId = null;
      selectedPresetId = "";
      presetNameDraft = "";
      render();
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
    });
    (modal.querySelector('[data-act="apply"]') as HTMLButtonElement | null)?.addEventListener("click", () => {
      const next = buildAppliedEditorSettings(draft, input.legacy);
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


