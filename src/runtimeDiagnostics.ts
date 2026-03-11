import type {
  BetterSimTrackerSettings,
  DeltaDebugRecord,
  STContext,
  TrackerData,
} from "./types";

type GraphPreferences = {
  window: "30" | "60" | "120" | "all";
  smoothing: boolean;
};

type ProfileDebug = {
  selectedProfile: string;
  resolvedProfileId: string | null;
  activeProfileId: string | null;
};

type SettingsProvenance = Record<string, "context" | "local" | "default">;

type ActivityAnalysis = {
  allCharacterNames: string[];
  activeCharacters: string[];
  reasons: Record<string, string>;
  lookback: number;
} | null;

type TrackerUiStateLike = {
  phase: "idle" | "extracting" | "generating";
  done: number;
  total: number;
  messageIndex: number | null;
  stepLabel?: string | null;
};

type PromptInjectionLastMessageSnapshot = {
  messageIndex: number;
  prompt: string;
  capturedAt: number;
  targetIndex: number | null;
  generationType: string;
} | null;

function summarizeTrackerData(data: TrackerData | null): Record<string, unknown> | null {
  if (!data) return null;
  return {
    timestamp: Number(data.timestamp ?? 0),
    activeCharacters: Array.isArray(data.activeCharacters) ? [...data.activeCharacters] : [],
    statistics: {
      affection: data.statistics.affection ?? {},
      trust: data.statistics.trust ?? {},
      desire: data.statistics.desire ?? {},
      connection: data.statistics.connection ?? {},
      mood: data.statistics.mood ?? {},
      lastThought: data.statistics.lastThought ?? {},
    },
    customStatistics: data.customStatistics ?? {},
    customNonNumericStatistics: data.customNonNumericStatistics ?? {},
  };
}

function buildPromptInjectionSummary(input: {
  latestDataMessageIndex: number | null;
  currentPrompt: string | undefined;
  previousMessage: PromptInjectionLastMessageSnapshot;
  latestDataMessagePrompt: string | null;
  promptInjectionDebugMeta: Record<string, unknown> | null;
  latestData: TrackerData | null;
  latestPromptMacroData: TrackerData | null;
  baselineDebugMeta: Record<string, unknown> | null;
}): Record<string, unknown> {
  const previousMessageIndex = input.previousMessage?.messageIndex ?? null;
  const currentPrompt = input.currentPrompt ?? "";
  const latestDataPrompt = input.latestDataMessagePrompt ?? "";
  const previousPrompt = input.previousMessage?.prompt ?? "";
  return {
    latestDataMessageIndex: input.latestDataMessageIndex,
    previousGeneratedMessageIndex: previousMessageIndex,
    currentPromptChars: currentPrompt.length,
    previousPromptChars: previousPrompt.length,
    latestDataPromptChars: latestDataPrompt.length,
    currentPromptMatchesLatestDataMessage: Boolean(currentPrompt && latestDataPrompt && currentPrompt === latestDataPrompt),
    previousPromptMatchesLatestDataMessage: Boolean(previousPrompt && latestDataPrompt && previousPrompt === latestDataPrompt),
    previousPromptTargetsLatestDataMessage:
      input.latestDataMessageIndex != null &&
      previousMessageIndex != null &&
      previousMessageIndex === input.latestDataMessageIndex,
    injectedOwnerLines: Array.isArray(input.promptInjectionDebugMeta?.ownerLines)
      ? (input.promptInjectionDebugMeta?.ownerLines as unknown[]).map(line => String(line ?? ""))
      : [],
    baseline: input.baselineDebugMeta,
    latestStoredTrackerData: summarizeTrackerData(input.latestData),
    latestPromptMacroData: summarizeTrackerData(input.latestPromptMacroData),
  };
}

export function filterDiagnosticsTrace(lines: string[], includeGraphInDiagnostics: boolean): string[] {
  if (includeGraphInDiagnostics) return lines;
  return lines.filter(line => !line.includes(" graph.open "));
}

export function buildHistorySample(entries: Array<{ data: TrackerData; timestamp: number; messageIndex: number }>): Array<{
  messageIndex: number;
  timestamp: number;
  activeCharacters: string[];
  statistics: TrackerData["statistics"];
  customStatistics: TrackerData["customStatistics"];
  customNonNumericStatistics: TrackerData["customNonNumericStatistics"];
}> {
  return entries.map(entry => ({
    messageIndex: entry.messageIndex,
    timestamp: entry.timestamp,
    activeCharacters: entry.data.activeCharacters,
    statistics: {
      affection: entry.data.statistics.affection,
      trust: entry.data.statistics.trust,
      desire: entry.data.statistics.desire,
      connection: entry.data.statistics.connection,
      mood: entry.data.statistics.mood,
      lastThought: entry.data.statistics.lastThought,
    },
    customStatistics: entry.data.customStatistics ?? {},
    customNonNumericStatistics: entry.data.customNonNumericStatistics ?? {},
  }));
}

export function filterDebugRecordForDiagnostics(
  record: DeltaDebugRecord | null,
  includeGraphInDiagnostics: boolean,
): DeltaDebugRecord | null {
  if (!record) return null;
  if (includeGraphInDiagnostics) return record;
  return {
    ...record,
    trace: filterDiagnosticsTrace(record.trace ?? [], includeGraphInDiagnostics),
  };
}

export function buildDiagnosticsReport(input: {
  context: STContext;
  settings: BetterSimTrackerSettings;
  extensionVersion: string;
  isExtracting: boolean;
  runSequence: number;
  trackerUiState: TrackerUiStateLike;
  latestDataMessageIndex: number | null;
  latestDataTimestamp: number | null;
  allCharacterNames: string[];
  settingsProvenance: SettingsProvenance;
  graphPreferences: GraphPreferences;
  profileDebug: ProfileDebug;
  historySample: ReturnType<typeof buildHistorySample>;
  activity: ActivityAnalysis;
  latestData: TrackerData | null;
  latestPromptMacroData: TrackerData | null;
  promptInjectionPreview: string | undefined;
  promptInjectionCurrentPrompt: string | undefined;
  promptInjectionLastMessage: PromptInjectionLastMessageSnapshot;
  promptInjectionPreviousMessage: PromptInjectionLastMessageSnapshot;
  promptInjectionLatestDataMessage: string | null;
  promptInjectionDebugMeta: Record<string, unknown> | null;
  macroDebugMeta: Record<string, unknown> | null;
  baselineDebugMeta: Record<string, unknown> | null;
  traceTailMemory: string[];
  traceTailPersisted: string[];
  debugRecord: DeltaDebugRecord | null;
}): Record<string, unknown> {
  const { context, settings } = input;
  return {
    extensionVersion: input.extensionVersion,
    timestamp: new Date().toISOString(),
    scope: context.groupId ? `group:${context.groupId}` : `char:${String(context.characterId ?? "unknown")}`,
    chatLength: context.chat.length,
    isExtracting: input.isExtracting,
    runSequence: input.runSequence,
    trackerUiState: input.trackerUiState,
    latestDataMessageIndex: input.latestDataMessageIndex,
    latestDataTimestamp: input.latestDataTimestamp,
    allCharacterNames: input.allCharacterNames,
    settingsProvenance: input.settingsProvenance,
    graphPreferences: input.graphPreferences,
    profileDebug: input.profileDebug,
    historySample: input.historySample,
    requestMeta: input.debugRecord?.meta?.requests ?? null,
    settings: {
      enabled: settings.enabled,
      debug: settings.debug,
      includeContextInDiagnostics: settings.includeContextInDiagnostics,
      includeGraphInDiagnostics: settings.includeGraphInDiagnostics,
      injectTrackerIntoPrompt: settings.injectTrackerIntoPrompt,
      injectPromptDepth: settings.injectPromptDepth,
      injectionPromptMaxChars: settings.injectionPromptMaxChars,
      summarizationNoteVisibleForAI: settings.summarizationNoteVisibleForAI,
      injectSummarizationNote: settings.injectSummarizationNote,
      contextMessages: settings.contextMessages,
      maxConcurrentCalls: settings.maxConcurrentCalls,
      maxDeltaPerTurn: settings.maxDeltaPerTurn,
      maxTokensOverride: settings.maxTokensOverride,
      truncationLengthOverride: settings.truncationLengthOverride,
      includeCharacterCardsInPrompt: settings.includeCharacterCardsInPrompt,
      includeLorebookInExtraction: settings.includeLorebookInExtraction,
      lorebookExtractionMaxChars: settings.lorebookExtractionMaxChars,
      autoDetectActive: settings.autoDetectActive,
      activityLookback: settings.activityLookback,
      moodSource: settings.moodSource,
      moodExpressionMap: settings.moodExpressionMap,
      stExpressionImageZoom: settings.stExpressionImageZoom,
      stExpressionImagePositionX: settings.stExpressionImagePositionX,
      stExpressionImagePositionY: settings.stExpressionImagePositionY,
      strictJsonRepair: settings.strictJsonRepair,
      maxRetriesPerStat: settings.maxRetriesPerStat,
      lastThoughtPrivate: settings.lastThoughtPrivate,
      customStats: settings.customStats,
    },
    activity: input.activity,
    promptInjection: buildPromptInjectionSummary({
      latestDataMessageIndex: input.latestDataMessageIndex,
      currentPrompt: input.promptInjectionCurrentPrompt,
      previousMessage: input.promptInjectionLastMessage,
      latestDataMessagePrompt: input.promptInjectionLatestDataMessage,
      promptInjectionDebugMeta: input.promptInjectionDebugMeta,
      latestData: input.latestData,
      latestPromptMacroData: input.latestPromptMacroData,
      baselineDebugMeta: input.baselineDebugMeta,
    }),
    promptInjectionPreview: input.promptInjectionPreview,
    promptInjectionCurrentPrompt: input.promptInjectionCurrentPrompt,
    promptInjectionLastMessage: input.promptInjectionLastMessage,
    promptInjectionPreviousMessage: input.promptInjectionPreviousMessage,
    promptInjectionLatestDataMessage: input.promptInjectionLatestDataMessage,
    promptInjectionDebugMeta: input.promptInjectionDebugMeta,
    macroDebugMeta: input.macroDebugMeta,
    baselineDebugMeta: input.baselineDebugMeta,
    traceTailMemory: input.traceTailMemory,
    traceTailPersisted: input.traceTailPersisted,
    lastDebugRecord: input.debugRecord,
  };
}
