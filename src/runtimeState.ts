import { getChatStateLatestTrackerData, getLatestTrackerDataWithIndex, getLocalLatestTrackerData, getMetadataLatestTrackerData, getRecentTrackerHistoryEntries, mergeCustomNonNumericStatisticsWithFallback, mergeCustomStatisticsWithFallback, mergeStatisticsWithFallback } from "./storage";
import { isTrackableMessage } from "./messageFilter";
import type { CustomNonNumericStatistics, CustomStatistics, STContext, Statistics, TrackerData } from "./types";

export type StoredTrackerSource = "message" | "chatState" | "metadata" | "local" | "none";

export function buildMergedPromptMacroData(
  context: STContext,
  preferred: TrackerData | null,
): TrackerData | null {
  const historyEntries = getRecentTrackerHistoryEntries(context, Math.max(120, context.chat.length + 8));
  const entries = [...historyEntries].sort((a, b) => {
    if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
    return a.timestamp - b.timestamp;
  });

  if (!entries.length) {
    return preferred ? { ...preferred } : null;
  }

  let mergedStatistics: Statistics | null = null;
  let mergedCustomStatistics: CustomStatistics | null = null;
  let mergedCustomNonNumericStatistics: CustomNonNumericStatistics | null = null;
  let lastTimestamp = 0;
  let fallbackActiveCharacters: string[] = [];

  for (const entry of entries) {
    mergedStatistics = mergeStatisticsWithFallback(entry.data.statistics, mergedStatistics, undefined);
    mergedCustomStatistics = mergeCustomStatisticsWithFallback(entry.data.customStatistics, mergedCustomStatistics);
    mergedCustomNonNumericStatistics = mergeCustomNonNumericStatisticsWithFallback(
      entry.data.customNonNumericStatistics,
      mergedCustomNonNumericStatistics,
    );
    lastTimestamp = Math.max(lastTimestamp, Number(entry.data.timestamp ?? entry.timestamp ?? 0));
    if (Array.isArray(entry.data.activeCharacters) && entry.data.activeCharacters.length) {
      fallbackActiveCharacters = entry.data.activeCharacters.map(name => String(name ?? "").trim()).filter(Boolean);
    }
  }

  const preferredActiveCharacters = Array.isArray(preferred?.activeCharacters)
    ? preferred.activeCharacters.map(name => String(name ?? "").trim()).filter(Boolean)
    : [];

  return {
    timestamp: lastTimestamp || Number(preferred?.timestamp ?? Date.now()),
    activeCharacters: preferredActiveCharacters.length ? preferredActiveCharacters : fallbackActiveCharacters,
    statistics: mergedStatistics ?? {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customStatistics: mergedCustomStatistics ?? {},
    customNonNumericStatistics: mergedCustomNonNumericStatistics ?? {},
  };
}

export function resolveLatestStoredTrackerData(
  context: STContext,
  lastTrackableIndex: number | null,
): { source: StoredTrackerSource; data: TrackerData | null; messageIndex: number | null } {
  const latestEntry = getLatestTrackerDataWithIndex(context);
  const chatStateEntry = getChatStateLatestTrackerData(context);
  const metadataEntry = getMetadataLatestTrackerData(context);
  const localEntry = getLocalLatestTrackerData(context);

  const isEntrySafeForCurrentLastAi = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (lastTrackableIndex == null) return false;
    if (entry.messageIndex !== lastTrackableIndex) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    return isTrackableMessage(context.chat[entry.messageIndex]);
  };
  const isEntrySafeForAnyChatMessage = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    return isTrackableMessage(context.chat[entry.messageIndex]);
  };

  if (isEntrySafeForAnyChatMessage(latestEntry)) {
    return { source: "message", data: latestEntry!.data, messageIndex: latestEntry!.messageIndex };
  }
  if (isEntrySafeForCurrentLastAi(chatStateEntry)) {
    return { source: "chatState", data: chatStateEntry!.data, messageIndex: chatStateEntry!.messageIndex };
  }
  if (isEntrySafeForCurrentLastAi(metadataEntry)) {
    return { source: "metadata", data: metadataEntry!.data, messageIndex: metadataEntry!.messageIndex };
  }
  if (isEntrySafeForCurrentLastAi(localEntry)) {
    return { source: "local", data: localEntry!.data, messageIndex: localEntry!.messageIndex };
  }
  return { source: "none", data: null, messageIndex: null };
}
