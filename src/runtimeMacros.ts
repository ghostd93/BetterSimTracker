import { GLOBAL_TRACKER_KEY, USER_TRACKER_KEY } from "./constants";
import type { BetterSimTrackerSettings, STContext, TrackerData } from "./types";

const BST_INJECTION_MACRO = "bst_injection";
const BST_MACRO_STAT_SCOPE_USER = "user";
const BST_MACRO_STAT_SCOPE_SCENE = "scene";
const registeredBstMacros = new Set<string>();
let bstMacroSignature = "";
const CHARACTER_SLUG_FALLBACK = "character";
let lastBstMacroDebugSnapshot: Record<string, unknown> | null = null;

function toMacroIdSegment(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toCharacterSlug(value: string): string {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || CHARACTER_SLUG_FALLBACK;
}

function normalizeName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toAvatarSlug(value: string): string {
  const token = String(value ?? "").trim();
  if (!token) return "";
  const parts = token.split(/[\\/]/).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : token;
  const withoutExt = last.replace(/\.[a-z0-9]+$/i, "");
  return toCharacterSlug(withoutExt);
}

type CharacterMacroTarget = {
  ownerName: string;
  macroSlug: string;
  legacyNameSlug: string | null;
  displayName: string;
  avatar: string | null;
};

type MacroResolutionSample = {
  macro: string;
  resolved: string;
  legacyMacro?: string | null;
  legacyResolved?: string | null;
};

function buildCharacterMacroTargets(context: STContext, allCharacterNames: string[]): CharacterMacroTarget[] {
  const ownerNameSet = new Set(
    (allCharacterNames ?? [])
      .map(name => String(name ?? "").trim())
      .filter(name => name && name !== USER_TRACKER_KEY && name !== GLOBAL_TRACKER_KEY),
  );
  const ownerNameKeySet = new Set(Array.from(ownerNameSet, normalizeName));

  const candidates: Array<{ ownerName: string; displayName: string; avatar: string | null; baseSlug: string }> = [];

  for (const character of context.characters ?? []) {
    const name = String(character?.name ?? "").trim();
    if (!name || !ownerNameKeySet.has(normalizeName(name))) continue;
    const avatar = String(character?.avatar ?? "").trim() || null;
    const baseSlug = avatar ? toAvatarSlug(avatar) : toCharacterSlug(name);
    candidates.push({ ownerName: name, displayName: name, avatar, baseSlug });
  }

  if (!candidates.length) {
    for (const ownerName of ownerNameSet) {
      const baseSlug = toCharacterSlug(ownerName);
      candidates.push({ ownerName, displayName: ownerName, avatar: null, baseSlug });
    }
  }

  const slugCounts = new Map<string, number>();
  const nameSlugCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const nameSlug = toCharacterSlug(candidate.ownerName);
    nameSlugCounts.set(nameSlug, (nameSlugCounts.get(nameSlug) ?? 0) + 1);
  }

  const targets: CharacterMacroTarget[] = [];
  for (const candidate of candidates) {
    const base = candidate.baseSlug || CHARACTER_SLUG_FALLBACK;
    const next = (slugCounts.get(base) ?? 0) + 1;
    slugCounts.set(base, next);
    const macroSlug = next === 1 ? base : `${base}_${next}`;
    const nameSlug = toCharacterSlug(candidate.ownerName);
    const legacyNameSlug = nameSlug && nameSlug !== macroSlug && (nameSlugCounts.get(nameSlug) ?? 0) === 1
      ? nameSlug
      : null;
    targets.push({
      ownerName: candidate.ownerName,
      macroSlug,
      legacyNameSlug,
      displayName: candidate.displayName,
      avatar: candidate.avatar,
    });
  }
  return targets;
}

function resolveCurrentCharacterMacroTarget(
  context: STContext,
  targets: CharacterMacroTarget[],
): CharacterMacroTarget | null {
  if (!targets.length) return null;
  if (targets.length === 1) return targets[0];

  const selectedById = Number(context.characterId);
  if (Number.isInteger(selectedById) && selectedById >= 0 && selectedById < (context.characters?.length ?? 0)) {
    const selectedCharacter = context.characters?.[selectedById];
    const selectedAvatar = String(selectedCharacter?.avatar ?? "").trim();
    if (selectedAvatar) {
      const avatarMatch = targets.find(target => String(target.avatar ?? "").trim() === selectedAvatar);
      if (avatarMatch) return avatarMatch;
    }
    const selectedName = String(selectedCharacter?.name ?? "").trim().toLowerCase();
    if (selectedName) {
      const byName = targets.filter(target => target.ownerName.trim().toLowerCase() === selectedName);
      if (byName.length === 1) return byName[0];
    }
  }

  const fallbackName = String(context.name2 ?? "").trim().toLowerCase();
  if (fallbackName) {
    const byName = targets.filter(target => target.ownerName.trim().toLowerCase() === fallbackName);
    if (byName.length === 1) return byName[0];
  }

  return null;
}

function resolveMacroTargetOwner(scope: string, globalScope: boolean): string | null {
  if (globalScope) return GLOBAL_TRACKER_KEY;
  if (scope === BST_MACRO_STAT_SCOPE_SCENE) return GLOBAL_TRACKER_KEY;
  if (scope === BST_MACRO_STAT_SCOPE_USER) return USER_TRACKER_KEY;
  return null;
}

function formatMacroValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value
      .map(item => String(item ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(value ?? "").trim();
}

function resolveMacroStatValue(
  data: TrackerData | null,
  currentSettings: BetterSimTrackerSettings | null,
  statId: string,
  scope: string,
  explicitOwner?: string,
): string {
  if (!data || !currentSettings) return "";
  const normalized = String(statId ?? "").trim().toLowerCase();
  if (!normalized) return "";
  const customById = new Map(
    (currentSettings.customStats ?? []).map(def => [String(def.id ?? "").trim().toLowerCase(), def] as const),
  );
  const customDef = customById.get(normalized);
  const owner = explicitOwner || resolveMacroTargetOwner(scope, Boolean(customDef?.globalScope));
  if (!owner) return "";

  if (normalized === "affection" || normalized === "trust" || normalized === "desire" || normalized === "connection") {
    if (owner === GLOBAL_TRACKER_KEY) return "";
    const bucket = data.statistics[normalized];
    const value = Number(bucket?.[owner]);
    if (Number.isNaN(value)) return "";
    return String(Math.max(0, Math.min(100, Math.round(value))));
  }

  if (normalized === "mood") {
    if (owner === GLOBAL_TRACKER_KEY) return "";
    return String(data.statistics.mood?.[owner] ?? "").trim();
  }
  if (normalized === "lastthought" || normalized === "last_thought") {
    if (owner === GLOBAL_TRACKER_KEY) return "";
    return String(data.statistics.lastThought?.[owner] ?? "").trim();
  }
  if (!customDef) return "";

  if ((customDef.kind ?? "numeric") === "numeric") {
    const bucket = data.customStatistics?.[normalized];
    if (!bucket) return "";
    let raw = bucket[owner];
    if (raw === undefined && owner !== GLOBAL_TRACKER_KEY && customDef.globalScope) {
      raw = bucket[GLOBAL_TRACKER_KEY];
    }
    const numeric = Number(raw);
    if (Number.isNaN(numeric)) return "";
    return String(Math.max(0, Math.min(100, Math.round(numeric))));
  }

  const bucket = data.customNonNumericStatistics?.[normalized];
  if (!bucket) return "";
  let raw: unknown = bucket[owner];
  if (raw === undefined && owner !== GLOBAL_TRACKER_KEY && customDef.globalScope) {
    raw = bucket[GLOBAL_TRACKER_KEY];
  }
  return formatMacroValue(raw);
}

function unregisterBstMacro(context: STContext, name: string): void {
  const hasNewEngine = typeof context.macros?.register === "function";
  if (hasNewEngine) {
    try {
      context.macros?.registry?.unregisterMacro?.(name);
    } catch {
      // ignore
    }
    return;
  }
  try {
    if (typeof context.unregisterMacro === "function") {
      context.unregisterMacro(name);
    }
  } catch {
    // ignore
  }
}

function registerBstMacro(
  context: STContext,
  name: string,
  description: string,
  getter: () => string,
): void {
  const hasNewEngine = typeof context.macros?.register === "function";
  let registered = false;
  if (hasNewEngine) {
    try {
      context.macros?.register?.(name, {
        description,
        handler: () => getter(),
      });
      registered = true;
    } catch {
      // ignore
    }
  } else {
    try {
      if (typeof context.registerMacro === "function") {
        context.registerMacro(name, getter, description);
        registered = true;
      }
    } catch {
      // ignore
    }
  }
  if (registered) {
    registeredBstMacros.add(name);
  }
}

function safeSubstituteMacro(context: STContext, macroName: string): string {
  try {
    const substitute = (context as STContext & { substituteParams?: (value: string) => string }).substituteParams;
    if (typeof substitute !== "function") return "";
    return String(substitute(`{{${macroName}}}`) ?? "");
  } catch (error) {
    return `[error:${error instanceof Error ? error.message : String(error)}]`;
  }
}

function buildResolutionSamples(
  context: STContext,
  settings: BetterSimTrackerSettings,
  customDefs: Array<BetterSimTrackerSettings["customStats"][number] & { id: string }>,
  characterTargets: CharacterMacroTarget[],
): { user: MacroResolutionSample | null; scene: MacroResolutionSample | null; character: MacroResolutionSample | null } {
  const sampleCharacterTarget = characterTargets[0] ?? null;
  const sampleUserStat = customDefs.find(def => !def.globalScope && def.track && def.trackUser)?.id
    ?? (settings.enableUserTracking && settings.userTrackMood ? "mood" : settings.enableUserTracking && settings.userTrackLastThought ? "lastThought" : null);
  const sampleSceneStat = customDefs.find(def => def.globalScope && def.track)?.id ?? null;
  const sampleCharacterStat = customDefs.find(def => !def.globalScope && def.track && def.trackCharacters)?.id
    ?? (settings.trackMood ? "mood" : settings.trackLastThought ? "lastThought" : settings.trackAffection ? "affection" : null);

  return {
    user: sampleUserStat ? {
      macro: `bst_stat_user_${toMacroIdSegment(sampleUserStat)}`,
      resolved: safeSubstituteMacro(context, `bst_stat_user_${toMacroIdSegment(sampleUserStat)}`),
    } : null,
    scene: sampleSceneStat ? {
      macro: `bst_stat_scene_${toMacroIdSegment(sampleSceneStat)}`,
      resolved: safeSubstituteMacro(context, `bst_stat_scene_${toMacroIdSegment(sampleSceneStat)}`),
    } : null,
    character: sampleCharacterTarget && sampleCharacterStat ? {
      macro: `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}`,
      resolved: safeSubstituteMacro(context, `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}`),
      legacyMacro: sampleCharacterTarget.legacyNameSlug
        ? `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}_${sampleCharacterTarget.legacyNameSlug}`
        : `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}_${sampleCharacterTarget.macroSlug}`,
      legacyResolved: sampleCharacterTarget.legacyNameSlug
        ? safeSubstituteMacro(context, `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}_${sampleCharacterTarget.legacyNameSlug}`)
        : safeSubstituteMacro(context, `bst_stat_char_${toMacroIdSegment(sampleCharacterStat)}_${sampleCharacterTarget.macroSlug}`),
    } : null,
  };
}

export function syncBstMacros(input: {
  context: STContext;
  settings: BetterSimTrackerSettings;
  allCharacterNames: string[];
  getLatestPromptMacroData: () => TrackerData | null;
  getLastInjectedPrompt: () => string;
}): void {
  const { context, settings, allCharacterNames, getLatestPromptMacroData, getLastInjectedPrompt } = input;
  const customDefs = (settings.customStats ?? [])
    .map(def => ({ ...def, id: String(def.id ?? "").trim().toLowerCase() }))
    .filter(def => def.id.length > 0);
  const customStatIds = customDefs.map(def => def.id);
  const characterTargets = buildCharacterMacroTargets(context, allCharacterNames);
  const debugCharacterTargets = characterTargets.map(target => ({
    ownerName: target.ownerName,
    displayName: target.displayName,
    macroSlug: target.macroSlug,
    legacyNameSlug: target.legacyNameSlug,
    avatar: target.avatar,
  }));
  const currentCharacterTarget = resolveCurrentCharacterMacroTarget(context, characterTargets);
  const characterSignature = characterTargets
    .map(target => `${target.ownerName}:${target.macroSlug}:${target.legacyNameSlug ?? ""}:${target.avatar ?? ""}`)
    .join("|");
  const signature = [
    "v1",
    String(Boolean(settings.trackAffection)),
    String(Boolean(settings.trackTrust)),
    String(Boolean(settings.trackDesire)),
    String(Boolean(settings.trackConnection)),
    String(Boolean(settings.trackMood)),
    String(Boolean(settings.trackLastThought)),
    String(Boolean(settings.enableUserTracking)),
    String(Boolean(settings.userTrackMood)),
    String(Boolean(settings.userTrackLastThought)),
    customDefs
      .map(def => [
        def.id,
        def.track ? 1 : 0,
        def.trackCharacters ? 1 : 0,
        def.trackUser ? 1 : 0,
        def.globalScope ? 1 : 0,
      ].join(":"))
      .join("|"),
    customStatIds.join("|"),
    characterSignature,
  ].join("::");
  if (signature === bstMacroSignature && registeredBstMacros.size > 0) {
    lastBstMacroDebugSnapshot = {
      signature,
      skippedBecauseSignatureUnchanged: true,
      allCharacterNames: [...allCharacterNames],
      characterTargets: debugCharacterTargets,
      currentCharacterTarget: currentCharacterTarget
        ? {
          ownerName: currentCharacterTarget.ownerName,
          displayName: currentCharacterTarget.displayName,
          macroSlug: currentCharacterTarget.macroSlug,
          legacyNameSlug: currentCharacterTarget.legacyNameSlug,
          avatar: currentCharacterTarget.avatar,
        }
        : null,
      registeredMacroNames: Array.from(registeredBstMacros).sort(),
      resolutionSamples: buildResolutionSamples(context, settings, customDefs, characterTargets),
    };
    return;
  }

  for (const name of registeredBstMacros) {
    unregisterBstMacro(context, name);
  }
  registeredBstMacros.clear();

  registerBstMacro(
    context,
    BST_INJECTION_MACRO,
    "BetterSimTracker hidden injection block (latest generated value).",
    () => getLastInjectedPrompt(),
  );

  const statIds = [
    "affection",
    "trust",
    "desire",
    "connection",
    "mood",
    "lastThought",
    ...customStatIds,
  ];
  for (const rawStatId of statIds) {
    const statId = String(rawStatId ?? "").trim().toLowerCase();
    if (!statId) continue;
    const segment = toMacroIdSegment(statId);
    if (!segment) continue;
    const customDef = customDefs.find(def => def.id === statId) ?? null;
    const isBuiltInNumeric = statId === "affection" || statId === "trust" || statId === "desire" || statId === "connection";
    const isMood = statId === "mood";
    const isLastThought = statId === "lastthought" || statId === "last_thought";
    const allowsScene = Boolean(customDef?.globalScope) && Boolean(customDef?.track);
    const allowsUser = (() => {
      if (isBuiltInNumeric) return false;
      if (isMood) return Boolean(settings.enableUserTracking && settings.userTrackMood);
      if (isLastThought) return Boolean(settings.enableUserTracking && settings.userTrackLastThought);
      if (!customDef || customDef.globalScope) return false;
      const baseTracked = Boolean(customDef.track);
      return baseTracked && Boolean(customDef.trackUser ?? customDef.track);
    })();
    const allowsCharacter = (() => {
      if (isBuiltInNumeric) {
        if (statId === "affection") return Boolean(settings.trackAffection);
        if (statId === "trust") return Boolean(settings.trackTrust);
        if (statId === "desire") return Boolean(settings.trackDesire);
        return Boolean(settings.trackConnection);
      }
      if (isMood) return Boolean(settings.trackMood);
      if (isLastThought) return Boolean(settings.trackLastThought);
      if (!customDef || customDef.globalScope) return false;
      const baseTracked = Boolean(customDef.track);
      return baseTracked && Boolean(customDef.trackCharacters ?? customDef.track);
    })();
    if (allowsUser) {
      const macroName = `bst_stat_${BST_MACRO_STAT_SCOPE_USER}_${segment}`;
      registerBstMacro(
        context,
        macroName,
        `BetterSimTracker stat macro for "${statId}" (${BST_MACRO_STAT_SCOPE_USER} scope).`,
        () => resolveMacroStatValue(getLatestPromptMacroData(), settings, statId, BST_MACRO_STAT_SCOPE_USER),
      );
    }
    if (allowsScene) {
      const macroName = `bst_stat_${BST_MACRO_STAT_SCOPE_SCENE}_${segment}`;
      registerBstMacro(
        context,
        macroName,
        `BetterSimTracker stat macro for "${statId}" (${BST_MACRO_STAT_SCOPE_SCENE} scope).`,
        () => resolveMacroStatValue(getLatestPromptMacroData(), settings, statId, BST_MACRO_STAT_SCOPE_SCENE),
      );
    }
    if (allowsCharacter) {
      if (currentCharacterTarget) {
        registerBstMacro(
          context,
          `bst_stat_char_${segment}`,
          `BetterSimTracker stat macro for "${statId}" (current chat character).`,
          () => resolveMacroStatValue(getLatestPromptMacroData(), settings, statId, "char_target", currentCharacterTarget.ownerName),
        );
      }
      for (const target of characterTargets) {
        registerBstMacro(
          context,
          `bst_stat_char_${segment}_${target.macroSlug}`,
          `BetterSimTracker stat macro for "${statId}" (character "${target.displayName}").`,
          () => resolveMacroStatValue(getLatestPromptMacroData(), settings, statId, "char_target", target.ownerName),
        );
        if (target.legacyNameSlug) {
          registerBstMacro(
            context,
            `bst_stat_char_${segment}_${target.legacyNameSlug}`,
            `BetterSimTracker legacy stat macro alias for "${statId}" (character "${target.displayName}").`,
            () => resolveMacroStatValue(getLatestPromptMacroData(), settings, statId, "char_target", target.ownerName),
          );
        }
      }
    }
  }
  bstMacroSignature = signature;
  lastBstMacroDebugSnapshot = {
    signature,
    skippedBecauseSignatureUnchanged: false,
    allCharacterNames: [...allCharacterNames],
    characterTargets: debugCharacterTargets,
    currentCharacterTarget: currentCharacterTarget
      ? {
        ownerName: currentCharacterTarget.ownerName,
        displayName: currentCharacterTarget.displayName,
        macroSlug: currentCharacterTarget.macroSlug,
        legacyNameSlug: currentCharacterTarget.legacyNameSlug,
        avatar: currentCharacterTarget.avatar,
      }
      : null,
    registeredMacroNames: Array.from(registeredBstMacros).sort(),
    resolutionSamples: buildResolutionSamples(context, settings, customDefs, characterTargets),
  };
}

export function resetBstMacroStateForTests(): void {
  registeredBstMacros.clear();
  bstMacroSignature = "";
  lastBstMacroDebugSnapshot = null;
}

export function getBstMacroDebugSnapshot(): Record<string, unknown> | null {
  return lastBstMacroDebugSnapshot ? { ...lastBstMacroDebugSnapshot } : null;
}
