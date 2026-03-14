import { GLOBAL_TRACKER_KEY } from "./constants";
import type { TrackerData } from "./types";

const MAX_INJECT_NON_NUMERIC_TEXT = 120;

function truncateForInjection(value: string, max = MAX_INJECT_NON_NUMERIC_TEXT): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  const hard = text.slice(0, Math.max(1, max - 1)).trimEnd();
  const lastSpace = hard.lastIndexOf(" ");
  const safe = lastSpace >= Math.floor(max * 0.6) ? hard.slice(0, lastSpace).trimEnd() : hard;
  const out = safe || hard;
  return `${out}…`;
}

export function renderNonNumericValue(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items: string[] = [];
    const seenItems = new Set<string>();
    for (const item of value) {
      const cleaned = truncateForInjection(String(item ?? ""));
      if (!cleaned) continue;
      const dedupeKey = cleaned.toLowerCase();
      if (seenItems.has(dedupeKey)) continue;
      seenItems.add(dedupeKey);
      items.push(cleaned);
      if (items.length >= 20) break;
    }
    if (!items.length) return null;
    return `[${items.map(item => `"${item.replace(/"/g, "\\\"")}"`).join(", ")}]`;
  }
  if (typeof value !== "string") return null;
  const text = truncateForInjection(value);
  return text ? `"${text}"` : null;
}

export function behaviorGuidanceLines(value: unknown): string[] {
  return String(value ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map(line => `- ${line}`);
}

export function customStatTracksScope(
  stat: { track?: boolean; trackCharacters?: boolean; trackUser?: boolean },
  scope: "character" | "user",
): boolean {
  if (scope === "user") {
    if (stat.trackUser !== undefined) return Boolean(stat.trackUser);
    return Boolean(stat.track);
  }
  if (stat.trackCharacters !== undefined) return Boolean(stat.trackCharacters);
  return Boolean(stat.track);
}

export function customStatTracksAnyScope(
  stat: { track?: boolean; trackCharacters?: boolean; trackUser?: boolean },
): boolean {
  return customStatTracksScope(stat, "character") || customStatTracksScope(stat, "user");
}

export function resolveScopedCustomNumericValue(
  data: TrackerData,
  statId: string,
  ownerName: string,
  globalScope?: boolean,
): number | undefined {
  const numericOwnerKey = globalScope ? GLOBAL_TRACKER_KEY : ownerName;
  if (data.clearedCustomStatistics?.[statId]?.[numericOwnerKey]) return undefined;
  const byOwner = data.customStatistics?.[statId];
  if (!byOwner) return undefined;
  const legacyFallback = (): number | undefined => {
    for (const [owner, value] of Object.entries(byOwner)) {
      if (owner === GLOBAL_TRACKER_KEY) continue;
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
  };
  if (globalScope) {
    const globalValue = byOwner[GLOBAL_TRACKER_KEY];
    if (globalValue !== undefined) return Number(globalValue);
    const ownerValue = byOwner[ownerName];
    if (ownerValue !== undefined) return Number(ownerValue);
    const fallback = legacyFallback();
    if (fallback !== undefined) return fallback;
  }
  const ownerValue = byOwner[ownerName];
  if (ownerValue !== undefined) return Number(ownerValue);
  return undefined;
}

export function resolveScopedCustomNonNumericValue(
  data: TrackerData,
  statId: string,
  ownerName: string,
  globalScope?: boolean,
): unknown {
  const nonNumericOwnerKey = globalScope ? GLOBAL_TRACKER_KEY : ownerName;
  if (data.clearedCustomNonNumericStatistics?.[statId]?.[nonNumericOwnerKey]) return undefined;
  const byOwner = data.customNonNumericStatistics?.[statId];
  if (!byOwner) return undefined;
  const legacyFallback = (): unknown => {
    for (const [owner, value] of Object.entries(byOwner)) {
      if (owner === GLOBAL_TRACKER_KEY) continue;
      if (value !== undefined) return value;
    }
    return undefined;
  };
  if (globalScope) {
    const globalValue = byOwner[GLOBAL_TRACKER_KEY];
    if (globalValue !== undefined) return globalValue;
    const ownerValue = byOwner[ownerName];
    if (ownerValue !== undefined) return ownerValue;
    const fallback = legacyFallback();
    if (fallback !== undefined) return fallback;
  }
  const ownerValue = byOwner[ownerName];
  if (ownerValue !== undefined) return ownerValue;
  return undefined;
}
