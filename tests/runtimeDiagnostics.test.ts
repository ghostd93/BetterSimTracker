import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiagnosticsReport,
  buildHistorySample,
  filterDebugRecordForDiagnostics,
  filterDiagnosticsTrace,
} from "../src/runtimeDiagnostics";
import type { BetterSimTrackerSettings, DeltaDebugRecord, STContext, TrackerData } from "../src/types";

function makeTracker(timestamp: number): TrackerData {
  return {
    timestamp,
    activeCharacters: ["Seraphina"],
    statistics: {
      affection: { Seraphina: 55 },
      trust: { Seraphina: 52 },
      desire: { Seraphina: 30 },
      connection: { Seraphina: 60 },
      mood: { Seraphina: "Hopeful" },
      lastThought: { Seraphina: "Sample thought" },
    },
    customStatistics: { satisfaction: { Seraphina: 70 } },
    customNonNumericStatistics: { clothes: { Seraphina: ["dress"] } },
  };
}

function makeSettings(): BetterSimTrackerSettings {
  return {
    enabled: true,
    debug: true,
    includeContextInDiagnostics: false,
    includeGraphInDiagnostics: false,
    injectTrackerIntoPrompt: true,
    injectPromptDepth: 0,
    injectionPromptMaxChars: 6000,
    summarizationNoteVisibleForAI: false,
    injectSummarizationNote: false,
    contextMessages: 10,
    maxConcurrentCalls: 2,
    maxDeltaPerTurn: 10,
    maxTokensOverride: 0,
    truncationLengthOverride: 0,
    includeCharacterCardsInPrompt: true,
    includeLorebookInExtraction: true,
    useInternalLorebookScanFallback: true,
    lorebookExtractionMaxChars: 1200,
    autoDetectActive: true,
    activityLookback: 5,
    moodSource: "bst_images",
    moodExpressionMap: {
      Happy: "joy",
      Sad: "sadness",
      Angry: "anger",
      Excited: "excitement",
      Confused: "confusion",
      "In Love": "love",
      Shy: "nervousness",
      Playful: "amusement",
      Serious: "neutral",
      Lonely: "grief",
      Hopeful: "optimism",
      Anxious: "nervousness",
      Content: "relief",
      Frustrated: "annoyance",
      Neutral: "neutral",
    },
    stExpressionImageZoom: 1.2,
    stExpressionImagePositionX: 50,
    stExpressionImagePositionY: 20,
    strictJsonRepair: true,
    maxRetriesPerStat: 2,
    lastThoughtPrivate: false,
    trackAffection: true,
    trackTrust: true,
    trackDesire: true,
    trackConnection: true,
    trackMood: true,
    trackLastThought: true,
    enableUserTracking: true,
    userTrackMood: true,
    userTrackLastThought: true,
    includeUserTrackerInInjection: true,
    showLastThought: true,
    showInactive: true,
    inactiveLabel: "Inactive",
    builtInNumericStatUi: {},
    customStats: [],
    characterDefaults: {},
    promptTemplateUnified: "",
    promptTemplateSequentialAffection: "",
    promptTemplateSequentialTrust: "",
    promptTemplateSequentialDesire: "",
    promptTemplateSequentialConnection: "",
    promptTemplateSequentialCustomNumeric: "",
    promptTemplateSequentialCustomNonNumeric: "",
    promptTemplateSequentialMood: "",
    promptTemplateSequentialLastThought: "",
    promptTemplateInjection: "",
    unlockProtocolPrompts: false,
    promptProtocolUnified: "",
    promptProtocolSequentialAffection: "",
    promptProtocolSequentialTrust: "",
    promptProtocolSequentialDesire: "",
    promptProtocolSequentialConnection: "",
    promptProtocolSequentialCustomNumeric: "",
    promptProtocolSequentialCustomNonNumeric: "",
    promptProtocolSequentialMood: "",
    promptProtocolSequentialLastThought: "",
    connectionProfile: "",
    confidenceDampening: 0.5,
    moodStickiness: 0.4,
    maxDeltaPerTurnEnabled: true,
    sequentialExtraction: false,
    strictJsonMode: false,
    strictJsonRepairEnabled: true,
    maxRetriesPerStatEnabled: true,
    debugFlags: {
      extraction: true,
      prompts: true,
      ui: true,
      moodImages: true,
      storage: true,
    },
    accentColor: "#69f0ae",
    userCardColor: "#355c7d",
    cardOpacity: 0.92,
    borderRadius: 16,
    fontSize: 15,
    defaultAffection: 50,
    defaultTrust: 50,
    defaultDesire: 50,
    defaultConnection: 50,
    defaultMood: "Neutral",
    sceneCardEnabled: true,
    sceneCardPosition: "above_tracker_cards",
    sceneCardLayout: "chips",
    sceneCardShowWhenEmpty: true,
    sceneCardTitle: "Scene",
    sceneCardColor: "#2d2250",
    sceneCardValueColor: "#d4dcff",
    sceneCardStatOrder: [],
    sceneCardStatDisplay: {},
    sceneCardArrayCollapsedLimit: 4,
  } as unknown as BetterSimTrackerSettings;
}

test("filterDiagnosticsTrace removes graph-open lines when graph diagnostics are disabled", () => {
  const lines = [
    "2026-01-01 graph.open {...}",
    "2026-01-01 extract.start {...}",
  ];
  assert.deepEqual(filterDiagnosticsTrace(lines, false), ["2026-01-01 extract.start {...}"]);
  assert.deepEqual(filterDiagnosticsTrace(lines, true), lines);
});

test("buildHistorySample keeps tracked snapshot structure", () => {
  const sample = buildHistorySample([{ messageIndex: 4, timestamp: 1234, data: makeTracker(1234) }]);
  assert.equal(sample.length, 1);
  assert.equal(sample[0].messageIndex, 4);
  assert.equal(sample[0].statistics.mood.Seraphina, "Hopeful");
});

test("filterDebugRecordForDiagnostics strips graph entries from trace", () => {
  const record: DeltaDebugRecord = {
    rawModelOutput: "{}",
    parsed: {
      confidence: {},
      deltas: { affection: {}, trust: {}, desire: {}, connection: {}, custom: {}, customNonNumeric: {} },
      mood: {},
      lastThought: {},
    },
    applied: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
      customStatistics: {},
      customNonNumericStatistics: {},
    },
    meta: {
      promptChars: 0,
      contextChars: 0,
      historySnapshots: 0,
      activeCharacters: [],
      statsRequested: [],
      attempts: 1,
      extractionMode: "unified",
      retryUsed: false,
      firstParseHadValues: true,
      rawLength: 0,
      parsedCounts: {
        confidence: 0,
        affection: 0,
        trust: 0,
        desire: 0,
        connection: 0,
        mood: 0,
        lastThought: 0,
        customByStat: {},
        customNonNumericByStat: {},
      },
      appliedCounts: {
        affection: 0,
        trust: 0,
        desire: 0,
        connection: 0,
        mood: 0,
        lastThought: 0,
        customByStat: {},
        customNonNumericByStat: {},
      },
      moodFallbackApplied: [],
      requests: [],
    },
    trace: ["x graph.open y", "x extract.start y"],
  };
  const filtered = filterDebugRecordForDiagnostics(record, false);
  assert.deepEqual(filtered?.trace, ["x extract.start y"]);
});

test("buildDiagnosticsReport produces expected core fields", () => {
  const context = {
    chat: [{}, {}],
    groupId: null,
    characterId: "1",
  } as unknown as STContext;
  const report = buildDiagnosticsReport({
    context,
    settings: makeSettings(),
    extensionVersion: "2.2.3.10-dev23",
    isExtracting: false,
    runSequence: 12,
    trackerUiState: { phase: "idle", done: 0, total: 0, messageIndex: null },
    latestDataMessageIndex: 2,
    latestDataTimestamp: 123456,
    allCharacterNames: ["Seraphina"],
    settingsProvenance: { enabled: "context" },
    graphPreferences: { window: "all", smoothing: true },
    profileDebug: { selectedProfile: "", resolvedProfileId: null, activeProfileId: null },
    historySample: buildHistorySample([{ messageIndex: 2, timestamp: 123456, data: makeTracker(123456) }]),
    activity: null,
    latestData: makeTracker(123456),
    latestPromptMacroData: makeTracker(123456),
    promptInjectionPreview: "preview",
    promptInjectionCurrentPrompt: "preview",
    promptInjectionLastMessage: {
      messageIndex: 2,
      prompt: "<bst_inject_block>...</bst_inject_block>",
      capturedAt: 1772800000000,
      targetIndex: 2,
      generationType: "normal",
    },
    promptInjectionPreviousMessage: {
      messageIndex: 2,
      prompt: "<bst_inject_block>...</bst_inject_block>",
      capturedAt: 1772800000000,
      targetIndex: 2,
      generationType: "normal",
    },
    promptInjectionLatestDataMessage: "<bst_inject_block>...</bst_inject_block>",
    promptInjectionDebugMeta: { targetOwner: "Seraphina" },
    macroDebugMeta: { characterTargets: [{ ownerName: "Seraphina", macroSlug: "seraphina" }] },
    baselineDebugMeta: { baselineBeforeIndex: 4, previousEntryMessageIndex: 3, currentMessageWasUsedAsBaseline: false },
    traceTailMemory: ["a"],
    traceTailPersisted: ["b"],
    debugRecord: null,
  });
  assert.equal(report.scope, "char:1");
  assert.equal(report.chatLength, 2);
  assert.equal(report.extensionVersion, "2.2.3.10-dev23");
  assert.equal(
    (report.promptInjectionLastMessage as { messageIndex: number }).messageIndex,
    2,
  );
  assert.equal(
    report.promptInjectionLatestDataMessage,
    "<bst_inject_block>...</bst_inject_block>",
  );
  assert.equal(report.promptInjectionCurrentPrompt, "preview");
  assert.equal(
    (report.promptInjection as { latestDataMessageIndex: number }).latestDataMessageIndex,
    2,
  );
  assert.equal(
    (report.promptInjection as { currentPromptMatchesLatestDataMessage: boolean }).currentPromptMatchesLatestDataMessage,
    false,
  );
  assert.deepEqual(
    (report.promptInjection as { baseline: Record<string, unknown> }).baseline,
    { baselineBeforeIndex: 4, previousEntryMessageIndex: 3, currentMessageWasUsedAsBaseline: false },
  );
  assert.deepEqual(
    report.lorebook,
    {
      source: "none",
      promptChars: 0,
      includeLorebookInExtraction: true,
      useInternalLorebookScanFallback: true,
      usedCachedActivatedLorebookEntries: false,
      cachedActivatedLorebookEntryCount: 0,
    },
  );
});
