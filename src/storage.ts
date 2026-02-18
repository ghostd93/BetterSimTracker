import { EXTENSION_KEY, STAT_KEYS } from "./constants";
import { isTrackableAiMessage } from "./messageFilter";
import type { ChatMessage, STContext, Statistics, TrackerData } from "./types";
const CHAT_STATE_KEY = `${EXTENSION_KEY}:chat`;

function createEmptyStatistics(): Statistics {
  return {
    affection: {},
    trust: {},
    desire: {},
    connection: {},
    mood: {},
    lastThought: {}
  };
}

export function getTrackerDataFromMessage(message: ChatMessage): TrackerData | null {
  const raw = message.extra?.[EXTENSION_KEY];
  const data = resolveTrackerDataForSwipe(message, raw);
  if (!data) return null;
  return normalizeTrackerData(data);
}

function normalizeTrackerData(data: Partial<TrackerData>): TrackerData {
  return {
    timestamp: Number(data.timestamp ?? Date.now()),
    activeCharacters: Array.isArray(data.activeCharacters) ? data.activeCharacters : [],
    statistics: {
      ...createEmptyStatistics(),
      ...(data.statistics as Statistics)
    }
  };
}

function isTrackerPayload(raw: unknown): raw is Partial<TrackerData> {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as Partial<TrackerData>;
  if (!data.statistics || !data.activeCharacters) return false;
  return true;
}

function resolveTrackerDataForSwipe(message: ChatMessage, raw: unknown): Partial<TrackerData> | null {
  if (!raw || typeof raw !== "object") return null;
  if (isTrackerPayload(raw)) {
    return raw;
  }

  const storage = raw as Record<string, unknown>;
  const swipeId = Number(message.swipe_id ?? 0);
  const swipeKey = String(Number.isNaN(swipeId) ? 0 : swipeId);

  const exact = storage[swipeKey];
  if (isTrackerPayload(exact)) return exact;

  const zero = storage["0"];
  if (isTrackerPayload(zero)) return zero;

  for (const value of Object.values(storage)) {
    if (isTrackerPayload(value)) return value;
  }
  return null;
}

export function getLatestTrackerData(context: STContext): TrackerData | null {
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const found = getTrackerDataFromMessage(context.chat[i]);
    if (found) return found;
  }
  return null;
}

export function getLatestTrackerDataWithIndex(context: STContext): { data: TrackerData; messageIndex: number } | null {
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const found = getTrackerDataFromMessage(context.chat[i]);
    if (found) {
      return { data: found, messageIndex: i };
    }
  }
  return null;
}

export function getLatestTrackerDataWithIndexBefore(
  context: STContext,
  beforeIndex: number,
): { data: TrackerData; messageIndex: number } | null {
  const start = Math.min(Math.max(beforeIndex - 1, 0), context.chat.length - 1);
  for (let i = start; i >= 0; i -= 1) {
    const found = getTrackerDataFromMessage(context.chat[i]);
    if (found) {
      return { data: found, messageIndex: i };
    }
  }
  return null;
}

function getScopeKey(context: STContext): string {
  const anyContext = context as unknown as Record<string, unknown>;
  const chatId = String(anyContext.chatId ?? anyContext.chat_id ?? "").trim() || "nochat";
  const target = context.groupId ? `group:${context.groupId}` : `char:${String(context.characterId ?? "unknown")}`;
  return `${chatId}|${target}`;
}

const HISTORY_LIMIT = 120;
const LATEST_BY_SCOPE_KEY = `${EXTENSION_KEY}:latestByScope`;

type SnapshotEntry = { data: TrackerData; timestamp: number; messageIndex?: number };

type SnapshotStore = {
  latest?: { data: TrackerData; messageIndex: number; timestamp: number };
  history: SnapshotEntry[];
};

type ChatStateStore = {
  latest?: { data: TrackerData; messageIndex: number; timestamp: number };
  history: SnapshotEntry[];
};

function normalizeStore(raw: unknown): SnapshotStore {
  if (!raw || typeof raw !== "object") return { history: [] };
  const parsed = raw as Partial<SnapshotStore>;
  if (!Array.isArray(parsed.history)) {
    return { latest: parsed.latest, history: [] };
  }
  return { latest: parsed.latest, history: parsed.history };
}

function getStoreKey(context: STContext): string {
  return `${EXTENSION_KEY}:history:${getScopeKey(context)}`;
}

function readLatestByScopeMap(): Record<string, { data: TrackerData; messageIndex: number; timestamp: number }> {
  try {
    const raw = localStorage.getItem(LATEST_BY_SCOPE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { data: TrackerData; messageIndex: number; timestamp: number }>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeLatestByScopeMap(map: Record<string, { data: TrackerData; messageIndex: number; timestamp: number }>): void {
  try {
    localStorage.setItem(LATEST_BY_SCOPE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function readStore(context: STContext): SnapshotStore {
  const key = getStoreKey(context);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { history: [] };
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { history: [] };
  }
}

function writeStore(context: STContext, store: SnapshotStore): void {
  const key = getStoreKey(context);
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function readMetadataStore(context: STContext): SnapshotStore {
  try {
    const raw = context.chatMetadata?.[EXTENSION_KEY];
    return normalizeStore(raw);
  } catch {
    return { history: [] };
  }
}

function writeMetadataStore(context: STContext, store: SnapshotStore): void {
  try {
    if (!context.chatMetadata) {
      context.chatMetadata = {};
    }
    context.chatMetadata[EXTENSION_KEY] = store;
    context.saveMetadataDebounced?.();
  } catch {
    // ignore
  }
}

function readChatStateStore(context: STContext): ChatStateStore {
  const firstMessage = context.chat?.[0];
  if (!firstMessage?.extra) return { history: [] };
  const raw = firstMessage.extra[CHAT_STATE_KEY];
  return normalizeStore(raw);
}

function writeChatStateStore(context: STContext, store: ChatStateStore): void {
  const firstMessage = context.chat?.[0];
  if (!firstMessage) return;
  if (!firstMessage.extra) {
    firstMessage.extra = {};
  }
  firstMessage.extra[CHAT_STATE_KEY] = store;
}

export function saveTrackerSnapshot(
  context: STContext,
  data: TrackerData,
  messageIndex: number,
): void {
  const timestamp = Date.now();
  const push = (store: SnapshotStore): SnapshotStore => {
    const next: SnapshotStore = {
      ...store,
      latest: { data, messageIndex, timestamp },
      history: [
        { data, timestamp, messageIndex },
        ...store.history.filter(item => item.data.timestamp !== data.timestamp)
      ].slice(0, HISTORY_LIMIT)
    };
    return next;
  };

  writeStore(context, push(readStore(context)));
  writeMetadataStore(context, push(readMetadataStore(context)));
  writeChatStateStore(context, push(readChatStateStore(context)));

  const scope = getScopeKey(context);
  const latestByScope = readLatestByScopeMap();
  latestByScope[scope] = { data, messageIndex, timestamp };
  writeLatestByScopeMap(latestByScope);
}

export function getChatStateLatestTrackerData(context: STContext): { data: TrackerData; messageIndex: number } | null {
  const store = readChatStateStore(context);
  if (!store.latest?.data) return null;
  return {
    data: store.latest.data,
    messageIndex: Number(store.latest.messageIndex ?? -1)
  };
}

export function getMetadataLatestTrackerData(context: STContext): { data: TrackerData; messageIndex: number } | null {
  const metadata = readMetadataStore(context);
  if (!metadata.latest?.data) return null;
  return {
    data: metadata.latest.data,
    messageIndex: Number(metadata.latest.messageIndex ?? -1)
  };
}

export function getLocalLatestTrackerData(context: STContext): { data: TrackerData; messageIndex: number } | null {
  const scoped = readStore(context);
  if (scoped.latest?.data) {
    return { data: scoped.latest.data, messageIndex: Number(scoped.latest.messageIndex ?? -1) };
  }

  const scope = getScopeKey(context);
  const latestByScope = readLatestByScopeMap();
  const scopeEntry = latestByScope[scope];
  if (!scopeEntry?.data) return null;
  return { data: scopeEntry.data, messageIndex: Number(scopeEntry.messageIndex ?? -1) };
}

export function getRecentTrackerHistory(context: STContext, limit: number): TrackerData[] {
  const fromChat: Array<{ data: TrackerData; timestamp: number; messageIndex?: number }> = [];
  for (let i = context.chat.length - 1; i >= 0 && fromChat.length < limit; i -= 1) {
    const found = getTrackerDataFromMessage(context.chat[i]);
    if (found) fromChat.push({ data: found, timestamp: found.timestamp, messageIndex: i });
  }

  if (fromChat.length >= limit) return fromChat.slice(0, limit).map(item => item.data);

  const localStore = readStore(context);
  const metadataStore = readMetadataStore(context);
  const chatStateStore = readChatStateStore(context);
  const combinedHistory = [...chatStateStore.history, ...metadataStore.history, ...localStore.history];

  const byMessageIndex = new Map<number, SnapshotEntry>();
  for (const entry of fromChat) {
    if (entry.messageIndex != null) {
      byMessageIndex.set(entry.messageIndex, entry);
    }
  }

  for (const entry of combinedHistory) {
    if (!entry?.data) continue;
    if (entry.messageIndex == null) continue;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) continue;
    const message = context.chat[entry.messageIndex];
    if (!isTrackableAiMessage(message)) continue;
    const existing = byMessageIndex.get(entry.messageIndex);
    if (!existing || entry.timestamp > existing.timestamp) {
      byMessageIndex.set(entry.messageIndex, entry);
    }
  }

  const merged: SnapshotEntry[] = [
    ...byMessageIndex.values()
  ].sort((a, b) => b.timestamp - a.timestamp);

  return merged.slice(0, limit).map(item => item.data);
}

export function writeTrackerDataToLastMessage(
  context: STContext,
  data: TrackerData,
): void {
  const lastIndex = context.chat.length - 1;
  writeTrackerDataToMessage(context, data, lastIndex);
}

export function writeTrackerDataToMessage(
  context: STContext,
  data: TrackerData,
  messageIndex: number,
): void {
  if (messageIndex < 0 || messageIndex >= context.chat.length) return;
  const message = context.chat[messageIndex];
  if (!message.extra) {
    message.extra = {};
  }
  const swipeId = Number(message.swipe_id ?? 0);
  const swipeKey = String(Number.isNaN(swipeId) ? 0 : swipeId);
  const existing = message.extra[EXTENSION_KEY];

  const swipeStorage: Record<string, TrackerData> = {};
  if (existing && typeof existing === "object") {
    if (isTrackerPayload(existing)) {
      swipeStorage["0"] = normalizeTrackerData(existing);
    } else {
      for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
        if (isTrackerPayload(value)) {
          swipeStorage[key] = normalizeTrackerData(value);
        }
      }
    }
  }

  swipeStorage[swipeKey] = data;
  message.extra[EXTENSION_KEY] = swipeStorage;
  saveTrackerSnapshot(context, data, messageIndex);
}

export function mergeStatisticsWithFallback(
  incoming: Statistics,
  previous: Statistics | null,
): Statistics {
  const merged = createEmptyStatistics();

  for (const stat of STAT_KEYS) {
    const nextValues = incoming[stat] ?? {};
    const prevValues = previous?.[stat] ?? {};
    merged[stat] = { ...prevValues, ...nextValues };
  }

  return merged;
}

export function clearTrackerDataForCurrentChat(context: STContext): void {
  for (const message of context.chat) {
    if (!message.extra) continue;
    delete message.extra[EXTENSION_KEY];
  }

  const firstMessage = context.chat?.[0];
  if (firstMessage?.extra) {
    delete firstMessage.extra[CHAT_STATE_KEY];
  }

  if (context.chatMetadata && Object.prototype.hasOwnProperty.call(context.chatMetadata, EXTENSION_KEY)) {
    delete context.chatMetadata[EXTENSION_KEY];
    context.saveMetadataDebounced?.();
  }

  const scopeKey = getStoreKey(context);
  try {
    localStorage.removeItem(scopeKey);
  } catch {
    // ignore
  }

  try {
    const scope = getScopeKey(context);
    const map = readLatestByScopeMap();
    if (Object.prototype.hasOwnProperty.call(map, scope)) {
      delete map[scope];
      writeLatestByScopeMap(map);
    }
  } catch {
    // ignore
  }
}
