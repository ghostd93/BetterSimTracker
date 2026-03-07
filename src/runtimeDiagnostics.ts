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
  promptInjectionPreview: string | undefined;
  promptInjectionLastMessage: PromptInjectionLastMessageSnapshot;
  promptInjectionLatestDataMessage: string | null;
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
    promptInjectionPreview: input.promptInjectionPreview,
    promptInjectionLastMessage: input.promptInjectionLastMessage,
    promptInjectionLatestDataMessage: input.promptInjectionLatestDataMessage,
    traceTailMemory: input.traceTailMemory,
    traceTailPersisted: input.traceTailPersisted,
    lastDebugRecord: input.debugRecord,
  };
}
