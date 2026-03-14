import { getChatStateLatestTrackerData, getLatestTrackerDataWithIndex, getLocalLatestTrackerData, getMetadataLatestTrackerData, getRecentTrackerHistoryEntries, mergeTrackerDataChronologically } from "./storage";
import { isTrackableMessage } from "./messageFilter";
import type { STContext, TrackerData } from "./types";

export type StoredTrackerSource = "message" | "chatState" | "metadata" | "local" | "none";

export function buildMergedPromptMacroData(
  context: STContext,
  preferred: TrackerData | null,
): TrackerData | null {
  const historyEntries = getRecentTrackerHistoryEntries(context, Math.max(120, context.chat.length + 8));
  const entries: Array<{
    data: TrackerData;
    timestamp: number;
    messageIndex: number | null;
    preferred: boolean;
  }> = historyEntries.map(entry => ({
    data: entry.data,
    timestamp: Number(entry.data.timestamp ?? entry.timestamp ?? 0),
    messageIndex: entry.messageIndex,
    preferred: false,
  }));

  if (preferred) {
    entries.push({
      data: preferred,
      timestamp: Number(preferred.timestamp ?? 0),
      messageIndex: null,
      preferred: true,
    });
  }

  entries.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.messageIndex == null && b.messageIndex != null) return 1;
    if (a.messageIndex != null && b.messageIndex == null) return -1;
    if (a.messageIndex != null && b.messageIndex != null && a.messageIndex !== b.messageIndex) {
      return a.messageIndex - b.messageIndex;
    }
    return Number(a.preferred) - Number(b.preferred);
  });

  if (!entries.length) {
    return preferred ? { ...preferred } : null;
  }

  const merged = mergeTrackerDataChronologically(entries.map(entry => entry.data));
  if (!merged) {
    return preferred ? { ...preferred } : null;
  }

  const preferredActiveCharacters = Array.isArray(preferred?.activeCharacters)
    ? preferred.activeCharacters.map(name => String(name ?? "").trim()).filter(Boolean)
    : [];

  return {
    ...merged,
    activeCharacters: preferredActiveCharacters.length ? preferredActiveCharacters : merged.activeCharacters,
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
