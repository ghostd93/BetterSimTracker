import { GLOBAL_TRACKER_KEY } from "./constants";
import type { TrackerData } from "./types";

export function renderNonNumericValue(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items: string[] = [];
    const seenItems = new Set<string>();
    for (const item of value) {
      const cleaned = String(item ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
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
  const text = value.trim().replace(/\s+/g, " ");
  return text ? `"${text.slice(0, 120)}"` : null;
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
  if (!globalScope) {
    const globalFallback = byOwner[GLOBAL_TRACKER_KEY];
    if (globalFallback !== undefined) return Number(globalFallback);
  }
  return undefined;
}

export function resolveScopedCustomNonNumericValue(
  data: TrackerData,
  statId: string,
  ownerName: string,
  globalScope?: boolean,
): unknown {
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
  if (!globalScope) {
    const globalFallback = byOwner[GLOBAL_TRACKER_KEY];
    if (globalFallback !== undefined) return globalFallback;
  }
  return undefined;
}
