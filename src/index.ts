import { getAllTrackedCharacterNames, buildRecentContext, resolveActiveCharacterAnalysis } from "./activity";
import type { Character } from "./types";
import { extractStatisticsParallel } from "./extractor";
import { isTrackableAiMessage } from "./messageFilter";
import { clearPromptInjection, getLastInjectedPrompt, syncPromptInjection } from "./promptInjection";
import { upsertSettingsPanel } from "./settingsPanel";
import { discoverConnectionProfiles, getActiveConnectionProfileId, getContext, getSettingsProvenance, loadSettings, logDebug, saveSettings } from "./settings";
import { clearTrackerDataForCurrentChat, getChatStateLatestTrackerData, getLatestTrackerDataWithIndex, getLatestTrackerDataWithIndexBefore, getLocalLatestTrackerData, getMetadataLatestTrackerData, getRecentTrackerHistory, getRecentTrackerHistoryEntries, getTrackerDataFromMessage, mergeStatisticsWithFallback, writeTrackerDataToMessage } from "./storage";
import type { BetterSimTrackerSettings, DeltaDebugRecord, STContext, TrackerData } from "./types";
import { closeGraphModal, closeSettingsModal, getGraphPreferences, openGraphModal, openSettingsModal, removeTrackerUI, renderTracker, type TrackerUiState } from "./ui";
import { cancelActiveGenerations } from "./generator";
import { registerSlashCommands } from "./slashCommands";
import { initCharacterPanel } from "./characterPanel";

let settings: BetterSimTrackerSettings | null = null;
let isExtracting = false;
let runSequence = 0;
let allCharacterNames: string[] = [];
let latestData: TrackerData | null = null;
let latestDataMessageIndex: number | null = null;
let trackerUiState: TrackerUiState = { phase: "idle", done: 0, total: 0, messageIndex: null, stepLabel: null };
let renderQueued = false;
let extractionTimer: number | null = null;
let swipeExtractionTimer: number | null = null;
let pendingSwipeExtraction: { reason: string; messageIndex?: number; waitForGenerationEnd?: boolean } | null = null;
let lastDebugRecord: DeltaDebugRecord | null = null;
let refreshTimer: number | null = null;
let lastPromptSyncSignature = "";
let debugTrace: string[] = [];
let traceCacheKey: string | null = null;
let traceCacheLines: string[] = [];
let lastActivityAnalysis: { allCharacterNames: string[]; activeCharacters: string[]; reasons: Record<string, string>; lookback: number } | null = null;
let chatGenerationInFlight = false;
let chatGenerationSawCharacterRender = false;
let chatGenerationStartLastAiIndex: number | null = null;
let swipeGenerationActive = false;
let slashCommandsRegistered = false;
let activeExtractionRunId: number | null = null;

function getTraceStorageKey(context: STContext): string {
  return `${getDebugScopeKey(context)}:trace`;
}

function readTraceLines(context: STContext): string[] {
  try {
    const key = getTraceStorageKey(context);
    if (traceCacheKey === key) return [...traceCacheLines];
    const raw = localStorage.getItem(key);
    if (!raw) {
      traceCacheKey = key;
      traceCacheLines = [];
      return [];
    }
    const parsed = JSON.parse(raw) as { lines?: unknown };
    const lines = Array.isArray(parsed?.lines)
      ? parsed.lines.filter(line => typeof line === "string") as string[]
      : [];
    traceCacheKey = key;
    traceCacheLines = lines;
    return [...lines];
  } catch {
    return [];
  }
}

function writeTraceLines(context: STContext, lines: string[]): void {
  try {
    const key = getTraceStorageKey(context);
    traceCacheKey = key;
    traceCacheLines = [...lines];
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), lines }));
  } catch {
    // ignore
  }
}

function pushTrace(event: string, details?: Record<string, unknown>): void {
  if (!settings?.debug) return;
  const stamp = new Date().toISOString();
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  const line = `${stamp} ${event}${payload}`;
  debugTrace.push(line);
  if (debugTrace.length > 200) {
    debugTrace.splice(0, debugTrace.length - 200);
  }
  const context = getSafeContext();
  if (context) {
    const persisted = readTraceLines(context);
    persisted.push(line);
    const capped = persisted.slice(-1000);
    writeTraceLines(context, capped);
  }
  logDebug(settings, "ui", event, details ?? {});
}

function getDebugScopeKey(context: STContext): string {
  const anyContext = context as unknown as Record<string, unknown>;
  const chatId = String(anyContext.chatId ?? anyContext.chat_id ?? "").trim() || "nochat";
  const target = context.groupId ? `group:${context.groupId}` : `char:${String(context.characterId ?? "unknown")}`;
  return `bst-debug:${chatId}|${target}`;
}

function getDebugTargetSuffix(context: STContext): string {
  return `|${context.groupId ? `group:${context.groupId}` : `char:${String(context.characterId ?? "unknown")}`}`;
}

function saveDebugRecord(context: STContext, record: DeltaDebugRecord | null): void {
  try {
    if (!record) return;
    localStorage.setItem(getDebugScopeKey(context), JSON.stringify({
      savedAt: Date.now(),
      record
    }));
  } catch {
    // ignore
  }
}

function loadDebugRecord(context: STContext): DeltaDebugRecord | null {
  try {
    const scoped = localStorage.getItem(getDebugScopeKey(context));
    if (scoped) {
      const parsed = JSON.parse(scoped) as { savedAt?: number; record?: DeltaDebugRecord } | DeltaDebugRecord;
      if ((parsed as { record?: DeltaDebugRecord }).record) {
        return (parsed as { record: DeltaDebugRecord }).record;
      }
      return parsed as DeltaDebugRecord;
    }

    const suffix = getDebugTargetSuffix(context);
    let best: { record: DeltaDebugRecord; savedAt: number } | null = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("bst-debug:")) continue;
      if (!key.endsWith(suffix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { savedAt?: number; record?: DeltaDebugRecord } | DeltaDebugRecord;
      const record = (parsed as { record?: DeltaDebugRecord }).record ?? (parsed as DeltaDebugRecord);
      const savedAt = Number((parsed as { savedAt?: number }).savedAt ?? 0);
      if (!best || savedAt > best.savedAt) {
        best = { record, savedAt };
      }
    }
    return best?.record ?? null;
  } catch {
    return null;
  }
}

function clearDebugRecord(context: STContext): void {
  try {
    localStorage.removeItem(getDebugScopeKey(context));
    localStorage.removeItem(getTraceStorageKey(context));
    traceCacheKey = null;
    traceCacheLines = [];
  } catch {
    // ignore
  }
}

function getLastAiMessageIndex(context: STContext): number | null {
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const message = context.chat[i];
    if (isTrackableAiMessage(message)) return i;
  }
  return null;
}

function getLastMessageIndexIfAi(context: STContext): number | null {
  return getLastAiMessageIndex(context);
}

function isRenderableTrackerIndex(context: STContext, index: number): boolean {
  if (index < 0) return false;
  if (index >= context.chat.length) return true;
  return isTrackableAiMessage(context.chat[index]);
}

function getGenerationTargetMessageIndex(context: STContext): number | null {
  // Generation-start timing differs:
  // - If last message is already user => next AI will be at chat.length.
  // - If last message is AI (user message not inserted yet) => next AI will be at chat.length + 1.
  const last = context.chat[context.chat.length - 1];
  if (last && isTrackableAiMessage(last)) {
    return context.chat.length + 1;
  }
  return context.chat.length;
}

function queueRender(): void {
  if (!settings) return;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!settings) return;
    const context = getSafeContext();
    const entries: Array<{ messageIndex: number; data: TrackerData | null }> = [];

    if (context) {
      for (let i = 0; i < context.chat.length; i += 1) {
        const message = context.chat[i];
        if (!isTrackableAiMessage(message)) continue;
        const data = getTrackerDataFromMessage(message);
        if (!data) continue;
        entries.push({ messageIndex: i, data });
      }
    }

    if (latestData && latestDataMessageIndex != null && !entries.some(entry => entry.messageIndex === latestDataMessageIndex)) {
      entries.push({ messageIndex: latestDataMessageIndex, data: latestData });
    }

    if (
      trackerUiState.phase === "extracting" &&
      trackerUiState.messageIndex != null &&
      context &&
      isRenderableTrackerIndex(context, trackerUiState.messageIndex) &&
      !entries.some(entry => entry.messageIndex === trackerUiState.messageIndex)
    ) {
      entries.push({ messageIndex: trackerUiState.messageIndex, data: null });
    }
    if (
      trackerUiState.phase === "generating" &&
      trackerUiState.messageIndex != null &&
      context &&
      isRenderableTrackerIndex(context, trackerUiState.messageIndex) &&
      !entries.some(entry => entry.messageIndex === trackerUiState.messageIndex)
    ) {
      entries.push({ messageIndex: trackerUiState.messageIndex, data: null });
    }
    pushTrace("render.queue", {
      entries: entries.length,
      uiPhase: trackerUiState.phase,
      uiMessageIndex: trackerUiState.messageIndex,
      latestDataMessageIndex
    });

    const latestAiIndex = context ? getLastAiMessageIndex(context) : null;
    renderTracker(entries, settings, allCharacterNames, Boolean(context?.groupId), trackerUiState, latestAiIndex, characterName => {
      const context = getSafeContext();
      if (!context || !settings) return;
      const history = getRecentTrackerHistory(context, 120);
      if (history.length === 0 && latestData) {
        history.push(latestData);
      }
      const graphSummary = summarizeGraphSeries(history, characterName);
      pushTrace("graph.open", {
        character: characterName,
        historySnapshots: history.length,
        snapshots: graphSummary.snapshots,
        fromTs: graphSummary.fromTs,
        toTs: graphSummary.toTs,
        latest: graphSummary.latest,
        series: graphSummary.series
      });
      openGraphModal({
        character: characterName,
        history,
        accentColor: settings.accentColor,
        settings,
        debug: settings.debug
      });
    }, messageIndex => {
      void runExtraction("manual_refresh", messageIndex);
    }, () => {
      if (!isExtracting) return;
      const canceled = cancelActiveGenerations();
      pushTrace("extract.cancel", { canceled, source: "ui" });
    }, () => {
      queueRender();
    });
  });
}

function queuePromptSync(context: STContext): void {
  if (!settings) return;
  const signature = [
    settings.enabled ? "1" : "0",
    settings.injectTrackerIntoPrompt ? "1" : "0",
    latestData?.timestamp ?? 0,
    context.groupId ?? "",
    context.characterId ?? "",
  ].join("|");
  if (signature === lastPromptSyncSignature) {
    pushTrace("prompt.sync.skip", { reason: "signature_unchanged" });
    return;
  }
  pushTrace("prompt.sync", {
    hasData: Boolean(latestData),
    groupId: context.groupId ?? null,
    characterId: context.characterId ?? null
  });
  lastPromptSyncSignature = signature;
  void syncPromptInjection({
    context,
    settings,
    data: latestData
  });
}

function scheduleRefresh(delay = 80): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    pushTrace("refresh.run", { delay });
    refreshFromStoredData();
  }, delay);
}

function scheduleExtraction(reason: string, targetMessageIndex?: number): void {
  if (extractionTimer !== null) {
    window.clearTimeout(extractionTimer);
  }
  extractionTimer = window.setTimeout(() => {
    extractionTimer = null;
    pushTrace("extract.schedule.fire", { reason, targetMessageIndex: targetMessageIndex ?? null });
    void runExtraction(reason, targetMessageIndex);
  }, 180);
}

function scheduleSwipeExtraction(reason: string, targetMessageIndex?: number): void {
  pendingSwipeExtraction = { reason, messageIndex: targetMessageIndex, waitForGenerationEnd: false };
  if (swipeExtractionTimer !== null) {
    window.clearTimeout(swipeExtractionTimer);
  }
  swipeExtractionTimer = window.setTimeout(() => {
    const pending = pendingSwipeExtraction;
    pendingSwipeExtraction = null;
    swipeExtractionTimer = null;
    if (!pending || pending.waitForGenerationEnd) return;
    pushTrace("extract.swipe.timeout", { reason: pending.reason, targetMessageIndex: pending.messageIndex ?? null });
    scheduleExtraction(pending.reason, pending.messageIndex);
  }, 2500);
}

function clearPendingSwipeExtraction(): void {
  pendingSwipeExtraction = null;
  if (swipeExtractionTimer !== null) {
    window.clearTimeout(swipeExtractionTimer);
    swipeExtractionTimer = null;
  }
}

function setTrackerUi(context: STContext, next: TrackerUiState): void {
  const prev = trackerUiState;
  trackerUiState = next;
  pushTrace("ui.phase", {
    from: prev.phase,
    to: next.phase,
    messageIndex: next.messageIndex
  });
  if (next.phase !== "idle") {
    context.deactivateSendButtons?.();
  } else {
    context.activateSendButtons?.();
  }
}

function buildBaselineData(activeCharacters: string[], s: BetterSimTrackerSettings): TrackerData {
  const context = getSafeContext();
  const charByName = new Map((context?.characters ?? []).map(character => [character.name, character]));

  const pickNumber = (raw: unknown, fallback: number): number => {
    const n = Number(raw);
    if (Number.isNaN(n)) return fallback;
    return Math.max(0, Math.min(100, n));
  };

  const pickText = (raw: unknown, fallback: string): string => {
    if (typeof raw !== "string" || !raw.trim()) return fallback;
    return raw.trim();
  };

  const inferFromContext = (name: string): {
    affection: number;
    trust: number;
    desire: number;
    connection: number;
    mood: string;
  } => {
    const recent = (context?.chat ?? []).slice(-Math.max(8, s.contextMessages));
    const lines = recent
      .filter(message => {
        if (message.is_system) return false;
        const speaker = String(message.name ?? "");
        return speaker === name || message.is_user;
      })
      .map(message => String(message.mes ?? "").toLowerCase());
    const joined = lines.join("\n");
    const count = (re: RegExp): number => (joined.match(re) ?? []).length;
    const pos = count(/\b(love|care|trust|safe|support|hug|kiss|thank|gentle|close|warm|happy)\b/g);
    const neg = count(/\b(hate|angry|mad|fight|betray|jealous|cold|distant|ignore|fear|resent)\b/g);
    const romantic = count(/\b(kiss|touch|desire|want you|flirt|blush|attract|yearn|tease)\b/g);
    const affinity = Math.max(-30, Math.min(30, (pos - neg) * 4));
    const attraction = Math.max(-25, Math.min(25, romantic * 6 - Math.max(0, neg - pos) * 3));
    const mood = neg > pos ? "Frustrated" : romantic > 0 ? "Hopeful" : pos > 0 ? "Content" : "Neutral";

    return {
      affection: Math.max(0, Math.min(100, Math.round(45 + affinity))),
      trust: Math.max(0, Math.min(100, Math.round(45 + Math.max(-25, Math.min(25, (pos - neg) * 3))))),
      desire: Math.max(0, Math.min(100, Math.round(35 + attraction))),
      connection: Math.max(0, Math.min(100, Math.round(48 + Math.max(-28, Math.min(28, (pos - neg) * 3 + Math.floor(pos / 2)))))),
      mood
    };
  };

  const getCardDefaults = (name: string): {
    affection: number;
    trust: number;
    desire: number;
    connection: number;
    mood: string;
  } => {
    const contextual = inferFromContext(name);

    const character = charByName.get(name);

    const extFromCharacter = character?.extensions as Record<string, unknown> | undefined;
    const extFromData = character?.data?.extensions as Record<string, unknown> | undefined;
    const own = ((extFromCharacter?.bettersimtracker ?? extFromData?.bettersimtracker) as Record<string, unknown> | undefined);
    const defaultsFromExtensions = (own?.defaults as Record<string, unknown> | undefined) ?? {};
    const defaultsFromSettings = (s.characterDefaults?.[name] as Record<string, unknown> | undefined) ?? {};
    const defaults = { ...defaultsFromSettings, ...defaultsFromExtensions };
    const hasAnyExplicitDefaults =
      defaults.affection !== undefined ||
      defaults.trust !== undefined ||
      defaults.desire !== undefined ||
      defaults.connection !== undefined ||
      defaults.mood !== undefined;

    if (hasAnyExplicitDefaults) {
      return {
        affection: pickNumber(defaults.affection, contextual.affection),
        trust: pickNumber(defaults.trust, contextual.trust),
        desire: pickNumber(defaults.desire, contextual.desire),
        connection: pickNumber(defaults.connection, contextual.connection),
        mood: pickText(defaults.mood, contextual.mood)
      };
    }

    return contextual;
  };

  return {
    timestamp: Date.now(),
    activeCharacters,
    statistics: {
      affection: Object.fromEntries(activeCharacters.map(name => [name, getCardDefaults(name).affection])),
      trust: Object.fromEntries(activeCharacters.map(name => [name, getCardDefaults(name).trust])),
      desire: Object.fromEntries(activeCharacters.map(name => [name, getCardDefaults(name).desire])),
      connection: Object.fromEntries(activeCharacters.map(name => [name, getCardDefaults(name).connection])),
      mood: Object.fromEntries(activeCharacters.map(name => [name, getCardDefaults(name).mood])),
      lastThought: Object.fromEntries(activeCharacters.map(name => [name, ""]))
    }
  };
}

function getSafeContext(): STContext | null {
  return getContext();
}

function getEventMessageIndex(payload: unknown): number | null {
  if (typeof payload === "number") return Number.isInteger(payload) ? payload : null;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidate = obj.message ?? obj.messageId ?? obj.id;
  if (typeof candidate !== "number") return null;
  return Number.isInteger(candidate) ? candidate : null;
}

function summarizeGraphSeries(history: TrackerData[], characterName: string): {
  snapshots: number;
  fromTs: number | null;
  toTs: number | null;
  latest: { affection: number; trust: number; desire: number; connection: number } | null;
  series: { affection: number[]; trust: number[]; desire: number[]; connection: number[] };
} {
  const sorted = [...history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item =>
      item.statistics.affection?.[characterName] !== undefined ||
      item.statistics.trust?.[characterName] !== undefined ||
      item.statistics.desire?.[characterName] !== undefined ||
      item.statistics.connection?.[characterName] !== undefined ||
      item.statistics.mood?.[characterName] !== undefined ||
      item.statistics.lastThought?.[characterName] !== undefined,
    );
  const build = (key: "affection" | "trust" | "desire" | "connection"): number[] => {
    let carry = 50;
    return sorted.map(item => {
      const raw = item.statistics[key]?.[characterName];
      if (raw !== undefined) {
        const value = Number(raw);
        if (!Number.isNaN(value)) {
          carry = Math.max(0, Math.min(100, value));
        }
      }
      return carry;
    });
  };
  const affection = build("affection");
  const trust = build("trust");
  const desire = build("desire");
  const connection = build("connection");
  const snapshots = sorted.length;
  return {
    snapshots,
    fromTs: snapshots ? sorted[0].timestamp : null,
    toTs: snapshots ? sorted[snapshots - 1].timestamp : null,
    latest: snapshots
      ? {
          affection: affection[snapshots - 1],
          trust: trust[snapshots - 1],
          desire: desire[snapshots - 1],
          connection: connection[snapshots - 1],
        }
      : null,
    series: { affection, trust, desire, connection }
  };
}

async function runExtraction(reason: string, targetMessageIndex?: number): Promise<void> {
  const context = getSafeContext();
  if (!context) return;
  if (!settings?.enabled) return;
  if (context.chat.length === 0) return;
  if (isExtracting) {
    pushTrace("extract.skip", { reason: "already_extracting", trigger: reason });
    return;
  }

  let lastIndex: number | null = null;
  if (typeof targetMessageIndex === "number" && targetMessageIndex >= 0 && targetMessageIndex < context.chat.length) {
    const target = context.chat[targetMessageIndex];
    if (isTrackableAiMessage(target)) {
      lastIndex = targetMessageIndex;
    }
  }
  if (lastIndex == null) {
    lastIndex = getLastMessageIndexIfAi(context);
  }
  if (lastIndex == null) {
    pushTrace("extract.skip", { reason: "no_ai_message", trigger: reason });
    return;
  }
  const lastMessage = context.chat[lastIndex];
  const forceRetrack =
    reason === "manual_refresh" ||
    reason === "MESSAGE_EDITED" ||
    reason === "MESSAGE_SWIPED" ||
    reason === "SWIPE_CHANGED" ||
    reason === "MESSAGE_SWIPE_CHANGED" ||
    reason === "MESSAGE_SWIPE_DELETED";
  if (!forceRetrack && getTrackerDataFromMessage(lastMessage)) {
    pushTrace("extract.skip", { reason: "tracker_already_present", trigger: reason, messageIndex: lastIndex });
    return;
  }

  isExtracting = true;
  const runId = ++runSequence;
  activeExtractionRunId = runId;
  pushTrace("extract.start", {
    runId,
    reason,
    targetMessageIndex: targetMessageIndex ?? null,
    resolvedMessageIndex: lastIndex
  });
  setTrackerUi(context, { phase: "extracting", done: 0, total: 1, messageIndex: lastIndex, stepLabel: "Preparing context" });
  queueRender();

  try {
    const activity = resolveActiveCharacterAnalysis(context, settings);
    lastActivityAnalysis = activity;
    allCharacterNames = activity.allCharacterNames;
    const activeCharacters = activity.activeCharacters;
    pushTrace("activity.resolve", {
      allCharacterNames,
      activeCharacters,
      lookback: activity.lookback,
      autoDetectActive: settings.autoDetectActive,
      reasons: activity.reasons
    });
    if (!activeCharacters.length) {
      pushTrace("extract.skip", { reason: "no_active_characters", runId });
      return;
    }

    const previousEntry =
      typeof targetMessageIndex === "number" && targetMessageIndex >= 0
        ? getLatestTrackerDataWithIndexBefore(context, targetMessageIndex)
        : getLatestTrackerDataWithIndex(context);
    let previous = previousEntry?.data ?? null;
    if (!previous) {
      latestData = buildBaselineData(activeCharacters, settings);
      latestDataMessageIndex = lastIndex;
      queueRender();
      previous = latestData;
      pushTrace("extract.baseline", { runId, forMessageIndex: lastIndex, activeCharacters: activeCharacters.length });
    }

    const userName = context.name1 ?? "User";
    let contextText = buildRecentContext(context, settings.contextMessages);
    if (settings.includeCharacterCardsInPrompt) {
      contextText = `${contextText}${buildCharacterCardsContext(context, activeCharacters)}`.trim();
    }

    logDebug(settings, "extraction", `Extraction started (${reason})`, {
      activeCharacters,
      allCharacterNames,
      runId
    });

    const extractedResult = await extractStatisticsParallel({
      settings,
      userName,
      activeCharacters,
      contextText,
      previousStatistics: previous?.statistics ?? null,
      history: getRecentTrackerHistory(context, 6),
      onProgress: (done, total, label) => {
        if (!isExtracting || activeExtractionRunId !== runId) {
          return;
        }
        pushTrace("extract.progress", { runId, done, total, label: label ?? null });
        setTrackerUi(context, { phase: "extracting", done, total, messageIndex: lastIndex, stepLabel: label ?? null });
        queueRender();
      }
    });
    const extracted = extractedResult.statistics;
    lastDebugRecord = extractedResult.debug;
    if (lastDebugRecord) {
      const persistedTail = readTraceLines(context).slice(-200);
      lastDebugRecord.trace = persistedTail.length ? persistedTail : [...debugTrace];
    }
    saveDebugRecord(context, lastDebugRecord);

    if (runId !== runSequence) {
      pushTrace("extract.skip", { reason: "stale_run", runId, currentRunId: runSequence });
      return;
    }

    const merged = mergeStatisticsWithFallback(extracted, previous?.statistics ?? null, settings);

    latestData = {
      timestamp: Date.now(),
      activeCharacters,
      statistics: merged
    };
    latestDataMessageIndex = lastIndex;

    writeTrackerDataToMessage(context, latestData, lastIndex);
    context.saveChatDebounced?.();
    await context.saveChat?.();

    queuePromptSync(context);
    queueRender();
    pushTrace("extract.finish", {
      runId,
      reason,
      savedMessageIndex: lastIndex,
      activeCharacters: activeCharacters.length
    });
    logDebug(settings, "extraction", `Extraction finished (${reason})`);
  } catch (error) {
    const isAbortError = error instanceof DOMException && error.name === "AbortError";
    if (isAbortError) {
      pushTrace("extract.cancelled", { reason });
      return;
    }
    pushTrace("extract.error", {
      reason,
      message: error instanceof Error ? error.message : String(error)
    });
    console.error("[BetterSimTracker] Extraction failed:", error);
  } finally {
    if (activeExtractionRunId === runId) {
      activeExtractionRunId = null;
    }
    isExtracting = false;
    setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
    queueRender();
  }
}

function refreshFromStoredData(): void {
  const context = getSafeContext();
  if (!context || !settings) return;

  allCharacterNames = getAllTrackedCharacterNames(context);
  const latestEntry = getLatestTrackerDataWithIndex(context);
  const chatStateEntry = getChatStateLatestTrackerData(context);
  const metadataEntry = getMetadataLatestTrackerData(context);
  const localEntry = getLocalLatestTrackerData(context);
  const lastAiIndex = getLastAiMessageIndex(context);
  const isEntrySafeForCurrentLastAi = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (lastAiIndex == null) return false;
    if (entry.messageIndex !== lastAiIndex) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    const message = context.chat[entry.messageIndex];
    return isTrackableAiMessage(message);
  };
  const isEntrySafeForAnyChatMessage = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    return isTrackableAiMessage(context.chat[entry.messageIndex]);
  };

  if (!lastDebugRecord) {
    lastDebugRecord = loadDebugRecord(context);
    if (lastDebugRecord && settings.debug) {
      lastDebugRecord.trace = readTraceLines(context).slice(-200);
    }
  }
  let source: "message" | "chatState" | "metadata" | "local" | "none" = "none";
  if (isEntrySafeForAnyChatMessage(latestEntry)) {
    latestData = latestEntry!.data;
    latestDataMessageIndex = latestEntry!.messageIndex;
    source = "message";
  } else if (isEntrySafeForCurrentLastAi(chatStateEntry)) {
    latestData = chatStateEntry!.data;
    latestDataMessageIndex = chatStateEntry!.messageIndex;
    source = "chatState";
  } else if (isEntrySafeForCurrentLastAi(metadataEntry)) {
    latestData = metadataEntry!.data;
    latestDataMessageIndex = metadataEntry!.messageIndex;
    source = "metadata";
  } else if (isEntrySafeForCurrentLastAi(localEntry)) {
    latestData = localEntry!.data;
    latestDataMessageIndex = localEntry!.messageIndex;
    source = "local";
  } else {
    latestData = null;
    latestDataMessageIndex = null;
  }

  if (lastAiIndex != null && latestData && source === "message") {
    latestDataMessageIndex = lastAiIndex;
  } else if (!latestData) {
    latestDataMessageIndex = null;
  } else if (latestData && lastAiIndex == null) {
    scheduleRefresh(300);
  }
  if (trackerUiState.phase === "idle") {
    trackerUiState = { ...trackerUiState, messageIndex: latestDataMessageIndex };
  }
  pushTrace("refresh.resolve", {
    source,
    lastAiIndex,
    latestDataMessageIndex,
    hasLatestData: Boolean(latestData)
  });
  queuePromptSync(context);
  queueRender();
  upsertSettingsPanel({
    settings,
    onSave: patch => {
      if (!settings || !context) return;
      settings = { ...settings, ...patch };
      saveSettings(context, settings);
      refreshFromStoredData();
    },
    onOpenModal: () => openSettings()
  });
}

function registerEvents(context: STContext): void {
  const events = context.event_types ?? {};
  const source = context.eventSource;
  if (!source) {
    pushTrace("event.register.skip", { reason: "missing_event_source" });
    return;
  }

  if (events.GENERATION_STARTED) {
    source.on(events.GENERATION_STARTED, (generationType: unknown, _options: unknown, isDryRun: unknown) => {
      if (isExtracting) {
        pushTrace("event.generation_started_ignored", { reason: "tracker_extraction_in_progress" });
        return;
      }
      const type = String(generationType ?? "");
      const dryRun = Boolean(isDryRun);
      if (dryRun || type === "quiet") {
        pushTrace("event.generation_started_ignored", { reason: dryRun ? "dry_run" : "quiet_generation", type, dryRun });
        return;
      }
      if (type === "swipe" && pendingSwipeExtraction) {
        pendingSwipeExtraction.waitForGenerationEnd = true;
        if (swipeExtractionTimer !== null) {
          window.clearTimeout(swipeExtractionTimer);
          swipeExtractionTimer = null;
        }
      }
      swipeGenerationActive = type === "swipe";
      chatGenerationInFlight = true;
      chatGenerationSawCharacterRender = false;
      chatGenerationStartLastAiIndex = getLastAiMessageIndex(context);
      const baseTargetIndex = getGenerationTargetMessageIndex(context);
      const targetIndex = type === "swipe"
        ? (getLastAiMessageIndex(context) ?? baseTargetIndex)
        : baseTargetIndex;
      pushTrace("event.generation_started", { targetIndex, type, startLastAiIndex: chatGenerationStartLastAiIndex });
      setTrackerUi(context, { phase: "generating", done: 0, total: 0, messageIndex: targetIndex, stepLabel: "Generating AI response" });
      queueRender();
      queuePromptSync(context);
    });
  }

  source.on(events.GENERATION_ENDED, () => {
    if (isExtracting) {
      pushTrace("event.generation_ended_ignored", { reason: "tracker_extraction_in_progress" });
      return;
    }
    if (!chatGenerationInFlight) {
      pushTrace("event.generation_ended_ignored", { reason: "non_chat_or_quiet_generation" });
      return;
    }
    if (!chatGenerationSawCharacterRender) {
      chatGenerationInFlight = false;
      chatGenerationStartLastAiIndex = null;
      pushTrace("event.generation_ended_ignored", { reason: "no_new_ai_message_rendered" });
      setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
      queueRender();
      return;
    }
    chatGenerationInFlight = false;
    chatGenerationStartLastAiIndex = null;
    pushTrace("event.generation_ended");
    if (swipeGenerationActive && pendingSwipeExtraction) {
      const pending = pendingSwipeExtraction;
      pendingSwipeExtraction = null;
      if (swipeExtractionTimer !== null) {
        window.clearTimeout(swipeExtractionTimer);
        swipeExtractionTimer = null;
      }
      swipeGenerationActive = false;
      scheduleExtraction(pending.reason, pending.messageIndex);
      return;
    }
    swipeGenerationActive = false;
    if (pendingSwipeExtraction?.waitForGenerationEnd) {
      pendingSwipeExtraction = null;
      if (swipeExtractionTimer !== null) {
        window.clearTimeout(swipeExtractionTimer);
        swipeExtractionTimer = null;
      }
    }
    scheduleExtraction("GENERATION_ENDED");
  });

  source.on(events.CHAT_CHANGED, () => {
    chatGenerationInFlight = false;
    chatGenerationSawCharacterRender = false;
    chatGenerationStartLastAiIndex = null;
    swipeGenerationActive = false;
    clearPendingSwipeExtraction();
    pushTrace("event.chat_changed");
    scheduleRefresh();
  });

  if (events.GROUP_CHAT_UPDATED) {
    source.on(events.GROUP_CHAT_UPDATED, () => {
      pushTrace("event.group_chat_updated");
      scheduleRefresh();
    });
  }

  if (events.CHARACTER_MESSAGE_RENDERED) {
    source.on(events.CHARACTER_MESSAGE_RENDERED, () => {
      pushTrace("event.character_message_rendered");
      if (chatGenerationInFlight) {
        if (swipeGenerationActive) {
          chatGenerationSawCharacterRender = true;
        }
        const currentLastAi = getLastAiMessageIndex(context);
        if (
          currentLastAi != null &&
          (chatGenerationStartLastAiIndex == null || currentLastAi > chatGenerationStartLastAiIndex)
        ) {
          chatGenerationSawCharacterRender = true;
          pushTrace("event.character_message_rendered_marked_new_ai", {
            currentLastAi,
            startLastAiIndex: chatGenerationStartLastAiIndex
          });
        }
      }
      if (pendingSwipeExtraction && !pendingSwipeExtraction.waitForGenerationEnd) {
        const pending = pendingSwipeExtraction;
        pendingSwipeExtraction = null;
        if (swipeExtractionTimer !== null) {
          window.clearTimeout(swipeExtractionTimer);
          swipeExtractionTimer = null;
        }
        pushTrace("extract.swipe.rendered", { reason: pending.reason, targetMessageIndex: pending.messageIndex ?? null });
        scheduleExtraction(pending.reason, pending.messageIndex);
      }
      if (trackerUiState.phase === "generating") {
        const currentLastAi = getLastAiMessageIndex(context);
        setTrackerUi(context, { ...trackerUiState, messageIndex: currentLastAi });
      }
      scheduleRefresh(120);
    });
  }

  if (events.USER_MESSAGE_RENDERED) {
    source.on(events.USER_MESSAGE_RENDERED, () => {
      pushTrace("event.user_message_rendered");
      scheduleRefresh(120);
    });
  }

  if (events.CHAT_LOADED) {
    source.on(events.CHAT_LOADED, () => {
      chatGenerationInFlight = false;
      chatGenerationSawCharacterRender = false;
      chatGenerationStartLastAiIndex = null;
      swipeGenerationActive = false;
      clearPendingSwipeExtraction();
      pushTrace("event.chat_loaded");
      scheduleRefresh();
    });
  }

  if (events.APP_READY) {
    source.on(events.APP_READY, () => {
      pushTrace("event.app_ready");
      scheduleRefresh();
      ensureSlashCommandsRegistered();
    });
  }

  if (events.MESSAGE_DELETED) {
    source.on(events.MESSAGE_DELETED, () => {
      chatGenerationInFlight = false;
      chatGenerationSawCharacterRender = false;
      chatGenerationStartLastAiIndex = null;
      swipeGenerationActive = false;
      clearPendingSwipeExtraction();
      pushTrace("event.message_deleted");
      scheduleRefresh(60);
    });
  }

  if (events.CHAT_DELETED) {
    source.on(events.CHAT_DELETED, () => {
      chatGenerationInFlight = false;
      chatGenerationSawCharacterRender = false;
      chatGenerationStartLastAiIndex = null;
      swipeGenerationActive = false;
      clearPendingSwipeExtraction();
      pushTrace("event.chat_deleted");
      scheduleRefresh(60);
    });
  }

  if (events.MESSAGE_EDITED) {
    source.on(events.MESSAGE_EDITED, (payload: unknown) => {
      const messageIndex = getEventMessageIndex(payload);
      pushTrace("event.message_edited", { messageIndex });
      scheduleRefresh();
      scheduleExtraction("MESSAGE_EDITED", messageIndex ?? undefined);
    });
  }

  const swipeEvents = ["MESSAGE_SWIPED", "SWIPE_CHANGED", "MESSAGE_SWIPE_CHANGED", "MESSAGE_SWIPE_DELETED"];
  for (const key of swipeEvents) {
    const eventName = events[key];
    if (!eventName) continue;
    source.on(eventName, (payload: unknown) => {
      const messageIndex = getEventMessageIndex(payload);
      pushTrace("event.swipe", { event: key, messageIndex });
      if (context && trackerUiState.phase !== "generating") {
        const baseTargetIndex = getGenerationTargetMessageIndex(context);
        const targetIndex = getLastAiMessageIndex(context) ?? baseTargetIndex;
        setTrackerUi(context, { phase: "generating", done: 0, total: 0, messageIndex: targetIndex, stepLabel: "Generating AI response" });
        queueRender();
      }
      scheduleRefresh();
      scheduleSwipeExtraction(key, messageIndex ?? undefined);
    });
  }
}

function openSettings(): void {
  if (!settings) return;
  const context = getSafeContext();
  openSettingsModal({
    settings,
    profileOptions: context ? discoverConnectionProfiles(context) : [],
    debugRecord: lastDebugRecord,
    injectedPrompt: settings.debug ? getLastInjectedPrompt() : "",
    onSave: next => {
      const activeContext = getSafeContext();
      if (!activeContext) return;
      settings = next;
      saveSettings(activeContext, settings);
      refreshFromStoredData();
    },
    onRetrack: () => {
      void runExtraction("manual_refresh");
    },
    onClearCurrentChat: () => clearCurrentChat(),
    onDumpDiagnostics: () => {
      const activeContext = getSafeContext();
      if (!activeContext || !settings) return;
      const currentSettings = settings;
      const graphPreferences = getGraphPreferences();
      const settingsProvenance = getSettingsProvenance(activeContext);
      const activeProfileId = getActiveConnectionProfileId(activeContext);
      const profileCandidate = currentSettings.connectionProfile?.trim() ?? "";
      const resolvedProfileId = profileCandidate && profileCandidate.toLowerCase() !== "default"
        ? profileCandidate
        : null;
      const historySample = getRecentTrackerHistoryEntries(activeContext, 10).map(entry => ({
        messageIndex: entry.messageIndex,
        timestamp: entry.timestamp,
        activeCharacters: entry.data.activeCharacters,
        statistics: {
          affection: entry.data.statistics.affection,
          trust: entry.data.statistics.trust,
          desire: entry.data.statistics.desire,
          connection: entry.data.statistics.connection,
          mood: entry.data.statistics.mood
        }
      }));
      const filterGraphTrace = (lines: string[]): string[] => {
        if (currentSettings.includeGraphInDiagnostics) return lines;
        return lines.filter(line => !line.includes(" graph.open "));
      };
      const filteredLastDebugRecord = (() => {
        if (!lastDebugRecord) return null;
        if (currentSettings.includeGraphInDiagnostics) return lastDebugRecord;
        return {
          ...lastDebugRecord,
          trace: filterGraphTrace(lastDebugRecord.trace ?? [])
        };
      })();
      const report = {
        timestamp: new Date().toISOString(),
        scope: activeContext.groupId ? `group:${activeContext.groupId}` : `char:${String(activeContext.characterId ?? "unknown")}`,
        chatLength: activeContext.chat.length,
        isExtracting,
        runSequence,
        trackerUiState,
        latestDataMessageIndex,
        latestDataTimestamp: latestData?.timestamp ?? null,
        allCharacterNames,
        settingsProvenance,
        graphPreferences,
        profileDebug: {
          selectedProfile: currentSettings.connectionProfile,
          resolvedProfileId,
          activeProfileId
        },
        historySample,
        requestMeta: filteredLastDebugRecord?.meta?.requests ?? null,
        settings: {
          enabled: currentSettings.enabled,
          debug: currentSettings.debug,
          includeContextInDiagnostics: currentSettings.includeContextInDiagnostics,
          includeGraphInDiagnostics: currentSettings.includeGraphInDiagnostics,
          injectTrackerIntoPrompt: currentSettings.injectTrackerIntoPrompt,
          contextMessages: currentSettings.contextMessages,
          maxConcurrentCalls: currentSettings.maxConcurrentCalls,
          maxDeltaPerTurn: currentSettings.maxDeltaPerTurn,
          maxTokensOverride: currentSettings.maxTokensOverride,
          truncationLengthOverride: currentSettings.truncationLengthOverride,
          includeCharacterCardsInPrompt: currentSettings.includeCharacterCardsInPrompt,
          autoDetectActive: currentSettings.autoDetectActive,
          activityLookback: currentSettings.activityLookback,
          moodSource: currentSettings.moodSource,
          stExpressionImageZoom: currentSettings.stExpressionImageZoom,
          stExpressionImagePositionX: currentSettings.stExpressionImagePositionX,
          stExpressionImagePositionY: currentSettings.stExpressionImagePositionY,
          strictJsonRepair: currentSettings.strictJsonRepair,
          maxRetriesPerStat: currentSettings.maxRetriesPerStat
        },
        activity: lastActivityAnalysis,
        promptInjectionPreview: currentSettings.debug ? getLastInjectedPrompt() : undefined,
        traceTailMemory: filterGraphTrace(debugTrace.slice(-150)),
        traceTailPersisted: filterGraphTrace(readTraceLines(activeContext).slice(-300)),
        lastDebugRecord: filteredLastDebugRecord
      };
      console.log("[BetterSimTracker] diagnostics-dump", report);
      const serial = JSON.stringify(report, null, 2);
      void navigator.clipboard?.writeText(serial).then(
        () => console.log("[BetterSimTracker] diagnostics copied to clipboard"),
        () => console.log("[BetterSimTracker] diagnostics clipboard copy failed")
      );
    },
    onClearDiagnostics: () => {
      const activeContext = getSafeContext();
      if (!activeContext) return;
      clearDebugRecord(activeContext);
      debugTrace = [];
      lastDebugRecord = null;
      pushTrace("diagnostics.cleared");
      refreshFromStoredData();
    }
  });
}

function closeSettings(): void {
  closeSettingsModal();
}

function buildCharacterCardsContext(context: STContext, activeCharacters: string[]): string {
  if (!context.characters || !context.characters.length) return "";
  const byName = new Map<string, Character>();
  for (const character of context.characters) {
    if (character?.name) byName.set(character.name, character);
  }
  const chunks: string[] = [];
  for (const name of activeCharacters) {
    const card = byName.get(name);
    if (!card) continue;
    const lines: string[] = [];
    if (card.description) lines.push(`Description: ${card.description}`);
    if (card.personality) lines.push(`Personality: ${card.personality}`);
    if (card.scenario) lines.push(`Scenario: ${card.scenario}`);
    if (!lines.length) continue;
    chunks.push(`Character Card — ${name}\n${lines.join("\n")}`);
  }
  if (!chunks.length) return "";
  return `\n\nCharacter cards (use only to disambiguate if recent messages are unclear):\n${chunks.join("\n\n")}`;
}

function toggle(): boolean {
  const context = getSafeContext();
  if (!context || !settings) return false;
  settings.enabled = !settings.enabled;
  saveSettings(context, settings);
  if (!settings.enabled) {
    void clearPromptInjection();
    closeGraphModal();
    removeTrackerUI();
  } else {
    queuePromptSync(context);
    refreshFromStoredData();
  }
  return settings.enabled;
}

async function refresh(): Promise<void> {
  await runExtraction("manual_refresh");
}

function exposeWindowApi(): void {
  window.BetterSimTracker = {
    openSettings,
    closeSettings,
    toggle,
    refresh
  };
}

function clearCurrentChat(): void {
  const activeContext = getSafeContext();
  if (!activeContext) return;
  clearTrackerDataForCurrentChat(activeContext);
  clearDebugRecord(activeContext);
  debugTrace = [];
  latestData = null;
  latestDataMessageIndex = null;
  lastDebugRecord = null;
  trackerUiState = { phase: "idle", done: 0, total: 0, messageIndex: null };
  activeContext.saveChatDebounced?.();
  void activeContext.saveChat?.();
  refreshFromStoredData();
}

function ensureSlashCommandsRegistered(): void {
  if (slashCommandsRegistered) return;
  slashCommandsRegistered = true;
  registerSlashCommands({
    getContext: () => getSafeContext(),
    getSettings: () => settings,
    setSettings: next => { settings = next; },
    getLatestMessageIndex: () => latestDataMessageIndex,
    isExtracting: () => isExtracting,
    runExtraction: (reason, messageIndex) => runExtraction(reason, messageIndex),
    refreshFromStoredData,
    clearCurrentChat,
    queuePromptSync,
    saveSettings: (context, next) => saveSettings(context, next),
    pushTrace
  });
}

async function init(): Promise<void> {
  const context = getSafeContext();
  if (!context) {
    console.warn("[BetterSimTracker] SillyTavern context not available.");
    return;
  }

  settings = loadSettings(context);
  if (settings.debug) {
    pushTrace("init", {
      groupId: context.groupId ?? null,
      characterId: context.characterId ?? null,
      chatLength: context.chat.length
    });
  }
  registerEvents(context);
  refreshFromStoredData();
  setTimeout(() => refreshFromStoredData(), 500);
  setTimeout(() => refreshFromStoredData(), 1500);
  setTimeout(() => refreshFromStoredData(), 3000);
  setTimeout(() => refreshFromStoredData(), 6000);
  initCharacterPanel({
    getContext: () => getSafeContext(),
    getSettings: () => settings,
    setSettings: next => { settings = next; },
    saveSettings: (ctx, next) => saveSettings(ctx, next),
    onSettingsUpdated: () => refreshFromStoredData()
  });
  exposeWindowApi();
  ensureSlashCommandsRegistered();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}
