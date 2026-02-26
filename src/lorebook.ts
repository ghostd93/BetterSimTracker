import type { STContext } from "./types";

const WI_DEPTH_PREFIX = "customDepthWI_";
const WI_OUTLET_PREFIX = "customWIOutlet_";
const DEFAULT_LOREBOOK_MAX_CHARS = 1200;

function compactLorebookText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPath(record: unknown, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function maybePushLorebookString(target: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const compact = compactLorebookText(value);
  if (compact) target.push(compact);
}

function collectActivatedLorebookStrings(source: unknown): string[] {
  const out: string[] = [];
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
    maybePushLorebookString(out, getPath(record, path));
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
    const value = getPath(record, path);
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") {
        maybePushLorebookString(out, item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      maybePushLorebookString(out, entry.content);
      maybePushLorebookString(out, entry.text);
      maybePushLorebookString(out, entry.prompt);
      maybePushLorebookString(out, entry.entry);
    }
  }

  return out;
}

function collectLorebookFromExtensionPrompts(context: STContext): string[] {
  const out: string[] = [];
  const prompts = context.extensionPrompts;
  if (!prompts || typeof prompts !== "object") return out;
  for (const [key, rawPrompt] of Object.entries(prompts)) {
    if (!key.startsWith(WI_DEPTH_PREFIX) && !key.startsWith(WI_OUTLET_PREFIX)) continue;
    if (!rawPrompt || typeof rawPrompt !== "object") continue;
    const value = (rawPrompt as Record<string, unknown>).value;
    maybePushLorebookString(out, value);
  }
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
