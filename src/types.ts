import { STAT_KEYS } from "./constants";

export type StatKey = (typeof STAT_KEYS)[number];
export type NumericStatKey = "affection" | "trust" | "desire" | "connection";
export type TextStatKey = "mood" | "lastThought";
export type CustomStatKey = string;
export type CustomStatKind = "numeric" | "enum_single" | "boolean" | "text_short" | "array";
export type CustomNonNumericValue = string | boolean | string[];
export type MoodLabel =
  | "Happy"
  | "Sad"
  | "Angry"
  | "Excited"
  | "Confused"
  | "In Love"
  | "Shy"
  | "Playful"
  | "Serious"
  | "Lonely"
  | "Hopeful"
  | "Anxious"
  | "Content"
  | "Frustrated"
  | "Neutral";
export type MoodSource = "bst_images" | "st_expressions";
export type SceneCardPosition = "above_tracker_cards" | "below_tracker_cards";
export type SceneCardLayout = "chips" | "rows";
export type SceneCardSortMode = "custom_order" | "label_asc";

export type StatValue = number | string;
export type CharacterStatMap = Record<string, StatValue>;
export type Statistics = Record<StatKey, CharacterStatMap>;
export type CustomStatistics = Record<CustomStatKey, Record<string, number>>;
export type CustomNonNumericStatistics = Record<CustomStatKey, Record<string, CustomNonNumericValue>>;

export interface CustomStatDefinition {
  id: CustomStatKey;
  kind?: CustomStatKind;
  label: string;
  description?: string;
  behaviorGuidance?: string;
  defaultValue: number | string | boolean | string[];
  maxDeltaPerTurn?: number;
  enumOptions?: string[];
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
  textMaxLength?: number;
  track: boolean;
  trackCharacters?: boolean;
  trackUser?: boolean;
  globalScope?: boolean;
  privateToOwner?: boolean;
  showOnCard: boolean;
  showInGraph: boolean;
  includeInInjection: boolean;
  color?: string;
  promptOverride?: string;
  // Legacy key kept for backward-compatible import paths.
  sequentialPromptTemplate?: string;
}

export interface BuiltInNumericStatUiConfig {
  showOnCard: boolean;
  showInGraph: boolean;
  includeInInjection: boolean;
}

export type BuiltInNumericStatUiSettings = Record<NumericStatKey, BuiltInNumericStatUiConfig>;

export interface TrackerData {
  timestamp: number;
  activeCharacters: string[];
  statistics: Statistics;
  customStatistics?: CustomStatistics;
  customNonNumericStatistics?: CustomNonNumericStatistics;
}

export interface BetterSimTrackerSettings {
  enabled: boolean;
  maxConcurrentCalls: number;
  contextMessages: number;
  connectionProfile: string;
  injectTrackerIntoPrompt: boolean;
  includeLorebookInExtraction: boolean;
  lorebookExtractionMaxChars: number;
  injectPromptDepth: number;
  injectionPromptMaxChars: number;
  summarizationNoteVisibleForAI: boolean;
  injectSummarizationNote: boolean;
  sequentialExtraction: boolean;
  maxDeltaPerTurn: number;
  maxTokensOverride: number;
  truncationLengthOverride: number;
  includeCharacterCardsInPrompt: boolean;
  confidenceDampening: number;
  moodStickiness: number;
  strictJsonRepair: boolean;
  maxRetriesPerStat: number;
  showLastThought: boolean;
  showInactive: boolean;
  inactiveLabel: string;
  sceneCardEnabled: boolean;
  sceneCardPosition: SceneCardPosition;
  sceneCardLayout: SceneCardLayout;
  sceneCardTitle: string;
  sceneCardColor: string;
  sceneCardValueColor: string;
  sceneCardShowWhenEmpty: boolean;
  sceneCardSortMode: SceneCardSortMode;
  sceneCardArrayCollapsedLimit: number;
  sceneCardStatOrder: string[];
  autoDetectActive: boolean;
  activityLookback: number;
  trackAffection: boolean;
  trackTrust: boolean;
  trackDesire: boolean;
  trackConnection: boolean;
  trackMood: boolean;
  trackLastThought: boolean;
  lastThoughtPrivate: boolean;
  enableUserTracking: boolean;
  userTrackMood: boolean;
  userTrackLastThought: boolean;
  includeUserTrackerInInjection: boolean;
  builtInNumericStatUi: BuiltInNumericStatUiSettings;
  moodSource: MoodSource;
  moodExpressionMap: MoodExpressionMap;
  stExpressionImageZoom: number;
  stExpressionImagePositionX: number;
  stExpressionImagePositionY: number;
  accentColor: string;
  userCardColor: string;
  cardOpacity: number;
  borderRadius: number;
  fontSize: number;
  defaultAffection: number;
  defaultTrust: number;
  defaultDesire: number;
  defaultConnection: number;
  defaultMood: string;
  debug: boolean;
  debugFlags: DebugFlags;
  includeContextInDiagnostics: boolean;
  includeGraphInDiagnostics: boolean;
  promptTemplateUnified: string;
  promptTemplateSequentialAffection: string;
  promptTemplateSequentialTrust: string;
  promptTemplateSequentialDesire: string;
  promptTemplateSequentialConnection: string;
  promptTemplateSequentialCustomNumeric: string;
  promptTemplateSequentialCustomNonNumeric: string;
  promptTemplateSequentialMood: string;
  promptTemplateSequentialLastThought: string;
  promptTemplateInjection: string;
  unlockProtocolPrompts: boolean;
  promptProtocolUnified: string;
  promptProtocolSequentialAffection: string;
  promptProtocolSequentialTrust: string;
  promptProtocolSequentialDesire: string;
  promptProtocolSequentialConnection: string;
  promptProtocolSequentialCustomNumeric: string;
  promptProtocolSequentialCustomNonNumeric: string;
  promptProtocolSequentialMood: string;
  promptProtocolSequentialLastThought: string;
  customStats: CustomStatDefinition[];
  characterDefaults: Record<string, CharacterDefaults>;
}

export interface DebugFlags {
  extraction: boolean;
  prompts: boolean;
  ui: boolean;
  moodImages: boolean;
  storage: boolean;
}

export type MoodImageSet = Partial<Record<MoodLabel, string>>;
export type MoodExpressionMap = Partial<Record<MoodLabel, string>>;
export interface StExpressionImageOptions {
  zoom: number;
  positionX: number;
  positionY: number;
}

export interface CharacterDefaults {
  affection?: number;
  trust?: number;
  desire?: number;
  connection?: number;
  mood?: string;
  lastThought?: string;
  cardColor?: string;
  customStatDefaults?: Record<CustomStatKey, number>;
  customNonNumericStatDefaults?: Record<CustomStatKey, string | boolean | string[]>;
  moodSource?: MoodSource;
  moodExpressionMap?: MoodExpressionMap;
  stExpressionImageOptions?: StExpressionImageOptions;
  moodImages?: MoodImageSet;
}

export interface GenerateRequestMeta {
  profileId: string;
  promptChars: number;
  maxTokens: number;
  truncationLength?: number;
  requestId?: string;
  durationMs: number;
  outputChars: number;
  responseMeta?: Record<string, unknown>;
  timestamp: number;
  error?: string;
}

export interface ConnectionProfileOption {
  id: string;
  label: string;
}

export interface ChatMessage {
  mes: string;
  name?: string;
  is_user?: boolean;
  is_system?: boolean;
  swipe_id?: number;
  extra?: Record<string, unknown>;
}

export interface Character {
  name: string;
  avatar?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  extensions?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface Group {
  id: string;
  members?: string[];
  disabled_members?: string[];
}

export interface STEventSource {
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
}

export interface STContext {
  chat: ChatMessage[];
  chatId?: string;
  name1?: string;
  name2?: string;
  characterId?: number;
  groupId?: string;
  characters?: Character[];
  groups?: Group[];
  eventSource?: STEventSource;
  event_types?: Record<string, string>;
  addOneMessage?: (message: ChatMessage, options?: Record<string, unknown>) => void;
  sendSystemMessage?: (type: string, text?: string, extra?: Record<string, unknown>) => void;
  saveChat?: () => Promise<void> | void;
  saveChatDebounced?: () => void;
  saveSettingsDebounced?: () => void;
  saveMetadataDebounced?: () => void;
  generate?: (type: string, options?: Record<string, unknown>, dryRun?: boolean) => Promise<unknown>;
  stopGeneration?: () => boolean;
  deactivateSendButtons?: () => void;
  activateSendButtons?: () => void;
  extensionSettings?: Record<string, unknown>;
  extensionPrompts?: Record<string, {
    value?: string;
    position?: number;
    depth?: number;
    scan?: boolean;
    role?: number;
  }>;
  chatMetadata?: Record<string, unknown>;
  worldInfo?: unknown;
  world_info?: unknown;
  lorebook?: unknown;
  chatCompletionSettings?: Record<string, unknown>;
  textCompletionSettings?: Record<string, unknown>;
  mainApi?: string;
  getTextGenServer?: (type?: string) => string;
  ChatCompletionService?: {
    processRequest?: (
      requestData: Record<string, unknown>,
      options?: Record<string, unknown>,
      extractData?: boolean,
      signal?: AbortSignal | null,
    ) => Promise<unknown>;
  };
  TextCompletionService?: {
    processRequest?: (
      requestData: Record<string, unknown>,
      options?: Record<string, unknown>,
      extractData?: boolean,
      signal?: AbortSignal | null,
    ) => Promise<unknown>;
  };
  getPresetManager?: (apiId?: string) => {
    getCompletionPresetByName: (name?: string) => Record<string, unknown> | undefined;
  };
  csrf_token?: string;
}

export interface DeltaDebugRecord {
  rawModelOutput: string;
  promptText?: string;
  contextText?: string;
  parsed: {
    confidence: Record<string, number>;
    deltas: {
      affection: Record<string, number>;
      trust: Record<string, number>;
      desire: Record<string, number>;
      connection: Record<string, number>;
      custom?: Record<string, Record<string, number>>;
      customNonNumeric?: Record<string, Record<string, CustomNonNumericValue>>;
    };
    mood: Record<string, string>;
    lastThought: Record<string, string>;
  };
  applied: {
    affection: Record<string, number>;
    trust: Record<string, number>;
    desire: Record<string, number>;
    connection: Record<string, number>;
    mood: Record<string, string>;
    lastThought: Record<string, string>;
    customStatistics?: Record<string, Record<string, number>>;
    customNonNumericStatistics?: Record<string, Record<string, CustomNonNumericValue>>;
  };
  meta?: {
    promptChars: number;
    contextChars: number;
    historySnapshots: number;
    activeCharacters: string[];
    statsRequested: string[];
    attempts: number;
    extractionMode: "unified" | "sequential";
    retryUsed: boolean;
    firstParseHadValues: boolean;
    rawLength: number;
    parsedCounts: {
      confidence: number;
      affection: number;
      trust: number;
      desire: number;
      connection: number;
      mood: number;
      lastThought: number;
      customByStat?: Record<string, number>;
      customNonNumericByStat?: Record<string, number>;
    };
    appliedCounts: {
      affection: number;
      trust: number;
      desire: number;
      connection: number;
      mood: number;
      lastThought: number;
      customByStat?: Record<string, number>;
      customNonNumericByStat?: Record<string, number>;
    };
    moodFallbackApplied?: string[];
    requests?: Array<GenerateRequestMeta & { statList: string[]; attempt: number; retryType: string }>;
    scopeResolution?: {
      current?: Record<string, Record<string, {
        globalScope: boolean;
        resolvedFrom: "global" | "owner" | "legacy_fallback" | "global_fallback" | "none";
        value: unknown;
        ownerValue?: unknown;
        globalValue?: unknown;
        legacyFallbackOwner?: string;
      }>>;
      history?: Array<{
        snapshotIndex: number;
        messageIndex: number;
        byStat: Record<string, Record<string, {
          globalScope: boolean;
          resolvedFrom: "global" | "owner" | "legacy_fallback" | "global_fallback" | "none";
          value: unknown;
          ownerValue?: unknown;
          globalValue?: unknown;
          legacyFallbackOwner?: string;
        }>>;
      }>;
    };
  };
  trace?: string[];
}

declare global {
  interface Window {
    BetterSimTracker?: {
      openSettings: () => void;
      closeSettings: () => void;
      toggle: () => boolean;
      refresh: () => Promise<void>;
    };
  }
}
