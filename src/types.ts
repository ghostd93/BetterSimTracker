import { STAT_KEYS } from "./constants";

export type StatKey = (typeof STAT_KEYS)[number];
export type NumericStatKey = "affection" | "trust" | "desire" | "connection";
export type TextStatKey = "mood" | "lastThought";
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

export type StatValue = number | string;
export type CharacterStatMap = Record<string, StatValue>;
export type Statistics = Record<StatKey, CharacterStatMap>;

export interface TrackerData {
  timestamp: number;
  activeCharacters: string[];
  statistics: Statistics;
}

export interface BetterSimTrackerSettings {
  enabled: boolean;
  maxConcurrentCalls: number;
  contextMessages: number;
  connectionProfile: string;
  injectTrackerIntoPrompt: boolean;
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
  autoDetectActive: boolean;
  activityLookback: number;
  trackAffection: boolean;
  trackTrust: boolean;
  trackDesire: boolean;
  trackConnection: boolean;
  trackMood: boolean;
  trackLastThought: boolean;
  moodSource: MoodSource;
  stExpressionImageZoom: number;
  stExpressionImagePositionX: number;
  stExpressionImagePositionY: number;
  accentColor: string;
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
  promptTemplateSequentialMood: string;
  promptTemplateSequentialLastThought: string;
  promptTemplateInjection: string;
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
  saveChat?: () => Promise<void> | void;
  saveChatDebounced?: () => void;
  saveSettingsDebounced?: () => void;
  saveMetadataDebounced?: () => void;
  deactivateSendButtons?: () => void;
  activateSendButtons?: () => void;
  extensionSettings?: Record<string, unknown>;
  chatMetadata?: Record<string, unknown>;
  chatCompletionSettings?: Record<string, unknown>;
  textCompletionSettings?: Record<string, unknown>;
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
  };
  meta?: {
    promptChars: number;
    contextChars: number;
    historySnapshots: number;
    activeCharacters: string[];
    statsRequested: StatKey[];
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
    };
    appliedCounts: {
      affection: number;
      trust: number;
      desire: number;
      connection: number;
      mood: number;
      lastThought: number;
    };
    moodFallbackApplied?: string[];
    requests?: Array<GenerateRequestMeta & { statList: StatKey[]; attempt: number; retryType: string }>;
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
