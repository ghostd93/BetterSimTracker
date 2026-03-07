import type { BetterSimTrackerSettings, CustomStatDefinition, StatKey } from "./types";

export function enabledBuiltInAndTextStats(settings: BetterSimTrackerSettings): StatKey[] {
  const selected: StatKey[] = [];
  if (settings.trackAffection) selected.push("affection");
  if (settings.trackTrust) selected.push("trust");
  if (settings.trackDesire) selected.push("desire");
  if (settings.trackConnection) selected.push("connection");
  if (settings.trackMood) selected.push("mood");
  if (settings.trackLastThought) selected.push("lastThought");
  return selected;
}

export function enabledCustomStats(settings: BetterSimTrackerSettings): CustomStatDefinition[] {
  if (!Array.isArray(settings.customStats)) return [];
  return settings.customStats.filter(def => Boolean(def.track));
}

export function normalizeSequentialGroupId(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/[^a-z0-9_\-]/g, "_").replace(/_+/g, "_").slice(0, 32);
}

export function groupCustomStatsForSequential(
  stats: CustomStatDefinition[],
  enabled: boolean,
): CustomStatDefinition[][] {
  if (!stats.length) return [];
  if (!enabled) return stats.map(stat => [stat]);
  const groupsById = new Map<string, CustomStatDefinition[]>();
  const solo: CustomStatDefinition[][] = [];
  for (const stat of stats) {
    const key = normalizeSequentialGroupId((stat as { sequentialGroup?: string }).sequentialGroup);
    if (!key) {
      solo.push([stat]);
      continue;
    }
    const bucket = groupsById.get(key) ?? [];
    bucket.push(stat);
    groupsById.set(key, bucket);
  }
  return [...groupsById.values(), ...solo];
}

export function isManualExtractionReason(reason: string): boolean {
  return reason === "manual_refresh" || reason === "manual_refresh_retry";
}
