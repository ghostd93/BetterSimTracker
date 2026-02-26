import { getAllTrackedCharacterNames, buildRecentContext, resolveActiveCharacterAnalysis } from "./activity";
import { resolveCharacterDefaultsEntry } from "./characterDefaults";
import type { Character } from "./types";
import { extractStatisticsParallel } from "./extractor";
import { isTrackableAiMessage, isTrackableMessage, isTrackableUserMessage } from "./messageFilter";
import { clearPromptInjection, getLastInjectedPrompt, syncPromptInjection } from "./promptInjection";
import { USER_TRACKER_KEY } from "./constants";
import {
  buildTrackerSummaryGenerationPrompt,
  buildTrackerSummaryLengthenPrompt,
  buildTrackerSummaryNoNumbersRewritePrompt,
  moodOptions,
} from "./prompts";
import { upsertSettingsPanel } from "./settingsPanel";
import { discoverConnectionProfiles, getActiveConnectionProfileId, getContext, getSettingsProvenance, loadSettings, logDebug, resolveConnectionProfileId, saveSettings } from "./settings";
import {
  clearTrackerDataForCurrentChat,
  getChatStateLatestTrackerData,
  getLatestTrackerDataWithIndex,
  getLatestTrackerDataWithIndexBefore,
  getLocalLatestTrackerData,
  getMetadataLatestTrackerData,
  getRecentTrackerHistory,
  getRecentTrackerHistoryEntries,
  getTrackerDataFromMessage,
  mergeCustomNonNumericStatisticsWithFallback,
  mergeCustomStatisticsWithFallback,
  mergeStatisticsWithFallback,
  writeTrackerDataToMessage
} from "./storage";
import { getAllNumericStatDefinitions } from "./statRegistry";
import type {
  BetterSimTrackerSettings,
  CustomNonNumericStatistics,
  CustomStatistics,
  DeltaDebugRecord,
  STContext,
  Statistics,
  TrackerData
} from "./types";
import { closeGraphModal, closeSettingsModal, getGraphPreferences, openGraphModal, openSettingsModal, removeTrackerUI, renderTracker, type TrackerUiState } from "./ui";
import { cancelActiveGenerations, generateJson } from "./generator";
import { registerSlashCommands } from "./slashCommands";
import { initCharacterPanel } from "./characterPanel";
import { extractLorebookEntriesFromPayload, readLorebookContext } from "./lorebook";

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
const cancelledExtractionRuns = new Set<number>();
const activeSummaryRuns = new Set<number>();
let summaryVisibilityReloadInFlight = false;
const BUILT_IN_NUMERIC_KEYS = new Set(["affection", "trust", "desire", "connection"]);
const EDIT_MOOD_LABELS = new Map(moodOptions.map(label => [label.toLowerCase(), label]));
const LOREBOOK_ACTIVATED_METADATA_KEY = "bstLorebookActivatedEntries";
let lastActivatedLorebookEntries: string[] = [];

function collectSummaryCharacters(data: TrackerData): string[] {
  const names = new Set<string>();
  for (const name of data.activeCharacters ?? []) {
    if (typeof name === "string" && name.trim()) names.add(name.trim());
  }
  const addKeys = (map: Record<string, unknown> | undefined): void => {
    if (!map || typeof map !== "object") return;
    for (const key of Object.keys(map)) {
      if (key.trim()) names.add(key.trim());
    }
  };
  addKeys(data.statistics.affection);
  addKeys(data.statistics.trust);
  addKeys(data.statistics.desire);
  addKeys(data.statistics.connection);
  addKeys(data.statistics.mood);
  for (const statValues of Object.values(data.customStatistics ?? {})) {
    addKeys(statValues as Record<string, unknown>);
  }
  for (const statValues of Object.values(data.customNonNumericStatistics ?? {})) {
    addKeys(statValues as Record<string, unknown>);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function stripHiddenReasoningBlocks(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<\s*(think|analysis|reasoning)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(think|analysis|reasoning)[^>]*>/gi, "")
    .trim();
}

function sanitizeGeneratedSummaryText(raw: string): string {
  let text = stripHiddenReasoningBlocks(raw);
  if (!text) return "";

  const fencedBlock = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fencedBlock?.[1]) {
    text = fencedBlock[1].trim();
  }

  text = text
    .replace(/^summary\s*[:\-]\s*/i, "")
    .replace(/^system\s*summary\s*[:\-]\s*/i, "")
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim();

  return text.slice(0, 1200).trim();
}

function normalizeSummaryProse(text: string): string {
  let prose = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!prose) return "";

  // Remove line-based markdown/list artifacts, then flatten to prose.
  prose = prose
    .split("\n")
    .map(line => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(" ");

  // Remove common structured wrappers.
  prose = prose
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/^\{[\s\S]*\}$/m, "")
    .trim();

  // Keep plain prose formatting.
  prose = prose
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!prose) return "";
  if (!/[.!?]$/.test(prose)) {
    prose = `${prose}.`;
  }
  return prose.slice(0, 1000).trim();
}

function wrapAsSystemNarrativeText(text: string): string {
  const cleaned = text.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  return `*${cleaned}*`;
}

function hasNumericCharacters(text: string): boolean {
  return /\d/.test(text);
}

function countSummarySentences(text: string): number {
  const matches = String(text ?? "").match(/[.!?]+(?:\s|$)/g);
  return matches?.length ?? 0;
}

function describeLorebookPayload(payload: unknown): string {
  if (Array.isArray(payload)) return `array:${payload.length}`;
  if (payload instanceof Set) return `set:${payload.size}`;
  if (payload instanceof Map) return `map:${payload.size}`;
  if (payload && typeof payload === "object") return "object";
  return typeof payload;
}

function cacheLorebookActivatedEntries(context: STContext, payload: unknown): number {
  const entries = extractLorebookEntriesFromPayload(payload, 120);
  if (!entries.length) return 0;
  lastActivatedLorebookEntries = entries;
  if (!context.chatMetadata || typeof context.chatMetadata !== "object") {
    context.chatMetadata = {};
  }
  context.chatMetadata[LOREBOOK_ACTIVATED_METADATA_KEY] = entries;
  context.saveMetadataDebounced?.();
  return entries.length;
}

function buildSummaryTrackerStateLines(
  data: TrackerData,
  currentSettings: BetterSimTrackerSettings,
  userDisplayName = "User",
): string {
  const customLabelMap = new Map<string, string>();
  for (const stat of currentSettings.customStats ?? []) {
    const id = String(stat.id ?? "").trim().toLowerCase();
    if (!id) continue;
    customLabelMap.set(id, String(stat.label ?? id).trim() || id);
  }

  const builtInStats: Array<{ key: "affection" | "trust" | "desire" | "connection"; label: string }> = [
    { key: "affection", label: "affection" },
    { key: "trust", label: "trust" },
    { key: "desire", label: "desire" },
    { key: "connection", label: "connection" },
  ];

  const lines = collectSummaryCharacters(data).map(name => {
    const displayName = name === USER_TRACKER_KEY ? userDisplayName : name;
    const parts: string[] = [];
    const mood = String(data.statistics.mood?.[name] ?? "").trim().replace(/\s+/g, " ");
    if (mood) {
      parts.push(`mood=${mood}`);
    }
    const lastThought = String(data.statistics.lastThought?.[name] ?? "").trim().replace(/\s+/g, " ");
    if (lastThought) {
      parts.push(`lastThought="${lastThought.slice(0, 180)}"`);
    }

    for (const { key, label } of builtInStats) {
      const raw = data.statistics[key]?.[name];
      const value = Number(raw);
      if (raw === undefined || Number.isNaN(value)) continue;
      parts.push(`${label}=${Math.max(0, Math.min(100, Math.round(value)))}`);
    }

    for (const [statId, byCharacter] of Object.entries(data.customStatistics ?? {})) {
      const raw = byCharacter?.[name];
      const value = Number(raw);
      if (raw === undefined || Number.isNaN(value)) continue;
      const label = (customLabelMap.get(statId) ?? statId).replace(/\s+/g, "_").toLowerCase();
      parts.push(`${label}=${Math.max(0, Math.min(100, Math.round(value)))}`);
    }
    for (const [statId, byCharacter] of Object.entries(data.customNonNumericStatistics ?? {})) {
      const raw = byCharacter?.[name];
      if (raw === undefined) continue;
      const label = (customLabelMap.get(statId) ?? statId).replace(/\s+/g, "_").toLowerCase();
      if (typeof raw === "boolean") {
        parts.push(`${label}=${raw ? "true" : "false"}`);
      } else {
        const text = String(raw ?? "").trim().replace(/\s+/g, " ");
        if (!text) continue;
        parts.push(`${label}="${text.slice(0, 120)}"`);
      }
    }

    return `- ${displayName}: ${parts.length ? parts.join(", ") : "no tracked values"}`;
  });

  return lines.length ? lines.join("\n") : "- no tracked values are available";
}

function buildRecentContextUpToMessageIndex(context: STContext, messageIndex: number, messageCount: number): string {
  const maxCount = Math.max(1, messageCount);
  const endExclusive = Math.min(context.chat.length, Math.max(0, messageIndex) + 1);
  const start = Math.max(0, endExclusive - maxCount);
  const chunk = context.chat.slice(start, endExclusive);
  return chunk
    .map(message => {
      if (!message.is_user && !isTrackableAiMessage(message)) return null;
      const speaker = message.is_user ? context.name1 ?? "User" : message.name ?? "Character";
      return `${speaker}: ${message.mes}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

function describeBand(value: number, low: string, medium: string, high: string): string {
  if (value <= 30) return low;
  if (value <= 60) return medium;
  return high;
}

function buildFallbackSummaryProse(data: TrackerData, currentSettings: BetterSimTrackerSettings): string {
  const names = collectSummaryCharacters(data);
  if (!names.length) {
    return "The current relationship state is quiet and there are no meaningful tracked shifts yet.";
  }
  const customLabelMap = new Map<string, string>();
  for (const stat of currentSettings.customStats ?? []) {
    const id = String(stat.id ?? "").trim().toLowerCase();
    if (!id) continue;
    customLabelMap.set(id, String(stat.label ?? id).trim() || id);
  }

  const sentences = names.map(name => {
    const displayName = name === USER_TRACKER_KEY ? (currentSettings.enableUserTracking ? "User" : name) : name;
    const affection = Number(data.statistics.affection?.[name] ?? currentSettings.defaultAffection);
    const trust = Number(data.statistics.trust?.[name] ?? currentSettings.defaultTrust);
    const desire = Number(data.statistics.desire?.[name] ?? currentSettings.defaultDesire);
    const connection = Number(data.statistics.connection?.[name] ?? currentSettings.defaultConnection);
    const mood = String(data.statistics.mood?.[name] ?? currentSettings.defaultMood).trim();

    const warmth = describeBand(affection, "guarded warmth", "measured warmth", "clear warmth");
    const safety = describeBand(trust, "careful trust", "steady trust", "strong trust");
    const bond = describeBand(connection, "distant", "steady", "close");
    const tension = describeBand(desire, "without notable romantic tension", "with mild romantic tension", "with noticeable romantic tension");

    const customBits: string[] = [];
    for (const [statId, byCharacter] of Object.entries(data.customStatistics ?? {})) {
      const raw = Number(byCharacter?.[name]);
      if (Number.isNaN(raw)) continue;
      const label = customLabelMap.get(statId) ?? statId;
      const tone = describeBand(raw, "low", "moderate", "high");
      customBits.push(`${label} feels ${tone}`);
      if (customBits.length >= 2) break;
    }
    if (customBits.length < 2) {
      for (const [statId, byCharacter] of Object.entries(data.customNonNumericStatistics ?? {})) {
        const raw = byCharacter?.[name];
        if (raw === undefined) continue;
        const label = customLabelMap.get(statId) ?? statId;
        if (typeof raw === "boolean") {
          customBits.push(`${label} is ${raw ? "active" : "inactive"}`);
        } else {
          const text = String(raw ?? "").trim().replace(/\s+/g, " ");
          if (!text) continue;
          customBits.push(`${label} is "${text.slice(0, 60)}"`);
        }
        if (customBits.length >= 2) break;
      }
    }

    const customClause = customBits.length ? ` ${displayName}'s custom-state cues suggest ${customBits.join(" and ")}.` : "";
    const moodClause = mood ? `${displayName} currently feels ${mood.toLowerCase()}. ` : "";
    return `${moodClause}${displayName} shows ${warmth} toward the user, ${safety}, and a ${bond} overall bond, ${tension}.${customClause}`;
  });

  return sentences.join(" ");
}

async function generateTrackerSummaryProse(input: {
  context: STContext;
  settings: BetterSimTrackerSettings;
  data: TrackerData;
  messageIndex: number;
}): Promise<{ text: string; profileId: string | null }> {
  const { context, settings, data, messageIndex } = input;
  const userDisplayName = context.name1 ?? "User";
  const normalizeSummaryName = (name: string): string => (name === USER_TRACKER_KEY ? userDisplayName : name);
  const characters = collectSummaryCharacters(data).map(normalizeSummaryName);
  const trackedDimensions: string[] = [];
  if (settings.trackAffection) trackedDimensions.push("warmth/care");
  if (settings.trackTrust) trackedDimensions.push("trust/safety");
  if (settings.trackDesire) trackedDimensions.push("desire/tension");
  if (settings.trackConnection) trackedDimensions.push("connection/closeness");
  if (settings.trackMood) trackedDimensions.push("mood tone");
  const trackedCustomLabels = (settings.customStats ?? [])
    .filter(stat => Boolean(stat.track))
    .map(stat => String(stat.label ?? stat.id).trim() || stat.id)
    .filter(Boolean)
    .slice(0, 8);
  if (trackedCustomLabels.length) {
    trackedDimensions.push(`custom cues (${trackedCustomLabels.join(", ")})`);
  }
  const contextText = buildRecentContextUpToMessageIndex(context, messageIndex, settings.contextMessages);
  const trackerStateLines = buildSummaryTrackerStateLines(data, settings, userDisplayName);
  const prompt = buildTrackerSummaryGenerationPrompt({
    userName: userDisplayName,
    activeCharacters: (data.activeCharacters ?? []).map(normalizeSummaryName),
    characters,
    contextText,
    trackerStateLines,
    trackedDimensions,
  });

  const first = await generateJson(prompt, settings);
  let summary = sanitizeGeneratedSummaryText(first.text);
  let profileId: string | null = first.meta.profileId;
  if (!summary) {
    throw new Error("Summary generation returned empty text.");
  }

  if (hasNumericCharacters(summary)) {
    const rewrite = await generateJson(
      buildTrackerSummaryNoNumbersRewritePrompt({ draftSummary: summary }),
      settings,
    );
    const rewritten = sanitizeGeneratedSummaryText(rewrite.text);
    if (rewritten) {
      summary = rewritten;
      profileId = rewrite.meta.profileId || profileId;
    }
  }

  if (hasNumericCharacters(summary)) {
    throw new Error("Summary still contains numeric output.");
  }

  const normalized = normalizeSummaryProse(summary);
  if (!normalized) {
    throw new Error("Summary normalization produced empty text.");
  }
  let finalSummary = normalized;
  const sentenceCount = countSummarySentences(finalSummary);
  if (sentenceCount < 4 || finalSummary.length < 260) {
    const expand = await generateJson(
      buildTrackerSummaryLengthenPrompt({ draftSummary: finalSummary }),
      settings,
    );
    let expanded = sanitizeGeneratedSummaryText(expand.text);
    if (expanded) {
      if (hasNumericCharacters(expanded)) {
        const rewriteExpanded = await generateJson(
          buildTrackerSummaryNoNumbersRewritePrompt({ draftSummary: expanded }),
          settings,
        );
        const rewrittenExpanded = sanitizeGeneratedSummaryText(rewriteExpanded.text);
        if (rewrittenExpanded) {
          expanded = rewrittenExpanded;
          profileId = rewriteExpanded.meta.profileId || profileId;
        }
      }
      if (!hasNumericCharacters(expanded)) {
        const normalizedExpanded = normalizeSummaryProse(expanded);
        if (normalizedExpanded && countSummarySentences(normalizedExpanded) >= 4) {
          finalSummary = normalizedExpanded;
          profileId = expand.meta.profileId || profileId;
        }
      }
    }
  }
  return { text: finalSummary, profileId };
}

async function sendSummaryAsSystemMessage(
  context: STContext,
  summaryText: string,
  visibleForAi: boolean,
): Promise<"comment-system" | "comment-ai-visible"> {
  const anyContext = context as STContext & {
    sendSystemMessage?: (type: string, text?: string, extra?: Record<string, unknown>) => void;
    addOneMessage?: (message: Record<string, unknown>, options?: Record<string, unknown>) => void;
  };

  const compactText = summaryText.replace(/\s+/g, " ").trim();
  const now = Date.now();
  const commonExtra = {
    gen_id: now,
    api: "manual",
    model: "bettersimtracker.summary",
    bstSummaryNote: true,
    bst_summary_note: true,
    swipeable: false,
  };

  const commentMessage = {
    name: "Note",
    is_user: false,
    is_system: !visibleForAi,
    send_date: now,
    mes: compactText,
    force_avatar: "img/quill.png",
    extra: visibleForAi
      ? commonExtra
      : { ...commonExtra, type: "comment", isSmallSys: false },
  };
  context.chat.push(commentMessage);
  anyContext.addOneMessage?.(commentMessage);
  return visibleForAi ? "comment-ai-visible" : "comment-system";
}

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

function getLastUserMessageIndex(context: STContext): number | null {
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const message = context.chat[i];
    if (isTrackableUserMessage(message)) return i;
  }
  return null;
}

function getLastTrackableMessageIndex(context: STContext): number | null {
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const message = context.chat[i];
    if (isTrackableMessage(message)) return i;
  }
  return null;
}

function getLastMessageIndexIfAi(context: STContext): number | null {
  return getLastAiMessageIndex(context);
}

function getLastMessageIndexIfUser(context: STContext): number | null {
  return getLastUserMessageIndex(context);
}

function isRenderableTrackerIndex(context: STContext, index: number): boolean {
  if (index < 0) return false;
  if (index >= context.chat.length) return true;
  return isTrackableMessage(context.chat[index]);
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

function hasUserTrackingEnabledForExtraction(input: BetterSimTrackerSettings): boolean {
  const tracksUserCustomStat = (stat: { track?: boolean; trackUser?: boolean }): boolean =>
    Boolean(stat.trackUser ?? stat.track);
  if (!input.enableUserTracking) return false;
  if (input.userTrackMood) return true;
  if (input.userTrackLastThought) return true;
  return (input.customStats ?? []).some(tracksUserCustomStat);
}

function isUserExtractionReason(reason: string): boolean {
  return reason === "USER_MESSAGE_RENDERED" || reason === "USER_MESSAGE_EDITED";
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
        if (!isTrackableMessage(message)) continue;
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
    renderTracker(entries, settings, allCharacterNames, Boolean(context?.groupId), trackerUiState, latestAiIndex, activeSummaryRuns, characterName => {
      const liveContext = getSafeContext();
      if (!liveContext?.characters?.length) return null;
      const normalized = String(characterName ?? "").trim().toLowerCase();
      if (!normalized) return null;
      const character = liveContext.characters.find(item => String(item?.name ?? "").trim().toLowerCase() === normalized);
      const avatar = String(character?.avatar ?? "").trim();
      return avatar || null;
    }, characterName => {
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
    }, messageIndex => {
      void sendTrackerSummaryToChat(messageIndex);
    }, () => {
      if (!isExtracting) return;
      if (activeExtractionRunId != null) {
        cancelledExtractionRuns.add(activeExtractionRunId);
      }
      const canceled = cancelActiveGenerations();
      pushTrace("extract.cancel", { canceled, source: "ui", runId: activeExtractionRunId });
    }, payload => {
      applyManualTrackerEdits(payload);
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
    settings.enableUserTracking ? "1" : "0",
    settings.includeUserTrackerInInjection ? "1" : "0",
    settings.userTrackMood ? "1" : "0",
    settings.userTrackLastThought ? "1" : "0",
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

function scheduleExtraction(reason: string, targetMessageIndex?: number, delay = 180): void {
  if (extractionTimer !== null) {
    window.clearTimeout(extractionTimer);
  }
  extractionTimer = window.setTimeout(() => {
    extractionTimer = null;
    pushTrace("extract.schedule.fire", { reason, targetMessageIndex: targetMessageIndex ?? null });
    void runExtraction(reason, targetMessageIndex);
  }, delay);
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

function findCharacterByName(context: STContext | null, name: string): Character | null {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const characters = context?.characters ?? [];
  return characters.find(character => String(character?.name ?? "").trim().toLowerCase() === normalized) ?? null;
}

function parseDefaultNumber(raw: unknown): number | null {
  const value = Number(raw);
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseDefaultText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text ? text : null;
}

function getConfiguredCharacterDefaults(
  context: STContext | null,
  settingsInput: BetterSimTrackerSettings,
  name: string,
): {
  affection?: number;
  trust?: number;
  desire?: number;
  connection?: number;
  mood?: string;
  customStatDefaults?: Record<string, number>;
  customNonNumericStatDefaults?: Record<string, string | boolean>;
} {
  const character = findCharacterByName(context, name);
  const extFromCharacter = character?.extensions as Record<string, unknown> | undefined;
  const extFromData = character?.data?.extensions as Record<string, unknown> | undefined;
  const own = ((extFromCharacter?.bettersimtracker ?? extFromData?.bettersimtracker) as Record<string, unknown> | undefined);
  const defaultsFromExtensions = (own?.defaults as Record<string, unknown> | undefined) ?? {};
  const defaultsFromSettings = resolveCharacterDefaultsEntry(settingsInput, {
    name,
    avatar: character?.avatar,
  });
  const merged = { ...defaultsFromSettings, ...defaultsFromExtensions };
  const affection = parseDefaultNumber(merged.affection);
  const trust = parseDefaultNumber(merged.trust);
  const desire = parseDefaultNumber(merged.desire);
  const connection = parseDefaultNumber(merged.connection);
  const mood = parseDefaultText(merged.mood);
  const customStatDefaultsRaw = merged.customStatDefaults;
  const customStatDefaults: Record<string, number> = {};
  if (customStatDefaultsRaw && typeof customStatDefaultsRaw === "object") {
    for (const [key, value] of Object.entries(customStatDefaultsRaw as Record<string, unknown>)) {
      const id = String(key ?? "").trim().toLowerCase();
      if (!id) continue;
      const parsed = parseDefaultNumber(value);
      if (parsed == null) continue;
      customStatDefaults[id] = parsed;
    }
  }
  const customNonNumericStatDefaultsRaw = merged.customNonNumericStatDefaults;
  const customNonNumericStatDefaults: Record<string, string | boolean> = {};
  if (customNonNumericStatDefaultsRaw && typeof customNonNumericStatDefaultsRaw === "object") {
    for (const [key, value] of Object.entries(customNonNumericStatDefaultsRaw as Record<string, unknown>)) {
      const id = String(key ?? "").trim().toLowerCase();
      if (!id) continue;
      if (typeof value === "boolean") {
        customNonNumericStatDefaults[id] = value;
        continue;
      }
      if (typeof value === "string") {
        const text = value.trim().replace(/\s+/g, " ");
        if (!text) continue;
        customNonNumericStatDefaults[id] = text.slice(0, 200);
      }
    }
  }
  return {
    ...(affection != null ? { affection } : {}),
    ...(trust != null ? { trust } : {}),
    ...(desire != null ? { desire } : {}),
    ...(connection != null ? { connection } : {}),
    ...(mood != null ? { mood } : {}),
    ...(Object.keys(customStatDefaults).length ? { customStatDefaults } : {}),
    ...(Object.keys(customNonNumericStatDefaults).length ? { customNonNumericStatDefaults } : {}),
  };
}

function buildSeededStatisticsForActiveCharacters(
  base: Statistics | null,
  activeCharacters: string[],
  settingsInput: BetterSimTrackerSettings,
  context: STContext | null,
): Statistics {
  const seeded: Statistics = {
    affection: { ...(base?.affection ?? {}) },
    trust: { ...(base?.trust ?? {}) },
    desire: { ...(base?.desire ?? {}) },
    connection: { ...(base?.connection ?? {}) },
    mood: { ...(base?.mood ?? {}) },
    lastThought: { ...(base?.lastThought ?? {}) },
  };

  for (const name of activeCharacters) {
    const configured = getConfiguredCharacterDefaults(context, settingsInput, name);
    if (seeded.affection[name] === undefined) {
      seeded.affection[name] = configured.affection ?? settingsInput.defaultAffection;
    }
    if (seeded.trust[name] === undefined) {
      seeded.trust[name] = configured.trust ?? settingsInput.defaultTrust;
    }
    if (seeded.desire[name] === undefined) {
      seeded.desire[name] = configured.desire ?? settingsInput.defaultDesire;
    }
    if (seeded.connection[name] === undefined) {
      seeded.connection[name] = configured.connection ?? settingsInput.defaultConnection;
    }
    if (seeded.mood[name] === undefined) {
      seeded.mood[name] = configured.mood ?? settingsInput.defaultMood;
    }
    if (seeded.lastThought[name] === undefined) {
      seeded.lastThought[name] = "";
    }
  }

  return seeded;
}

function buildSeededCustomStatisticsForActiveCharacters(
  base: CustomStatistics | null | undefined,
  activeCharacters: string[],
  settingsInput: BetterSimTrackerSettings,
  context: STContext | null,
): CustomStatistics {
  const seeded: CustomStatistics = {};
  for (const [statId, values] of Object.entries(base ?? {})) {
    seeded[statId] = { ...(values ?? {}) };
  }

  const customDefs = Array.isArray(settingsInput.customStats) ? settingsInput.customStats : [];
  for (const def of customDefs) {
    if ((def.kind ?? "numeric") !== "numeric") continue;
    const statId = String(def.id ?? "").trim().toLowerCase();
    if (!statId) continue;
    if (!seeded[statId]) seeded[statId] = {};
    for (const name of activeCharacters) {
      if (seeded[statId][name] !== undefined) continue;
      const configured = getConfiguredCharacterDefaults(context, settingsInput, name);
      const configuredValue = configured.customStatDefaults?.[statId];
      const fallback = Number(def.defaultValue);
      seeded[statId][name] = configuredValue ?? (Number.isNaN(fallback) ? 50 : fallback);
    }
  }

  return seeded;
}

function buildSeededCustomNonNumericStatisticsForActiveCharacters(
  base: CustomNonNumericStatistics | null | undefined,
  activeCharacters: string[],
  settingsInput: BetterSimTrackerSettings,
  context: STContext | null,
): CustomNonNumericStatistics {
  const seeded: CustomNonNumericStatistics = {};
  for (const [statId, values] of Object.entries(base ?? {})) {
    seeded[statId] = { ...(values ?? {}) };
  }

  const customDefs = Array.isArray(settingsInput.customStats) ? settingsInput.customStats : [];
  for (const def of customDefs) {
    const kind = def.kind ?? "numeric";
    if (kind === "numeric") continue;
    const statId = String(def.id ?? "").trim().toLowerCase();
    if (!statId) continue;
    if (!seeded[statId]) seeded[statId] = {};
    const hasScriptLikeContent = (text: string): boolean =>
      /<\s*\/?\s*script\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i.test(text);
    const resolveEnumOption = (options: string[], candidate: unknown): string | null => {
      if (!Array.isArray(options) || options.length === 0) return null;
      if (typeof candidate !== "string") return null;
      if (options.includes(candidate)) return candidate;
      const trimmed = candidate.trim();
      if (trimmed && options.includes(trimmed)) return trimmed;
      const lowered = candidate.toLowerCase();
      const lowerMatch = options.find(option => option.toLowerCase() === lowered);
      if (lowerMatch) return lowerMatch;
      if (trimmed) {
        const trimmedLower = trimmed.toLowerCase();
        const trimmedMatch = options.find(option => option.trim().toLowerCase() === trimmedLower);
        if (trimmedMatch) return trimmedMatch;
      }
      return null;
    };
    const enumOptions = Array.isArray(def.enumOptions)
      ? def.enumOptions.map(option => String(option ?? "")).filter(option => option.length > 0 && !hasScriptLikeContent(option))
      : [];
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(def.textMaxLength) || 120)));
    const normalizeValue = (raw: unknown): string | boolean => {
      if (kind === "boolean") {
        if (typeof raw === "boolean") return raw;
        if (typeof raw === "string") {
          const lowered = raw.trim().toLowerCase();
          if (lowered === "true") return true;
          if (lowered === "false") return false;
        }
        return typeof def.defaultValue === "boolean" ? def.defaultValue : false;
      }
      if (kind === "enum_single") {
        const defaultOption = resolveEnumOption(enumOptions, def.defaultValue);
        const fallback = defaultOption ?? enumOptions[0] ?? String(def.defaultValue ?? "");
        const matched = resolveEnumOption(enumOptions, raw);
        const selected = matched ?? fallback;
        return hasScriptLikeContent(selected) ? (enumOptions[0] ?? "") : selected;
      }
      const fallback = String(def.defaultValue ?? "").trim().replace(/\s+/g, " ");
      const text = typeof raw === "string"
        ? raw.trim().replace(/\s+/g, " ")
        : "";
      return (text || fallback).slice(0, textMaxLength);
    };
    for (const name of activeCharacters) {
      if (seeded[statId][name] !== undefined) {
        seeded[statId][name] = normalizeValue(seeded[statId][name]);
        continue;
      }
      const configured = getConfiguredCharacterDefaults(context, settingsInput, name);
      const configuredValue = configured.customNonNumericStatDefaults?.[statId];
      if (configuredValue !== undefined) {
        seeded[statId][name] = normalizeValue(configuredValue);
        continue;
      }
      seeded[statId][name] = normalizeValue(undefined);
    }
  }

  return seeded;
}

function seedHistoryForActiveCharacters(
  history: TrackerData[],
  activeCharacters: string[],
  settingsInput: BetterSimTrackerSettings,
  context: STContext | null,
): TrackerData[] {
  return history.map(entry => ({
    ...entry,
    statistics: buildSeededStatisticsForActiveCharacters(entry.statistics, activeCharacters, settingsInput, context),
    customStatistics: buildSeededCustomStatisticsForActiveCharacters(
      entry.customStatistics,
      activeCharacters,
      settingsInput,
      context,
    ),
    customNonNumericStatistics: buildSeededCustomNonNumericStatisticsForActiveCharacters(
      entry.customNonNumericStatistics,
      activeCharacters,
      settingsInput,
      context,
    ),
  }));
}

function buildBaselineData(activeCharacters: string[], s: BetterSimTrackerSettings): TrackerData {
  const context = getSafeContext();

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
    custom: Record<string, number>;
    customNonNumeric: Record<string, string | boolean>;
  } => {
    const contextual = inferFromContext(name);
    const defaults = getConfiguredCharacterDefaults(context, s, name);
    const customDefaults: Record<string, number> = {};
    const customNonNumericDefaults: Record<string, string | boolean> = {};
    for (const def of s.customStats ?? []) {
      const kind = def.kind ?? "numeric";
      const statId = String(def.id ?? "").trim().toLowerCase();
      if (!statId) continue;
      if (kind === "numeric") {
        const configuredCustom = defaults.customStatDefaults?.[statId];
        const fallback = Number(def.defaultValue);
        customDefaults[statId] = pickNumber(configuredCustom, Number.isNaN(fallback) ? 50 : fallback);
      } else if (kind === "boolean") {
        const configuredCustom = defaults.customNonNumericStatDefaults?.[statId];
        customNonNumericDefaults[statId] = typeof configuredCustom === "boolean"
          ? configuredCustom
          : (typeof def.defaultValue === "boolean" ? def.defaultValue : false);
      } else {
        const configuredCustom = defaults.customNonNumericStatDefaults?.[statId];
        const text = typeof configuredCustom === "string"
          ? configuredCustom.trim()
          : String(def.defaultValue ?? "").trim();
        customNonNumericDefaults[statId] = text;
      }
    }
    const hasAnyExplicitDefaults =
      defaults.affection !== undefined ||
      defaults.trust !== undefined ||
      defaults.desire !== undefined ||
      defaults.connection !== undefined ||
      defaults.mood !== undefined ||
      Object.keys(defaults.customStatDefaults ?? {}).length > 0 ||
      Object.keys(defaults.customNonNumericStatDefaults ?? {}).length > 0;

    if (hasAnyExplicitDefaults) {
      return {
        affection: pickNumber(defaults.affection, contextual.affection),
        trust: pickNumber(defaults.trust, contextual.trust),
        desire: pickNumber(defaults.desire, contextual.desire),
        connection: pickNumber(defaults.connection, contextual.connection),
        mood: pickText(defaults.mood, contextual.mood),
        custom: customDefaults,
        customNonNumeric: customNonNumericDefaults,
      };
    }

    return { ...contextual, custom: customDefaults, customNonNumeric: customNonNumericDefaults };
  };

  const baselinePerCharacter = new Map<string, ReturnType<typeof getCardDefaults>>();
  for (const name of activeCharacters) {
    baselinePerCharacter.set(name, getCardDefaults(name));
  }

  const customStatistics: CustomStatistics = {};
  const customNonNumericStatistics: CustomNonNumericStatistics = {};
  for (const def of s.customStats ?? []) {
    const kind = def.kind ?? "numeric";
    const statId = String(def.id ?? "").trim().toLowerCase();
    if (!statId) continue;
    if (kind === "numeric") {
      const fallback = Number(def.defaultValue);
      customStatistics[statId] = Object.fromEntries(
        activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.custom?.[statId] ?? (Number.isNaN(fallback) ? 50 : fallback)]),
      );
    } else {
      customNonNumericStatistics[statId] = Object.fromEntries(
        activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.customNonNumeric?.[statId] ?? (kind === "boolean" ? false : String(def.defaultValue ?? "").trim())]),
      );
    }
  }

  return {
    timestamp: Date.now(),
    activeCharacters,
    statistics: {
      affection: s.trackAffection
        ? Object.fromEntries(activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.affection ?? s.defaultAffection]))
        : {},
      trust: s.trackTrust
        ? Object.fromEntries(activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.trust ?? s.defaultTrust]))
        : {},
      desire: s.trackDesire
        ? Object.fromEntries(activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.desire ?? s.defaultDesire]))
        : {},
      connection: s.trackConnection
        ? Object.fromEntries(activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.connection ?? s.defaultConnection]))
        : {},
      mood: s.trackMood
        ? Object.fromEntries(activeCharacters.map(name => [name, baselinePerCharacter.get(name)?.mood ?? s.defaultMood]))
        : {},
      lastThought: s.trackLastThought
        ? Object.fromEntries(activeCharacters.map(name => [name, ""]))
        : {}
    },
    customStatistics,
    customNonNumericStatistics,
  };
}

function getSafeContext(): STContext | null {
  return getContext();
}

function sanitizeInvalidChatEntries(context: STContext): number {
  if (!Array.isArray(context.chat) || context.chat.length === 0) return 0;
  let removed = 0;
  for (let i = context.chat.length - 1; i >= 0; i -= 1) {
    const message = context.chat[i] as unknown;
    if (!message || typeof message !== "object") {
      context.chat.splice(i, 1);
      removed += 1;
    }
  }
  if (removed > 0) {
    context.saveChatDebounced?.();
  }
  return removed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function isSummaryNoteMessage(message: unknown): message is Record<string, unknown> {
  const obj = asRecord(message);
  if (!obj) return false;
  const extra = asRecord(obj.extra);
  if (extra) {
    if (extra.bstSummaryNote === true || extra.bst_summary_note === true) return true;
    if (String(extra.model ?? "").trim().toLowerCase() === "bettersimtracker.summary") return true;
  }
  return false;
}

async function reloadCurrentChatViewAfterSummarySync(): Promise<void> {
  if (summaryVisibilityReloadInFlight) return;
  summaryVisibilityReloadInFlight = true;
  try {
    const loadScriptModule = Function("return import('/script.js')") as () => Promise<unknown>;
    const module = await loadScriptModule() as { reloadCurrentChat?: () => Promise<void> | void };
    if (typeof module.reloadCurrentChat === "function") {
      await module.reloadCurrentChat();
    }
  } catch {
    // ignore: best-effort UI refresh only
  } finally {
    summaryVisibilityReloadInFlight = false;
  }
}

function syncSummaryNoteVisibilityForCurrentChat(context: STContext, visibleForAi: boolean): number {
  if (!Array.isArray(context.chat) || context.chat.length === 0) return 0;
  let changedCount = 0;

  for (let i = 0; i < context.chat.length; i += 1) {
    const message = context.chat[i] as unknown as Record<string, unknown>;
    if (!isSummaryNoteMessage(message)) continue;

    let changed = false;
    const targetIsSystem = !visibleForAi;

    if (message.is_user !== false) {
      message.is_user = false;
      changed = true;
    }
    if (message.is_system !== targetIsSystem) {
      message.is_system = targetIsSystem;
      changed = true;
    }
    if (String(message.name ?? "").trim() !== "Note") {
      message.name = "Note";
      changed = true;
    }
    if (String(message.force_avatar ?? "").trim() !== "img/quill.png") {
      message.force_avatar = "img/quill.png";
      changed = true;
    }

    let extra = asRecord(message.extra);
    if (!extra) {
      extra = {};
      message.extra = extra;
      changed = true;
    }

    if (extra.bstSummaryNote !== true) {
      extra.bstSummaryNote = true;
      changed = true;
    }
    if (extra.bst_summary_note !== true) {
      extra.bst_summary_note = true;
      changed = true;
    }
    if (String(extra.model ?? "").trim() !== "bettersimtracker.summary") {
      extra.model = "bettersimtracker.summary";
      changed = true;
    }
    if (String(extra.api ?? "").trim() !== "manual") {
      extra.api = "manual";
      changed = true;
    }
    if (extra.swipeable !== false) {
      extra.swipeable = false;
      changed = true;
    }
    if (extra.isSmallSys !== false) {
      extra.isSmallSys = false;
      changed = true;
    }

    const currentType = String(extra.type ?? "").trim();
    if (targetIsSystem) {
      if (currentType !== "comment") {
        extra.type = "comment";
        changed = true;
      }
    } else if ("type" in extra) {
      delete extra.type;
      changed = true;
    }

    if ("swipes" in message) {
      delete message.swipes;
      changed = true;
    }
    if ("swipe_id" in message) {
      delete message.swipe_id;
      changed = true;
    }
    if ("swipe_info" in message) {
      delete message.swipe_info;
      changed = true;
    }

    if (changed) {
      changedCount += 1;
    }
  }

  if (changedCount > 0) {
    context.saveChatDebounced?.();
  }
  return changedCount;
}

function getEventMessageIndex(payload: unknown): number | null {
  if (typeof payload === "number") return Number.isInteger(payload) ? payload : null;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidate = obj.message ?? obj.messageId ?? obj.id;
  if (typeof candidate !== "number") return null;
  return Number.isInteger(candidate) ? candidate : null;
}

type ManualEditPayload = {
  messageIndex: number;
  character: string;
  numeric: Record<string, number | null>;
  nonNumeric?: Record<string, string | boolean | null>;
  mood?: string | null;
  lastThought?: string | null;
};

function normalizeEditMood(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return EDIT_MOOD_LABELS.get(key) ?? null;
}

function clampEditedNumber(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function filterStatisticsToCharacters(
  statistics: Statistics,
  allowedCharacters: string[],
): Statistics {
  const allowed = new Set(allowedCharacters.map(name => String(name ?? "").trim()).filter(Boolean));
  const filterMap = (map: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (!map || typeof map !== "object") return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map)) {
      if (allowed.has(String(key ?? "").trim())) out[key] = value;
    }
    return out;
  };
  return {
    affection: filterMap(statistics.affection),
    trust: filterMap(statistics.trust),
    desire: filterMap(statistics.desire),
    connection: filterMap(statistics.connection),
    mood: filterMap(statistics.mood),
    lastThought: filterMap(statistics.lastThought),
  } as Statistics;
}

function filterCustomStatisticsToCharacters(
  customStatistics: CustomStatistics,
  allowedCharacters: string[],
): CustomStatistics {
  const allowed = new Set(allowedCharacters.map(name => String(name ?? "").trim()).filter(Boolean));
  const out: CustomStatistics = {};
  for (const [statId, byCharacter] of Object.entries(customStatistics ?? {})) {
    const filtered: Record<string, number> = {};
    for (const [name, value] of Object.entries(byCharacter ?? {})) {
      if (!allowed.has(String(name ?? "").trim())) continue;
      const num = Number(value);
      if (Number.isNaN(num)) continue;
      filtered[name] = num;
    }
    if (Object.keys(filtered).length) out[statId] = filtered;
  }
  return out;
}

function filterCustomNonNumericStatisticsToCharacters(
  customStatistics: CustomNonNumericStatistics,
  allowedCharacters: string[],
): CustomNonNumericStatistics {
  const allowed = new Set(allowedCharacters.map(name => String(name ?? "").trim()).filter(Boolean));
  const out: CustomNonNumericStatistics = {};
  for (const [statId, byCharacter] of Object.entries(customStatistics ?? {})) {
    const filtered: Record<string, string | boolean> = {};
    for (const [name, value] of Object.entries(byCharacter ?? {})) {
      if (!allowed.has(String(name ?? "").trim())) continue;
      if (typeof value === "boolean") {
        filtered[name] = value;
      } else {
        const text = String(value ?? "").trim();
        if (!text) continue;
        filtered[name] = text;
      }
    }
    if (Object.keys(filtered).length) out[statId] = filtered;
  }
  return out;
}

function applyManualTrackerEdits(payload: ManualEditPayload): void {
  const context = getSafeContext();
  if (!context || !settings) return;
  const messageIndex = Number(payload.messageIndex);
  if (!Number.isFinite(messageIndex) || messageIndex < 0 || messageIndex >= context.chat.length) return;
  const character = String(payload.character ?? "").trim();
  if (!character) return;

  const message = context.chat[messageIndex];
  if (!isTrackableMessage(message)) return;
  const current = getTrackerDataFromMessage(message);
  if (!current) return;

  const stats: Statistics = {
    affection: { ...current.statistics.affection },
    trust: { ...current.statistics.trust },
    desire: { ...current.statistics.desire },
    connection: { ...current.statistics.connection },
    mood: { ...current.statistics.mood },
    lastThought: { ...current.statistics.lastThought },
  };
  const custom: CustomStatistics = {};
  const customNonNumeric: CustomNonNumericStatistics = {};
  for (const [key, values] of Object.entries(current.customStatistics ?? {})) {
    custom[key] = { ...(values ?? {}) };
  }
  for (const [key, values] of Object.entries(current.customNonNumericStatistics ?? {})) {
    customNonNumeric[key] = { ...(values ?? {}) };
  }

  for (const [rawKey, rawValue] of Object.entries(payload.numeric ?? {})) {
    const statKey = rawKey.trim().toLowerCase();
    if (!statKey) continue;
    if (BUILT_IN_NUMERIC_KEYS.has(statKey)) {
      const bucket = stats[statKey as "affection" | "trust" | "desire" | "connection"];
      if (rawValue == null) {
        delete bucket[character];
      } else if (Number.isFinite(rawValue)) {
        bucket[character] = clampEditedNumber(rawValue);
      }
      continue;
    }
    if (rawValue == null) {
      if (custom[statKey]) {
        delete custom[statKey][character];
        if (Object.keys(custom[statKey]).length === 0) {
          delete custom[statKey];
        }
      }
      continue;
    }
    if (!Number.isFinite(rawValue)) continue;
    if (!custom[statKey]) custom[statKey] = {};
    custom[statKey][character] = clampEditedNumber(rawValue);
  }

  for (const [rawKey, rawValue] of Object.entries(payload.nonNumeric ?? {})) {
    const statKey = rawKey.trim().toLowerCase();
    if (!statKey) continue;
    if (rawValue == null) {
      if (customNonNumeric[statKey]) {
        delete customNonNumeric[statKey][character];
        if (Object.keys(customNonNumeric[statKey]).length === 0) {
          delete customNonNumeric[statKey];
        }
      }
      continue;
    }
    if (!customNonNumeric[statKey]) customNonNumeric[statKey] = {};
    if (typeof rawValue === "boolean") {
      customNonNumeric[statKey][character] = rawValue;
      continue;
    }
    const text = String(rawValue).trim().replace(/\s+/g, " ");
    customNonNumeric[statKey][character] = text.slice(0, 200);
  }

  if (payload.mood !== undefined) {
    const moodValue = normalizeEditMood(payload.mood);
    if (!moodValue) {
      delete stats.mood[character];
    } else {
      stats.mood[character] = moodValue;
    }
  }

  if (payload.lastThought !== undefined) {
    const thought = String(payload.lastThought ?? "").trim();
    if (!thought) {
      delete stats.lastThought[character];
    } else {
      stats.lastThought[character] = thought.slice(0, 600);
    }
  }

  const next: TrackerData = {
    timestamp: Date.now(),
    activeCharacters: Array.isArray(current.activeCharacters) ? [...current.activeCharacters] : [],
    statistics: stats,
    customStatistics: Object.keys(custom).length ? custom : undefined,
    customNonNumericStatistics: Object.keys(customNonNumeric).length ? customNonNumeric : undefined,
  };

  writeTrackerDataToMessage(context, next, messageIndex);
  context.saveChatDebounced?.();
  void context.saveChat?.();
  pushTrace("tracker.edit", { messageIndex, character });
  refreshFromStoredData();
}

function summarizeGraphSeries(history: TrackerData[], characterName: string): {
  snapshots: number;
  fromTs: number | null;
  toTs: number | null;
  latest: { affection: number; trust: number; desire: number; connection: number } | null;
  series: { affection: number[]; trust: number[]; desire: number[]; connection: number[] };
  customLatest: Record<string, number>;
  customSeries: Record<string, number[]>;
} {
  const allNumericDefs = settings ? getAllNumericStatDefinitions(settings) : [];
  const numericStatIds = new Set<string>(allNumericDefs.map(def => def.id));
  const builtInKeys = new Set(["affection", "trust", "desire", "connection"]);
  const sorted = [...history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item =>
      Array.from(numericStatIds).some(statId =>
        builtInKeys.has(statId)
          ? (item.statistics[statId as "affection" | "trust" | "desire" | "connection"]?.[characterName] !== undefined)
          : (item.customStatistics?.[statId]?.[characterName] !== undefined),
      ) ||
      item.statistics.mood?.[characterName] !== undefined ||
      item.statistics.lastThought?.[characterName] !== undefined,
    );
  const build = (key: string, defaultValue = 50): number[] => {
    let carry = Math.max(0, Math.min(100, Math.round(defaultValue)));
    return sorted.map(item => {
      const raw = builtInKeys.has(key)
        ? item.statistics[key as "affection" | "trust" | "desire" | "connection"]?.[characterName]
        : item.customStatistics?.[key]?.[characterName];
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
  const customDefs = allNumericDefs.filter(def => !builtInKeys.has(def.id));
  const customSeries: Record<string, number[]> = {};
  const customLatest: Record<string, number> = {};
  for (const def of customDefs) {
    const seriesValues = build(def.id, def.defaultValue);
    customSeries[def.id] = seriesValues;
    customLatest[def.id] = seriesValues.length ? seriesValues[seriesValues.length - 1] : Math.max(0, Math.min(100, Math.round(def.defaultValue)));
  }
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
    series: { affection, trust, desire, connection },
    customLatest,
    customSeries,
  };
}

async function sendTrackerSummaryToChat(messageIndex: number): Promise<void> {
  const context = getSafeContext();
  if (!context || !settings) return;
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= context.chat.length) return;
  if (activeSummaryRuns.has(messageIndex)) {
    pushTrace("summary.skip", { reason: "already_running", messageIndex });
    return;
  }

  const message = context.chat[messageIndex];
  const messageData = getTrackerDataFromMessage(message);
  const data = messageData ?? (latestDataMessageIndex === messageIndex ? latestData : null);
  if (!data) {
    pushTrace("summary.skip", { reason: "no_tracker_data", messageIndex });
    return;
  }
  pushTrace("summary.start", { messageIndex });
  activeSummaryRuns.add(messageIndex);
  queueRender();
  try {
    let summaryBody = "";
    let aiProfileId: string | null = null;
    let usedFallback = false;

    try {
      const generated = await generateTrackerSummaryProse({
        context,
        settings,
        data,
        messageIndex,
      });
      summaryBody = generated.text;
      aiProfileId = generated.profileId;
    } catch (error) {
      usedFallback = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      pushTrace("summary.ai.error", {
        messageIndex,
        error: errorMessage,
      });
      summaryBody = buildFallbackSummaryProse(data, settings);
    }

    const normalizedBody = normalizeSummaryProse(summaryBody) || "The current relationship state remains steady with no major shifts to report.";
    const summaryText = wrapAsSystemNarrativeText(normalizedBody);
    const delivery = await sendSummaryAsSystemMessage(context, summaryText, settings.summarizationNoteVisibleForAI);
    context.saveChatDebounced?.();
    await context.saveChat?.();
    pushTrace("summary.sent", {
      messageIndex,
      activeCharacters: data.activeCharacters.length,
      charCount: collectSummaryCharacters(data).length,
      textChars: summaryText.length,
      delivery,
      aiProfileId,
      usedFallback,
    });
  } finally {
    activeSummaryRuns.delete(messageIndex);
    queueRender();
  }
}

async function runExtraction(reason: string, targetMessageIndex?: number): Promise<void> {
  const context = getSafeContext();
  if (!context) return;
  const userExtraction = isUserExtractionReason(reason);
  const clearGeneratingUiIfStale = (skipReason: string): void => {
    if (trackerUiState.phase !== "generating") return;
    if (chatGenerationInFlight) return;
    pushTrace("ui.generating.clear", {
      reason: skipReason,
      trigger: reason,
      messageIndex: latestDataMessageIndex,
    });
    setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
    queueRender();
  };
  if (!settings?.enabled) return;
  const activeSettings = settings;
  if (context.chat.length === 0) return;
  if (isExtracting) {
    pushTrace("extract.skip", { reason: "already_extracting", trigger: reason });
    clearGeneratingUiIfStale("already_extracting");
    return;
  }

  if (userExtraction && !hasUserTrackingEnabledForExtraction(activeSettings)) {
    pushTrace("extract.skip", { reason: "user_tracking_disabled", trigger: reason });
    return;
  }

  let lastIndex: number | null = null;
  if (typeof targetMessageIndex === "number" && targetMessageIndex >= 0 && targetMessageIndex < context.chat.length) {
    const target = context.chat[targetMessageIndex];
    if ((userExtraction && isTrackableUserMessage(target)) || (!userExtraction && isTrackableAiMessage(target))) {
      lastIndex = targetMessageIndex;
    }
  }
  if (lastIndex == null) {
    lastIndex = userExtraction ? getLastMessageIndexIfUser(context) : getLastMessageIndexIfAi(context);
  }
  if (lastIndex == null) {
    const skipReason = userExtraction ? "no_user_message" : "no_ai_message";
    pushTrace("extract.skip", { reason: skipReason, trigger: reason });
    clearGeneratingUiIfStale(skipReason);
    return;
  }
  const lastMessage = context.chat[lastIndex];
  const forceRetrack =
    reason === "manual_refresh" ||
    reason === "SWIPE_GENERATION_ENDED" ||
    reason === "USER_MESSAGE_RENDERED" ||
    reason === "USER_MESSAGE_EDITED" ||
    (reason === "MESSAGE_EDITED" && typeof targetMessageIndex === "number");
  if (!forceRetrack && getTrackerDataFromMessage(lastMessage)) {
    pushTrace("extract.skip", { reason: "tracker_already_present", trigger: reason, messageIndex: lastIndex });
    clearGeneratingUiIfStale("tracker_already_present");
    return;
  }

  isExtracting = true;
  const runId = ++runSequence;
  activeExtractionRunId = runId;
  cancelledExtractionRuns.delete(runId);
  pushTrace("extract.start", {
    runId,
    reason,
    targetMessageIndex: targetMessageIndex ?? null,
    resolvedMessageIndex: lastIndex
  });
  setTrackerUi(context, { phase: "extracting", done: 0, total: 1, messageIndex: lastIndex, stepLabel: "Preparing context" });
  queueRender();

  try {
    const activity = resolveActiveCharacterAnalysis(context, activeSettings);
    lastActivityAnalysis = activity;
    allCharacterNames = activity.allCharacterNames;
    if (activeSettings.enableUserTracking && !allCharacterNames.includes(USER_TRACKER_KEY)) {
      allCharacterNames = [...allCharacterNames, USER_TRACKER_KEY];
    }
    const activeCharacters = userExtraction ? [USER_TRACKER_KEY] : activity.activeCharacters;
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
    const scopedCustomStats = (activeSettings.customStats ?? []).map(stat => {
      const trackCharacters = Boolean(stat.trackCharacters ?? stat.track);
      const trackUser = Boolean(stat.trackUser ?? stat.track);
      return {
        ...stat,
        trackCharacters,
        trackUser,
        track: userExtraction ? trackUser : trackCharacters,
      };
    });

    const runScopedSettings: BetterSimTrackerSettings = userExtraction
      ? {
          ...activeSettings,
          trackAffection: false,
          trackTrust: false,
          trackDesire: false,
          trackConnection: false,
          trackMood: activeSettings.userTrackMood,
          trackLastThought: activeSettings.userTrackLastThought,
          customStats: scopedCustomStats,
        }
      : {
          ...activeSettings,
          customStats: scopedCustomStats,
        };

    const previousEntry =
      typeof targetMessageIndex === "number" && targetMessageIndex >= 0
        ? getLatestTrackerDataWithIndexBefore(context, targetMessageIndex)
        : getLatestTrackerDataWithIndex(context);
    let previous = previousEntry?.data ?? null;
    if (!previous) {
      previous = buildBaselineData(activeCharacters, runScopedSettings);
      pushTrace("extract.baseline", { runId, forMessageIndex: lastIndex, activeCharacters: activeCharacters.length });
    }

    const userName = context.name1 ?? "User";
    const preferredCharacterName = !userExtraction
      ? String(lastMessage?.name ?? "").trim() || undefined
      : undefined;
    let contextText = buildRecentContext(context, settings.contextMessages);
    if (activeSettings.includeCharacterCardsInPrompt) {
      contextText = `${contextText}${buildCharacterCardsContext(context, activeCharacters)}`.trim();
    }
    if (activeSettings.includeLorebookInExtraction) {
      contextText = `${contextText}${buildLorebookExtractionContext(context, activeSettings.lorebookExtractionMaxChars)}`.trim();
    }
    const previousSeededStatistics = buildSeededStatisticsForActiveCharacters(
      previous?.statistics ?? null,
      activeCharacters,
      runScopedSettings,
      context,
    );
    const previousSeededCustomStatistics = buildSeededCustomStatisticsForActiveCharacters(
      previous?.customStatistics ?? null,
      activeCharacters,
      runScopedSettings,
      context,
    );
    const previousSeededCustomNonNumericStatistics = buildSeededCustomNonNumericStatisticsForActiveCharacters(
      previous?.customNonNumericStatistics ?? null,
      activeCharacters,
      runScopedSettings,
      context,
    );
    const seededHistory = seedHistoryForActiveCharacters(
      getRecentTrackerHistory(context, 6),
      activeCharacters,
      runScopedSettings,
      context,
    );

    logDebug(activeSettings, "extraction", `Extraction started (${reason})`, {
      activeCharacters,
      allCharacterNames,
      runId
    });

    const shouldForceSingleRequestAtStart =
      !userExtraction &&
      reason === "GENERATION_ENDED" &&
      !previousEntry?.data &&
      activeSettings.sequentialExtraction &&
      (activeSettings.maxConcurrentCalls ?? 1) > 1;
    const extractionSettings: BetterSimTrackerSettings = shouldForceSingleRequestAtStart
      ? { ...runScopedSettings, maxConcurrentCalls: 1 }
      : runScopedSettings;
    const hasEnabledStatsForRun =
      extractionSettings.trackAffection ||
      extractionSettings.trackTrust ||
      extractionSettings.trackDesire ||
      extractionSettings.trackConnection ||
      extractionSettings.trackMood ||
      extractionSettings.trackLastThought ||
      (extractionSettings.customStats ?? []).some(stat => Boolean(stat.track));
    if (!hasEnabledStatsForRun) {
      pushTrace("extract.skip", { reason: "no_enabled_stats", trigger: reason, runId });
      return;
    }
    if (shouldForceSingleRequestAtStart) {
      pushTrace("extract.force_single_request_start", {
        runId,
        reason,
        messageIndex: lastIndex,
        maxConcurrentCalls: activeSettings.maxConcurrentCalls
      });
    }

    const extractedResult = await extractStatisticsParallel({
      settings: extractionSettings,
      userName,
      activeCharacters,
      preferredCharacterName,
      contextText,
      previousStatistics: previousSeededStatistics,
      previousCustomStatistics: previousSeededCustomStatistics,
      previousCustomStatisticsRaw: previousEntry?.data?.customStatistics ?? null,
      previousCustomNonNumericStatistics: previousSeededCustomNonNumericStatistics,
      hasPriorTrackerData: Boolean(previousEntry?.data),
      history: seededHistory,
      isCancelled: () => cancelledExtractionRuns.has(runId),
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
    const extractedCustom = extractedResult.customStatistics;
    const extractedCustomNonNumeric = extractedResult.customNonNumericStatistics;
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

    const mergeSettings: BetterSimTrackerSettings = {
      ...activeSettings,
      trackMood: activeSettings.trackMood || (activeSettings.enableUserTracking && activeSettings.userTrackMood),
      trackLastThought: activeSettings.trackLastThought || (activeSettings.enableUserTracking && activeSettings.userTrackLastThought),
    };
    let merged = mergeStatisticsWithFallback(extracted, previous?.statistics ?? null, mergeSettings);
    let mergedCustom = mergeCustomStatisticsWithFallback(extractedCustom, previous?.customStatistics ?? null);
    let mergedCustomNonNumeric = mergeCustomNonNumericStatisticsWithFallback(
      extractedCustomNonNumeric,
      previous?.customNonNumericStatistics ?? null,
    );
    if (userExtraction) {
      merged = filterStatisticsToCharacters(merged, [USER_TRACKER_KEY]);
      mergedCustom = filterCustomStatisticsToCharacters(mergedCustom, [USER_TRACKER_KEY]);
      mergedCustomNonNumeric = filterCustomNonNumericStatisticsToCharacters(mergedCustomNonNumeric, [USER_TRACKER_KEY]);
    }

    latestData = {
      timestamp: Date.now(),
      activeCharacters,
      statistics: merged,
      customStatistics: mergedCustom,
      customNonNumericStatistics: mergedCustomNonNumeric,
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
    logDebug(activeSettings, "extraction", `Extraction finished (${reason})`);
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
    cancelledExtractionRuns.delete(runId);
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
  if (settings.enableUserTracking && !allCharacterNames.includes(USER_TRACKER_KEY)) {
    allCharacterNames = [...allCharacterNames, USER_TRACKER_KEY];
  }
  const latestEntry = getLatestTrackerDataWithIndex(context);
  const chatStateEntry = getChatStateLatestTrackerData(context);
  const metadataEntry = getMetadataLatestTrackerData(context);
  const localEntry = getLocalLatestTrackerData(context);
  const lastTrackableIndex = getLastTrackableMessageIndex(context);
  const isEntrySafeForCurrentLastAi = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (lastTrackableIndex == null) return false;
    if (entry.messageIndex !== lastTrackableIndex) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    const message = context.chat[entry.messageIndex];
    return isTrackableMessage(message);
  };
  const isEntrySafeForAnyChatMessage = (entry: { data: TrackerData; messageIndex: number } | null): boolean => {
    if (!entry) return false;
    if (entry.messageIndex < 0 || entry.messageIndex >= context.chat.length) return false;
    return isTrackableMessage(context.chat[entry.messageIndex]);
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

  if (lastTrackableIndex != null && latestData && source === "message") {
    latestDataMessageIndex = lastTrackableIndex;
  } else if (!latestData) {
    latestDataMessageIndex = null;
  } else if (latestData && lastTrackableIndex == null) {
    scheduleRefresh(300);
  }
  if (trackerUiState.phase === "idle") {
    trackerUiState = { ...trackerUiState, messageIndex: latestDataMessageIndex };
  } else if (trackerUiState.phase === "generating" && !chatGenerationInFlight && !isExtracting) {
    setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
  }
  pushTrace("refresh.resolve", {
    source,
    lastAiIndex: getLastAiMessageIndex(context),
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
      queueRender();
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
      if (trackerUiState.phase === "generating") {
        pushTrace("ui.generating.clear", {
          reason: "generation_ended_without_inflight",
          trigger: "GENERATION_ENDED",
          messageIndex: latestDataMessageIndex,
        });
        setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
        queueRender();
      }
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
    if (swipeGenerationActive) {
      swipeGenerationActive = false;
      if (pendingSwipeExtraction?.waitForGenerationEnd) {
        pendingSwipeExtraction = null;
        if (swipeExtractionTimer !== null) {
          window.clearTimeout(swipeExtractionTimer);
          swipeExtractionTimer = null;
        }
      }
      scheduleExtraction("SWIPE_GENERATION_ENDED", undefined, 2000);
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
    scheduleExtraction("GENERATION_ENDED", undefined, 2000);
  });

  source.on(events.CHAT_CHANGED, () => {
    chatGenerationInFlight = false;
    chatGenerationSawCharacterRender = false;
    chatGenerationStartLastAiIndex = null;
    swipeGenerationActive = false;
    lastActivatedLorebookEntries = [];
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
      if (!settings || !hasUserTrackingEnabledForExtraction(settings)) {
        pushTrace("extract.skip", { reason: "user_tracking_disabled", trigger: "USER_MESSAGE_RENDERED" });
        return;
      }
      scheduleExtraction("USER_MESSAGE_RENDERED", undefined, 220);
    });
  }

  if (events.CHAT_LOADED) {
    source.on(events.CHAT_LOADED, () => {
      chatGenerationInFlight = false;
      chatGenerationSawCharacterRender = false;
      chatGenerationStartLastAiIndex = null;
      swipeGenerationActive = false;
      lastActivatedLorebookEntries = [];
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

  if (events.WORLD_INFO_ACTIVATED) {
    source.on(events.WORLD_INFO_ACTIVATED, (payload: unknown) => {
      const acceptedCount = cacheLorebookActivatedEntries(context, payload);
      const activatedCount = Array.isArray(payload) ? payload.length : undefined;
      pushTrace("event.world_info_activated", {
        activatedCount: activatedCount ?? null,
        acceptedCount,
        payload: describeLorebookPayload(payload),
      });
      queuePromptSync(context);
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
      lastActivatedLorebookEntries = [];
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
      if (messageIndex == null || messageIndex < 0 || messageIndex >= context.chat.length) {
        pushTrace("extract.skip", {
          reason: "edited_message_index_unknown",
          trigger: "MESSAGE_EDITED",
          messageIndex: messageIndex ?? null,
        });
        return;
      }
      const editedMessage = context.chat[messageIndex];
      const editedIsAi = isTrackableAiMessage(editedMessage);
      const editedIsUser = isTrackableUserMessage(editedMessage);
      if (!editedIsAi && !editedIsUser) {
        pushTrace("extract.skip", {
          reason: "edited_message_not_trackable",
          trigger: "MESSAGE_EDITED",
          messageIndex,
        });
        return;
      }
      if (editedIsUser && settings && !hasUserTrackingEnabledForExtraction(settings)) {
        pushTrace("extract.skip", {
          reason: "user_tracking_disabled",
          trigger: "MESSAGE_EDITED",
          messageIndex,
        });
        return;
      }
      if (!getTrackerDataFromMessage(editedMessage)) {
        pushTrace("extract.skip", {
          reason: "edited_message_has_no_tracker_data",
          trigger: "MESSAGE_EDITED",
          messageIndex,
        });
        return;
      }
      scheduleExtraction(editedIsUser ? "USER_MESSAGE_EDITED" : "MESSAGE_EDITED", messageIndex);
    });
  }

  const swipeEvents = ["MESSAGE_SWIPED", "SWIPE_CHANGED", "MESSAGE_SWIPE_CHANGED", "MESSAGE_SWIPE_DELETED"];
  for (const key of swipeEvents) {
    const eventName = events[key];
    if (!eventName) continue;
    source.on(eventName, (payload: unknown) => {
      const messageIndex = getEventMessageIndex(payload);
      pushTrace("event.swipe", { event: key, messageIndex });
      clearPendingSwipeExtraction();
      if (!chatGenerationInFlight) {
        chatGenerationSawCharacterRender = false;
        chatGenerationStartLastAiIndex = null;
        swipeGenerationActive = false;
        if (trackerUiState.phase === "generating") {
          pushTrace("ui.generating.clear", {
            reason: "swipe_event_force_idle",
            trigger: key,
            messageIndex: latestDataMessageIndex,
          });
          setTrackerUi(context, { phase: "idle", done: 0, total: 0, messageIndex: latestDataMessageIndex, stepLabel: null });
          queueRender();
        }
      }
      scheduleRefresh();
      pushTrace("extract.skip", {
        reason: "swipe_event_no_auto_retrack",
        trigger: key,
        messageIndex: messageIndex ?? null,
      });
    });
  }
}

function openSettings(): void {
  if (!settings) return;
  const context = getSafeContext();
  const previewCandidateMap = new Map<string, { name: string; avatar?: string | null }>();
  for (const character of context?.characters ?? []) {
    const name = String(character?.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!previewCandidateMap.has(key)) {
      previewCandidateMap.set(key, { name, avatar: String(character?.avatar ?? "").trim() || null });
    }
  }
  const fallbackName = String(context?.name2 ?? "").trim();
  if (fallbackName) {
    const key = fallbackName.toLowerCase();
    if (!previewCandidateMap.has(key)) {
      previewCandidateMap.set(key, { name: fallbackName, avatar: null });
    }
  }
  const previewCharacterCandidates = Array.from(previewCandidateMap.values());
  openSettingsModal({
    settings,
    profileOptions: context ? discoverConnectionProfiles(context) : [],
    previewCharacterCandidates,
    debugRecord: lastDebugRecord,
    injectedPrompt: settings.debug ? getLastInjectedPrompt() : "",
    onSave: next => {
      const activeContext = getSafeContext();
      if (!activeContext) return;
      settings = next;
      saveSettings(activeContext, settings);
      queueRender();
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
      const resolvedProfileId = resolveConnectionProfileId(currentSettings, activeContext);
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
        },
        customStatistics: entry.data.customStatistics ?? {},
        customNonNumericStatistics: entry.data.customNonNumericStatistics ?? {}
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
          resolvedProfileId: resolvedProfileId || null,
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
          injectPromptDepth: currentSettings.injectPromptDepth,
          injectionPromptMaxChars: currentSettings.injectionPromptMaxChars,
          summarizationNoteVisibleForAI: currentSettings.summarizationNoteVisibleForAI,
          injectSummarizationNote: currentSettings.injectSummarizationNote,
          contextMessages: currentSettings.contextMessages,
          maxConcurrentCalls: currentSettings.maxConcurrentCalls,
          maxDeltaPerTurn: currentSettings.maxDeltaPerTurn,
          maxTokensOverride: currentSettings.maxTokensOverride,
          truncationLengthOverride: currentSettings.truncationLengthOverride,
          includeCharacterCardsInPrompt: currentSettings.includeCharacterCardsInPrompt,
          includeLorebookInExtraction: currentSettings.includeLorebookInExtraction,
          lorebookExtractionMaxChars: currentSettings.lorebookExtractionMaxChars,
          autoDetectActive: currentSettings.autoDetectActive,
          activityLookback: currentSettings.activityLookback,
          moodSource: currentSettings.moodSource,
          moodExpressionMap: currentSettings.moodExpressionMap,
          stExpressionImageZoom: currentSettings.stExpressionImageZoom,
          stExpressionImagePositionX: currentSettings.stExpressionImagePositionX,
          stExpressionImagePositionY: currentSettings.stExpressionImagePositionY,
          strictJsonRepair: currentSettings.strictJsonRepair,
          maxRetriesPerStat: currentSettings.maxRetriesPerStat,
          customStats: currentSettings.customStats
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
    chunks.push(`Character Card - ${name}\n${lines.join("\n")}`);
  }
  if (!chunks.length) return "";
  return `\n\nCharacter cards (use only to disambiguate if recent messages are unclear):\n${chunks.join("\n\n")}`;
}

function applyLorebookCharLimit(text: string, maxChars: number, maxCap = 12000): string {
  const requested = Number(maxChars);
  const limit = Number.isNaN(requested)
    ? 1200
    : Math.max(0, Math.min(maxCap, Math.round(requested)));
  const normalized = String(text ?? "").trim();
  if (!normalized) return "";
  if (limit === 0) return normalized;
  return normalized.slice(0, limit).trim();
}

function buildLorebookExtractionContext(context: STContext, maxChars: number): string {
  let lorebookText = readLorebookContext(context, maxChars, 12000);
  if (!lorebookText && lastActivatedLorebookEntries.length) {
    lorebookText = applyLorebookCharLimit(lastActivatedLorebookEntries.join("\n\n"), maxChars, 12000);
  }
  if (!lorebookText) return "";
  return `\n\nLorebook context (activated; use only to disambiguate if recent messages are unclear):\n${lorebookText}`;
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
  lastActivatedLorebookEntries = [];
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
