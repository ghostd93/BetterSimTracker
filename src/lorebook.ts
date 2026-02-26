import type { STContext } from "./types";

const WI_DEPTH_PREFIX = "customDepthWI_";
const WI_OUTLET_PREFIX = "customWIOutlet_";
const DEFAULT_LOREBOOK_MAX_CHARS = 1200;
const MAX_LOREBOOK_PARSE_DEPTH = 6;
const TEXT_FIELD_KEYS = new Set([
  "content",
  "text",
  "prompt",
  "entry",
  "value",
  "world_info_prompt",
  "worldInfoPrompt",
  "lorebookPrompt",
]);
const CONTAINER_FIELD_KEYS = new Set([
  "entries",
  "items",
  "data",
  "value",
  "activatedEntries",
  "activated_entries",
  "allActivatedEntries",
  "bstLorebookActivatedEntries",
  "bst_lorebook_activated_entries",
  "world_info",
  "worldInfo",
  "lorebook",
]);

function compactLorebookText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function maybePushLorebookString(target: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const compact = compactLorebookText(value);
  if (!compact || seen.has(compact)) return;
  seen.add(compact);
  target.push(compact);
}

function getPath(record: unknown, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractLorebookNode(
  source: unknown,
  out: string[],
  seen: Set<string>,
  depth: number,
  maxItems: number
): void {
  if (out.length >= maxItems || depth > MAX_LOREBOOK_PARSE_DEPTH || source == null) return;

  if (typeof source === "string") {
    maybePushLorebookString(out, seen, source);
    return;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      extractLorebookNode(item, out, seen, depth + 1, maxItems);
      if (out.length >= maxItems) return;
    }
    return;
  }

  if (source instanceof Set) {
    for (const item of source.values()) {
      extractLorebookNode(item, out, seen, depth + 1, maxItems);
      if (out.length >= maxItems) return;
    }
    return;
  }

  if (source instanceof Map) {
    for (const item of source.values()) {
      extractLorebookNode(item, out, seen, depth + 1, maxItems);
      if (out.length >= maxItems) return;
    }
    return;
  }

  if (typeof source !== "object") return;
  const record = source as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (!TEXT_FIELD_KEYS.has(key)) continue;
    if (typeof value === "string") {
      maybePushLorebookString(out, seen, value);
    } else {
      extractLorebookNode(value, out, seen, depth + 1, maxItems);
    }
    if (out.length >= maxItems) return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (!CONTAINER_FIELD_KEYS.has(key)) continue;
    extractLorebookNode(value, out, seen, depth + 1, maxItems);
    if (out.length >= maxItems) return;
  }
}

function collectActivatedLorebookStrings(source: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (!source || typeof source !== "object") return out;
  const record = source as Record<string, unknown>;

  const directStringPaths: string[][] = [
    ["world_info_prompt"],
    ["worldInfoPrompt"],
    ["lorebookPrompt"],
    ["prompt"],
    ["extensions", "world_info", "world_info_prompt"],
    ["extensions", "world_info", "prompt"],
    ["extensions", "worldInfo", "worldInfoPrompt"],
    ["extensions", "lorebook", "prompt"],
  ];
  for (const path of directStringPaths) {
    maybePushLorebookString(out, seen, getPath(record, path));
  }

  const arrayPaths: string[][] = [
    ["bstLorebookActivatedEntries"],
    ["bst_lorebook_activated_entries"],
    ["world_info", "activated_entries"],
    ["world_info", "activatedEntries"],
    ["worldInfo", "activated_entries"],
    ["worldInfo", "activatedEntries"],
    ["lorebook", "activated_entries"],
    ["lorebook", "activatedEntries"],
  ];
  for (const path of arrayPaths) {
    extractLorebookNode(getPath(record, path), out, seen, 0, 120);
  }

  const directContainers = ["entries", "activatedEntries", "activated_entries", "allActivatedEntries"];
  for (const key of directContainers) {
    extractLorebookNode(record[key], out, seen, 0, 120);
  }

  return out;
}

function collectLorebookFromExtensionPrompts(context: STContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const prompts = context.extensionPrompts;
  if (!prompts || typeof prompts !== "object") return out;
  for (const [key, rawPrompt] of Object.entries(prompts)) {
    if (!key.startsWith(WI_DEPTH_PREFIX) && !key.startsWith(WI_OUTLET_PREFIX)) continue;
    extractLorebookNode(rawPrompt, out, seen, 0, 120);
  }
  return out;
}

export function extractLorebookEntriesFromPayload(payload: unknown, maxItems = 120): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  extractLorebookNode(payload, out, seen, 0, Math.max(1, maxItems));
  return out;
}

export function readLorebookContext(context: STContext, maxChars: number, maxCap = 12000): string {
  const requested = Number(maxChars);
  const limit = Number.isNaN(requested)
    ? DEFAULT_LOREBOOK_MAX_CHARS
    : Math.max(0, Math.min(maxCap, Math.round(requested)));
  const chunks = [
    ...collectActivatedLorebookStrings(context.chatMetadata),
    ...collectActivatedLorebookStrings(context.world_info),
    ...collectActivatedLorebookStrings(context.worldInfo),
    ...collectActivatedLorebookStrings(context.lorebook),
    ...collectLorebookFromExtensionPrompts(context),
  ];
  if (!chunks.length) return "";
  const deduped = Array.from(new Set(chunks.map(item => item.trim()).filter(Boolean)));
  if (!deduped.length) return "";
  const joined = deduped.join("\n\n").trim();
  if (limit === 0) return joined;
  return joined.slice(0, limit).trim();
}
