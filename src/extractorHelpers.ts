import type { BetterSimTrackerSettings, CustomStatDefinition, StatKey, TrackerData } from "./types";

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

export function shouldBypassConfidenceControls(reason: string): boolean {
  return (
    isManualExtractionReason(reason)
    || reason === "USER_MESSAGE_EDITED"
    || reason === "MESSAGE_EDITED"
  );
}

export function hasManualTrackerEdits(data: TrackerData | null | undefined): boolean {
  return Boolean(data && Number.isFinite(Number(data.manualEditTimestamp)) && Number(data.manualEditTimestamp) > 0);
}

export function resolveBaselineBeforeIndex(input: {
  targetMessageIndex?: number;
  lastIndex: number;
}): number {
  if (typeof input.targetMessageIndex === "number" && input.targetMessageIndex >= 0) {
    return input.targetMessageIndex;
  }
  return input.lastIndex;
}

export function applyConfidenceScaledDelta(input: {
  previousValue: number;
  delta: number;
  confidence: number;
  confidenceDampening: number;
  maxDeltaPerTurn: number;
  bypassConfidenceControls?: boolean;
}): number {
  const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
  const conf = Math.max(0, Math.min(1, Number(input.confidence) || 0));
  const damp = input.bypassConfidenceControls
    ? 0
    : Math.max(0, Math.min(1, Number(input.confidenceDampening) || 0));
  const scale = (1 - damp) + conf * damp;
  const limit = Math.max(1, Math.round(Number(input.maxDeltaPerTurn) || 15));
  const bounded = Math.max(-limit, Math.min(limit, Number(input.delta) || 0));
  const scaledDelta = Math.round(bounded * scale);
  return clamp(Number(input.previousValue) + scaledDelta);
}

export function resolveMoodWithConfidence(input: {
  previousMood: string;
  nextMood: string;
  confidence: number;
  moodStickiness: number;
  bypassConfidenceControls?: boolean;
}): string {
  if (input.bypassConfidenceControls) return input.nextMood;
  const conf = Math.max(0, Math.min(1, Number(input.confidence) || 0));
  const stick = Math.max(0, Math.min(1, Number(input.moodStickiness) || 0));
  return conf < stick ? input.previousMood : input.nextMood;
}
