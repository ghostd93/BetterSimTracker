import { EXTENSION_KEY } from "./constants";
import {
  DEFAULT_INJECTION_PROMPT_TEMPLATE,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
} from "./prompts";
import type { BetterSimTrackerSettings, ConnectionProfileOption, STContext } from "./types";

export const defaultSettings: BetterSimTrackerSettings = {
  enabled: true,
  maxConcurrentCalls: 2,
  contextMessages: 10,
  connectionProfile: "",
  injectTrackerIntoPrompt: true,
  sequentialExtraction: false,
  maxDeltaPerTurn: 15,
  maxTokensOverride: 0,
  truncationLengthOverride: 0,
  includeCharacterCardsInPrompt: false,
  confidenceDampening: 0.65,
  moodStickiness: 0.6,
  strictJsonRepair: true,
  maxRetriesPerStat: 2,
  showLastThought: true,
  showInactive: true,
  inactiveLabel: "Off-screen",
  autoDetectActive: true,
  activityLookback: 5,
  trackAffection: true,
  trackTrust: true,
  trackDesire: true,
  trackConnection: true,
  trackMood: true,
  trackLastThought: true,
  accentColor: "#ff5a6f",
  cardOpacity: 0.92,
  borderRadius: 14,
  fontSize: 14,
  defaultAffection: 50,
  defaultTrust: 50,
  defaultDesire: 50,
  defaultConnection: 50,
  defaultMood: "Neutral",
  debug: false,
  includeContextInDiagnostics: false,
  includeGraphInDiagnostics: true,
  promptTemplateUnified: DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
  promptTemplateSequentialAffection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection,
  promptTemplateSequentialTrust: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust,
  promptTemplateSequentialDesire: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire,
  promptTemplateSequentialConnection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection,
  promptTemplateSequentialMood: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
  promptTemplateSequentialLastThought: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
  promptTemplateInjection: DEFAULT_INJECTION_PROMPT_TEMPLATE
};

const extractInstructionBlock = (raw: string): string => {
  const taskLabel = "Task:";
  const taskIndex = raw.indexOf(taskLabel);
  if (taskIndex < 0) {
    return raw.trim();
  }
  const afterTask = raw.slice(taskIndex + taskLabel.length);
  const markerCandidates = [
    "Numeric stats to update",
    "Return deltas only",
    "Return STRICT JSON only",
  ];
  let cutIndex = -1;
  for (const marker of markerCandidates) {
    const idx = afterTask.indexOf(marker);
    if (idx >= 0) {
      cutIndex = cutIndex < 0 ? idx : Math.min(cutIndex, idx);
    }
  }
  return (cutIndex >= 0 ? afterTask.slice(0, cutIndex) : afterTask).trim();
};

const normalizeInstruction = (value: unknown, fallback: string): string => {
  const raw = asText(value, fallback).trim();
  if (!raw) return fallback;
  const extracted = extractInstructionBlock(raw);
  return extracted || fallback;
};

export function getContext(): STContext | null {
  try {
    return SillyTavern.getContext() as unknown as STContext;
  } catch {
    return null;
  }
}

export function loadSettings(context: STContext): BetterSimTrackerSettings {
  const bag = (context.extensionSettings ?? {}) as Record<string, unknown>;
  const fromContext = (bag[EXTENSION_KEY] ?? {}) as Partial<BetterSimTrackerSettings>;
  const fromLocal = loadFromLocalStorage();
  return sanitizeSettings({ ...defaultSettings, ...fromLocal, ...fromContext });
}

export function getSettingsProvenance(context: STContext): Record<string, "context" | "local" | "default"> {
  const bag = (context.extensionSettings ?? {}) as Record<string, unknown>;
  const fromContext = (bag[EXTENSION_KEY] ?? {}) as Record<string, unknown>;
  const fromLocal = loadFromLocalStorage() as Record<string, unknown>;
  const provenance: Record<string, "context" | "local" | "default"> = {};
  for (const key of Object.keys(defaultSettings)) {
    if (Object.prototype.hasOwnProperty.call(fromContext, key)) {
      provenance[key] = "context";
    } else if (Object.prototype.hasOwnProperty.call(fromLocal, key)) {
      provenance[key] = "local";
    } else {
      provenance[key] = "default";
    }
  }
  return provenance;
}

export function getActiveConnectionProfileId(context: STContext): string | null {
  const extSettings = context.extensionSettings as Record<string, unknown> | undefined;
  const extConnectionManager = extSettings?.connectionManager as Record<string, unknown> | undefined;

  const cc = context.chatCompletionSettings as Record<string, unknown> | undefined;

  const globalObj = globalThis as Record<string, unknown>;
  const globalExt = globalObj.extension_settings as Record<string, unknown> | undefined;
  const globalConn = globalExt?.connectionManager as Record<string, unknown> | undefined;

  const candidate = String(
    extConnectionManager?.selectedProfile ??
      cc?.selectedProfile ??
      cc?.profile ??
      globalConn?.selectedProfile ??
      "",
  ).trim();
  return candidate || null;
}

export function saveSettings(
  context: STContext,
  settings: BetterSimTrackerSettings,
): void {
  const clean = sanitizeSettings(settings);
  if (!context.extensionSettings) {
    context.extensionSettings = {};
  }
  context.extensionSettings[EXTENSION_KEY] = clean;
  context.saveSettingsDebounced?.();
  saveToLocalStorage(clean);
  void persistViaSillyTavernModule(clean);
}

export function logDebug(settings: BetterSimTrackerSettings, ...args: unknown[]): void {
  if (!settings.debug) return;
  console.log("[BetterSimTracker]", ...args);
}

const LOCAL_STORAGE_KEY = `extension-settings:${EXTENSION_KEY}`;

function loadFromLocalStorage(): Partial<BetterSimTrackerSettings> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<BetterSimTrackerSettings>;
  } catch {
    return {};
  }
}

function saveToLocalStorage(settings: BetterSimTrackerSettings): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

async function persistViaSillyTavernModule(settings: BetterSimTrackerSettings): Promise<void> {
  try {
    const loadExtensionsModule = Function("return import('/scripts/extensions.js')") as () => Promise<unknown>;
    const module = await loadExtensionsModule() as {
      extension_settings?: Record<string, unknown>;
      saveSettingsDebounced?: () => void;
    };

    if (!module.extension_settings) return;
    module.extension_settings[EXTENSION_KEY] = settings;
    module.saveSettingsDebounced?.();
  } catch {
    // ignore dynamic import or runtime permission failures
  }
}

function toProfileOption(raw: unknown): ConnectionProfileOption | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(
    obj.id ??
      obj.profileId ??
      obj.value ??
      obj.profile ??
      "",
  ).trim();
  if (!id) return null;

  const label = String(
    obj.name ??
      obj.label ??
      obj.displayName ??
      obj.title ??
      id,
  ).trim();

  return { id, label: label || id };
}

function listFromUnknown(raw: unknown): ConnectionProfileOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toProfileOption).filter((p): p is ConnectionProfileOption => Boolean(p));
}

function loadProfilesFromLocalStorage(): ConnectionProfileOption[] {
  try {
    const candidates = [
      "chat_completion_profiles",
      "chatCompletionProfiles",
      "power_user.chat_completion_profiles"
    ];
    for (const key of candidates) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      const parsed = JSON.parse(value);
      const profiles = listFromUnknown(parsed);
      if (profiles.length) return profiles;
    }
  } catch {
    // ignore
  }
  return [];
}

export function discoverConnectionProfiles(context: STContext): ConnectionProfileOption[] {
  const buckets: unknown[] = [];
  const extSettings = context.extensionSettings as Record<string, unknown> | undefined;
  const extConnectionManager = extSettings?.connectionManager as Record<string, unknown> | undefined;
  buckets.push(extConnectionManager?.profiles);

  const cc = context.chatCompletionSettings as Record<string, unknown> | undefined;
  if (cc) {
    buckets.push(cc.profiles, cc.profileList, cc.connections);
  }

  const globalObj = globalThis as Record<string, unknown>;
  const globalExt = globalObj.extension_settings as Record<string, unknown> | undefined;
  const globalConn = globalExt?.connectionManager as Record<string, unknown> | undefined;
  buckets.push(
    globalConn?.profiles,
    globalObj.chat_completion_profiles,
    globalObj.chatCompletionProfiles,
    (globalObj.power_user as Record<string, unknown> | undefined)?.chat_completion_profiles,
    (globalObj.power_user as Record<string, unknown> | undefined)?.chatCompletionProfiles,
  );

  const merged = new Map<string, ConnectionProfileOption>();
  for (const bucket of buckets) {
    for (const profile of listFromUnknown(bucket)) {
      if (!merged.has(profile.id)) {
        merged.set(profile.id, profile);
      }
    }
  }

  if (merged.size === 0) {
    for (const profile of loadProfilesFromLocalStorage()) {
      if (!merged.has(profile.id)) {
        merged.set(profile.id, profile);
      }
    }
  }

  const selectedProfileId = String(
    extConnectionManager?.selectedProfile ??
      globalConn?.selectedProfile ??
      "",
  ).trim();
  if (selectedProfileId && !merged.has(selectedProfileId)) {
    merged.set(selectedProfileId, { id: selectedProfileId, label: `${selectedProfileId} (selected)` });
  }

  return Array.from(merged.values());
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function sanitizeSettings(input: Partial<BetterSimTrackerSettings>): BetterSimTrackerSettings {
  return {
    ...defaultSettings,
    ...input,
    enabled: asBool(input.enabled, defaultSettings.enabled),
    maxConcurrentCalls: clampInt(input.maxConcurrentCalls, defaultSettings.maxConcurrentCalls, 1, 8),
    contextMessages: clampInt(input.contextMessages, defaultSettings.contextMessages, 1, 40),
    connectionProfile: typeof input.connectionProfile === "string" ? input.connectionProfile.trim() : defaultSettings.connectionProfile,
    injectTrackerIntoPrompt: asBool(input.injectTrackerIntoPrompt, defaultSettings.injectTrackerIntoPrompt),
    sequentialExtraction: asBool(input.sequentialExtraction, defaultSettings.sequentialExtraction),
    maxDeltaPerTurn: clampInt(input.maxDeltaPerTurn, defaultSettings.maxDeltaPerTurn, 1, 30),
    maxTokensOverride: clampInt(input.maxTokensOverride, defaultSettings.maxTokensOverride, 0, 100000),
    truncationLengthOverride: clampInt(input.truncationLengthOverride, defaultSettings.truncationLengthOverride, 0, 200000),
    includeCharacterCardsInPrompt: asBool(input.includeCharacterCardsInPrompt, defaultSettings.includeCharacterCardsInPrompt),
    confidenceDampening: clampNumber(input.confidenceDampening, defaultSettings.confidenceDampening, 0, 1),
    moodStickiness: clampNumber(input.moodStickiness, defaultSettings.moodStickiness, 0, 1),
    strictJsonRepair: asBool(input.strictJsonRepair, defaultSettings.strictJsonRepair),
    maxRetriesPerStat: clampInt(input.maxRetriesPerStat, defaultSettings.maxRetriesPerStat, 0, 4),
    showLastThought: asBool(input.showLastThought, defaultSettings.showLastThought),
    showInactive: asBool(input.showInactive, defaultSettings.showInactive),
    inactiveLabel: asText(input.inactiveLabel, defaultSettings.inactiveLabel).slice(0, 40),
    autoDetectActive: asBool(input.autoDetectActive, defaultSettings.autoDetectActive),
    activityLookback: clampInt(input.activityLookback, defaultSettings.activityLookback, 1, 25),
    trackAffection: asBool(input.trackAffection, defaultSettings.trackAffection),
    trackTrust: asBool(input.trackTrust, defaultSettings.trackTrust),
    trackDesire: asBool(input.trackDesire, defaultSettings.trackDesire),
    trackConnection: asBool(input.trackConnection, defaultSettings.trackConnection),
    trackMood: asBool(input.trackMood, defaultSettings.trackMood),
    trackLastThought: asBool(input.trackLastThought, defaultSettings.trackLastThought),
    accentColor: asText(input.accentColor, defaultSettings.accentColor),
    cardOpacity: clampNumber(input.cardOpacity, defaultSettings.cardOpacity, 0.1, 1),
    borderRadius: clampInt(input.borderRadius, defaultSettings.borderRadius, 0, 32),
    fontSize: clampInt(input.fontSize, defaultSettings.fontSize, 10, 22),
    defaultAffection: clampInt(input.defaultAffection, defaultSettings.defaultAffection, 0, 100),
    defaultTrust: clampInt(input.defaultTrust, defaultSettings.defaultTrust, 0, 100),
    defaultDesire: clampInt(input.defaultDesire, defaultSettings.defaultDesire, 0, 100),
    defaultConnection: clampInt(input.defaultConnection, defaultSettings.defaultConnection, 0, 100),
    defaultMood: asText(input.defaultMood, defaultSettings.defaultMood).slice(0, 80),
    debug: asBool(input.debug, defaultSettings.debug),
    includeContextInDiagnostics: asBool(input.includeContextInDiagnostics, defaultSettings.includeContextInDiagnostics),
    includeGraphInDiagnostics: asBool(input.includeGraphInDiagnostics, defaultSettings.includeGraphInDiagnostics),
    promptTemplateUnified: normalizeInstruction(input.promptTemplateUnified, defaultSettings.promptTemplateUnified).slice(0, 20000),
    promptTemplateSequentialAffection: normalizeInstruction(input.promptTemplateSequentialAffection, defaultSettings.promptTemplateSequentialAffection).slice(0, 20000),
    promptTemplateSequentialTrust: normalizeInstruction(input.promptTemplateSequentialTrust, defaultSettings.promptTemplateSequentialTrust).slice(0, 20000),
    promptTemplateSequentialDesire: normalizeInstruction(input.promptTemplateSequentialDesire, defaultSettings.promptTemplateSequentialDesire).slice(0, 20000),
    promptTemplateSequentialConnection: normalizeInstruction(input.promptTemplateSequentialConnection, defaultSettings.promptTemplateSequentialConnection).slice(0, 20000),
    promptTemplateSequentialMood: normalizeInstruction(input.promptTemplateSequentialMood, defaultSettings.promptTemplateSequentialMood).slice(0, 20000),
    promptTemplateSequentialLastThought: normalizeInstruction(input.promptTemplateSequentialLastThought, defaultSettings.promptTemplateSequentialLastThought).slice(0, 20000),
    promptTemplateInjection: normalizeInstruction(input.promptTemplateInjection, defaultSettings.promptTemplateInjection).slice(0, 20000),
  };
}
