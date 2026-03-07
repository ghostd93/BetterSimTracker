import { GLOBAL_TRACKER_KEY } from "./constants";
import type { TrackerData } from "./types";

export type GraphNumericStatDefinition = {
  key: string;
  defaultValue: number;
  globalScope: boolean;
};

const BUILT_IN_NUMERIC_STAT_KEYS = new Set(["affection", "trust", "desire", "connection"]);

function getNumericRawValue(
  entry: TrackerData,
  key: string,
  name: string,
  globalScope = false,
): number | undefined {
  if (BUILT_IN_NUMERIC_STAT_KEYS.has(key)) {
    const raw = entry.statistics[key as "affection" | "trust" | "desire" | "connection"]?.[name];
    if (raw === undefined) return undefined;
    return Number(raw);
  }

  const byOwner = entry.customStatistics?.[key];
  if (!byOwner) return undefined;
  const legacyFallback = (): number | undefined => {
    for (const [owner, value] of Object.entries(byOwner)) {
      if (owner === GLOBAL_TRACKER_KEY) continue;
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
  };

  const customRaw = globalScope
    ? (byOwner[GLOBAL_TRACKER_KEY] ?? byOwner[name] ?? legacyFallback())
    : (byOwner[name] ?? byOwner[GLOBAL_TRACKER_KEY]);
  if (customRaw === undefined) return undefined;
  return Number(customRaw);
}

export function hasNumericSnapshot(
  entry: TrackerData,
  character: string,
  defs: GraphNumericStatDefinition[],
): boolean {
  for (const def of defs) {
    const raw = getNumericRawValue(entry, def.key, character, def.globalScope);
    if (raw !== undefined && !Number.isNaN(raw)) return true;
  }
  return false;
}

export function buildStatSeries(
  timeline: TrackerData[],
  character: string,
  def: GraphNumericStatDefinition,
): number[] {
  let carry = Math.max(0, Math.min(100, Math.round(def.defaultValue)));
  return timeline.map(item => {
    const raw = getNumericRawValue(item, def.key, character, def.globalScope);
    if (raw !== undefined && !Number.isNaN(raw)) {
      carry = Math.max(0, Math.min(100, raw));
    }
    return carry;
  });
}
