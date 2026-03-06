import { GLOBAL_TRACKER_KEY } from "./constants";
import type { BetterSimTrackerSettings, TrackerData } from "./types";

export function hasCharacterOwnedTrackedValueForCharacter(
  data: TrackerData,
  characterName: string,
  settingsInput: BetterSimTrackerSettings,
): boolean {
  if (settingsInput.trackAffection && data.statistics.affection[characterName] !== undefined) return true;
  if (settingsInput.trackTrust && data.statistics.trust[characterName] !== undefined) return true;
  if (settingsInput.trackDesire && data.statistics.desire[characterName] !== undefined) return true;
  if (settingsInput.trackConnection && data.statistics.connection[characterName] !== undefined) return true;
  if (settingsInput.trackMood && data.statistics.mood[characterName] !== undefined) return true;
  if (settingsInput.trackLastThought && data.statistics.lastThought[characterName] !== undefined) return true;

  const customDefs = Array.isArray(settingsInput.customStats) ? settingsInput.customStats : [];
  for (const def of customDefs) {
    if (!def.track) continue;
    if (def.globalScope) continue;
    const statId = String(def.id ?? "").trim().toLowerCase();
    if (!statId) continue;
    const kind = def.kind ?? "numeric";
    if (kind === "numeric") {
      if (data.customStatistics?.[statId]?.[characterName] !== undefined) return true;
      continue;
    }
    if (data.customNonNumericStatistics?.[statId]?.[characterName] !== undefined) return true;
  }

  return false;
}

export function overlayLatestGlobalCustomStats(
  base: TrackerData,
  latest: TrackerData | null,
  settingsInput: BetterSimTrackerSettings,
): TrackerData {
  if (!latest) return base;
  const customDefs = Array.isArray(settingsInput.customStats) ? settingsInput.customStats : [];
  const globalDefs = customDefs.filter(def => Boolean(def.track) && Boolean(def.globalScope));
  if (!globalDefs.length) return base;

  const next: TrackerData = {
    ...base,
    customStatistics: { ...(base.customStatistics ?? {}) },
    customNonNumericStatistics: { ...(base.customNonNumericStatistics ?? {}) },
  };
  const nextCustomNumeric = next.customStatistics ?? (next.customStatistics = {});
  const nextCustomNonNumeric = next.customNonNumericStatistics ?? (next.customNonNumericStatistics = {});

  for (const def of globalDefs) {
    const statId = String(def.id ?? "").trim().toLowerCase();
    if (!statId) continue;
    const kind = def.kind ?? "numeric";
    if (kind === "numeric") {
      const raw = latest.customStatistics?.[statId]?.[GLOBAL_TRACKER_KEY];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        const byOwner = { ...(nextCustomNumeric[statId] ?? {}) };
        byOwner[GLOBAL_TRACKER_KEY] = raw;
        nextCustomNumeric[statId] = byOwner;
      }
      continue;
    }
    const raw = latest.customNonNumericStatistics?.[statId]?.[GLOBAL_TRACKER_KEY];
    if (raw !== undefined) {
      const byOwner = { ...(nextCustomNonNumeric[statId] ?? {}) };
      byOwner[GLOBAL_TRACKER_KEY] = raw;
      nextCustomNonNumeric[statId] = byOwner;
    }
  }

  return next;
}

