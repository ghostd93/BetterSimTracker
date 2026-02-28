import { moodOptions } from "./prompts";
import type { CustomNonNumericValue, CustomStatKind, NumericStatKey, StatKey, StatValue } from "./types";
import type { Statistics } from "./types";

type CharacterNameAliases = Record<string, string>;

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const block = raw.match(/\{[\s\S]*\}/);
    if (!block) return null;
    try {
      return JSON.parse(block[0]);
    } catch {
      return null;
    }
  }
}

function emptyStatistics(): Statistics {
  return {
    affection: {},
    trust: {},
    desire: {},
    connection: {},
    mood: {},
    lastThought: {}
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number") return clamp01(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return clamp01(parsed);
  }
  return null;
}

function coerceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

const MOOD_LABEL_LOOKUP = new Map(moodOptions.map(label => [label.toLowerCase(), label]));
const MOOD_LABELS_BY_LENGTH = [...moodOptions].sort((a, b) => b.length - a.length);
const MOOD_ALIAS_LOOKUP = new Map<string, string>([
  ["exhausted", "Sad"],
  ["exhaustion", "Sad"],
  ["tired", "Sad"],
  ["fatigued", "Sad"],
  ["drained", "Sad"],
  ["sleepy", "Sad"],
  ["weary", "Sad"],
  ["worried", "Anxious"],
  ["nervous", "Anxious"],
  ["stressed", "Anxious"],
  ["overwhelmed", "Anxious"],
  ["upset", "Frustrated"],
  ["annoyed", "Frustrated"],
  ["mad", "Angry"],
  ["calm", "Content"],
  ["relaxed", "Content"],
  ["peaceful", "Content"],
  ["joyful", "Happy"],
  ["glad", "Happy"],
]);

function normalizeMoodLabel(value: string): string {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return "Neutral";
  const exact = MOOD_LABEL_LOOKUP.get(cleaned);
  if (exact) return exact;
  const aliasExact = MOOD_ALIAS_LOOKUP.get(cleaned);
  if (aliasExact) return aliasExact;
  for (const [needle, mapped] of MOOD_ALIAS_LOOKUP) {
    if (cleaned.includes(needle)) return mapped;
  }
  for (const label of MOOD_LABELS_BY_LENGTH) {
    const needle = label.toLowerCase();
    if (cleaned.includes(needle)) return label;
  }
  return "Neutral";
}

function normalizeCharacterName(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveCharacterName(
  rawName: string,
  activeCharacters: string[],
  aliases?: CharacterNameAliases,
): string | null {
  const trimmed = String(rawName ?? "").trim();
  if (!trimmed) return null;

  if (activeCharacters.includes(trimmed)) return trimmed;

  const normalized = normalizeCharacterName(trimmed);
  if (!normalized) return null;

  for (const active of activeCharacters) {
    if (normalizeCharacterName(active) === normalized) {
      return active;
    }
  }

  if (aliases && Object.keys(aliases).length) {
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (normalizeCharacterName(alias) === normalized) {
        if (activeCharacters.includes(canonical)) return canonical;
        const canonicalNormalized = normalizeCharacterName(canonical);
        const matched = activeCharacters.find(name => normalizeCharacterName(name) === canonicalNormalized);
        if (matched) return matched;
      }
    }
  }

  return null;
}

export function parseStatResponse(
  stat: StatKey,
  rawText: string,
  activeCharacters: string[],
): Record<string, StatValue> {
  const parsed = safeJsonParse(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const source = parsed as Record<string, unknown>;
  const result: Record<string, StatValue> = {};

  for (const character of activeCharacters) {
    const rawValue = source[character];
    if (rawValue === undefined) continue;

    if (stat === "mood" || stat === "lastThought") {
      const text = coerceText(rawValue);
      if (text !== null) {
        result[character] = stat === "mood" ? normalizeMoodLabel(text) : text;
      }
      continue;
    }

    const numeric = coerceNumeric(rawValue);
    if (numeric !== null) result[character] = numeric;
  }

  return result;
}

export function withDefaultsForMissingNumeric(
  stat: NumericStatKey,
  values: Record<string, StatValue>,
  characters: string[],
  defaults: { affection: number; trust: number; desire: number; connection: number },
): Record<string, StatValue> {
  const merged = { ...values };
  for (const name of characters) {
    if (merged[name] !== undefined) continue;
    merged[name] = defaults[stat];
  }
  return merged;
}

export function parseUnifiedStatResponse(
  rawText: string,
  activeCharacters: string[],
  enabled: StatKey[],
  nameAliases?: CharacterNameAliases,
): Statistics {
  const parsed = safeJsonParse(rawText);
  const output = emptyStatistics();
  if (!parsed || typeof parsed !== "object") return output;

  const enabledSet = new Set(enabled);
  const byName = new Map<string, Record<string, unknown>>();

  const source = parsed as Record<string, unknown>;
  const list = Array.isArray(source.characters) ? source.characters : null;
  if (list) {
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const rawName = String(obj.name ?? "").trim();
      const resolved = resolveCharacterName(rawName, activeCharacters, nameAliases);
      if (!resolved) continue;
      byName.set(resolved, obj);
    }
  } else {
    for (const name of activeCharacters) {
      const row = source[name];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      byName.set(name, row as Record<string, unknown>);
    }
  }

  for (const name of activeCharacters) {
    const row = byName.get(name);
    if (!row) continue;

    if (enabledSet.has("affection")) {
      const v = coerceNumeric(row.affection);
      if (v !== null) output.affection[name] = v;
    }
    if (enabledSet.has("trust")) {
      const v = coerceNumeric(row.trust);
      if (v !== null) output.trust[name] = v;
    }
    if (enabledSet.has("desire")) {
      const v = coerceNumeric(row.desire);
      if (v !== null) output.desire[name] = v;
    }
    if (enabledSet.has("connection")) {
      const v = coerceNumeric(row.connection);
      if (v !== null) output.connection[name] = v;
    }
    if (enabledSet.has("mood")) {
      const v = coerceText(row.mood);
      if (v !== null) output.mood[name] = normalizeMoodLabel(v);
    }
    if (enabledSet.has("lastThought")) {
      const v = coerceText(row.lastThought);
      if (v !== null) output.lastThought[name] = v;
    }
  }

  return output;
}

export function parseUnifiedDeltaResponse(
  rawText: string,
  activeCharacters: string[],
  enabled: StatKey[],
  maxDelta = 15,
  nameAliases?: CharacterNameAliases,
): {
  confidence: Record<string, number>;
  deltas: {
    affection: Record<string, number>;
    trust: Record<string, number>;
    desire: Record<string, number>;
    connection: Record<string, number>;
  };
  mood: Record<string, string>;
  lastThought: Record<string, string>;
} {
  const parsed = safeJsonParse(rawText);
  const enabledSet = new Set(enabled);
  const byName = new Map<string, Record<string, unknown>>();
  const result = {
    confidence: {} as Record<string, number>,
    deltas: {
      affection: {} as Record<string, number>,
      trust: {} as Record<string, number>,
      desire: {} as Record<string, number>,
      connection: {} as Record<string, number>,
    },
    mood: {} as Record<string, string>,
    lastThought: {} as Record<string, string>,
  };
  if (!parsed || typeof parsed !== "object") return result;

  const source = parsed as Record<string, unknown>;
  const list = Array.isArray(source.characters) ? source.characters : null;
  if (list) {
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const rawName = String(obj.name ?? "").trim();
      const resolved = resolveCharacterName(rawName, activeCharacters, nameAliases);
      if (!resolved) continue;
      byName.set(resolved, obj);
    }
  }

  const safeMaxDelta = Math.max(1, Math.round(Number(maxDelta) || 15));
  const clampDelta = (n: number): number => Math.max(-safeMaxDelta, Math.min(safeMaxDelta, Math.round(n)));
  const coerceDelta = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return clampDelta(value);
    if (typeof value === "string") {
      const n = Number(value);
      if (!Number.isNaN(n)) return clampDelta(n);
    }
    return null;
  };

  for (const name of activeCharacters) {
    const row = byName.get(name);
    if (!row) continue;

    const confRaw = Number(row.confidence);
    if (!Number.isNaN(confRaw)) {
      result.confidence[name] = Math.max(0, Math.min(1, confRaw));
    }

    const deltaObj = (row.delta && typeof row.delta === "object" ? row.delta : null) as Record<string, unknown> | null;
    if (enabledSet.has("affection")) {
      const v = coerceDelta(deltaObj?.affection ?? row.delta_affection);
      if (v !== null) result.deltas.affection[name] = v;
    }
    if (enabledSet.has("trust")) {
      const v = coerceDelta(deltaObj?.trust ?? row.delta_trust);
      if (v !== null) result.deltas.trust[name] = v;
    }
    if (enabledSet.has("desire")) {
      const v = coerceDelta(deltaObj?.desire ?? row.delta_desire);
      if (v !== null) result.deltas.desire[name] = v;
    }
    if (enabledSet.has("connection")) {
      const v = coerceDelta(deltaObj?.connection ?? row.delta_connection);
      if (v !== null) result.deltas.connection[name] = v;
    }
    if (enabledSet.has("mood")) {
      const v = coerceText(row.mood);
      if (v !== null) result.mood[name] = normalizeMoodLabel(v);
    }
    if (enabledSet.has("lastThought")) {
      const v = coerceText(row.lastThought);
      if (v !== null) result.lastThought[name] = v;
    }
  }

  return result;
}

export function parseCustomDeltaResponse(
  rawText: string,
  activeCharacters: string[],
  statId: string,
  maxDelta = 15,
  nameAliases?: CharacterNameAliases,
): {
  confidence: Record<string, number>;
  delta: Record<string, number>;
} {
  const parsed = safeJsonParse(rawText);
  const byName = new Map<string, Record<string, unknown>>();
  const result = {
    confidence: {} as Record<string, number>,
    delta: {} as Record<string, number>,
  };
  if (!parsed || typeof parsed !== "object") return result;

  const source = parsed as Record<string, unknown>;
  const list = Array.isArray(source.characters) ? source.characters : null;
  if (list) {
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const rawName = String(obj.name ?? "").trim();
      const resolved = resolveCharacterName(rawName, activeCharacters, nameAliases);
      if (!resolved) continue;
      byName.set(resolved, obj);
    }
  } else {
    for (const name of activeCharacters) {
      const row = source[name];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      byName.set(name, row as Record<string, unknown>);
    }
  }

  const safeMaxDelta = Math.max(1, Math.round(Number(maxDelta) || 15));
  const clampDelta = (n: number): number => Math.max(-safeMaxDelta, Math.min(safeMaxDelta, Math.round(n)));
  const coerceDelta = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return clampDelta(value);
    if (typeof value === "string") {
      const n = Number(value);
      if (!Number.isNaN(n)) return clampDelta(n);
    }
    return null;
  };

  for (const name of activeCharacters) {
    const row = byName.get(name);
    if (!row) continue;

    const confRaw = Number(row.confidence);
    if (!Number.isNaN(confRaw)) {
      result.confidence[name] = Math.max(0, Math.min(1, confRaw));
    }

    const deltaObj = (row.delta && typeof row.delta === "object" ? row.delta : null) as Record<string, unknown> | null;
    const valueFromDeltaObject = deltaObj?.[statId];
    const fallbackValue = row[statId] ?? row.value;
    const v = coerceDelta(valueFromDeltaObject ?? fallbackValue);
    if (v !== null) {
      result.delta[name] = v;
    }
  }

  return result;
}

export function parseCustomValueResponse(
  rawText: string,
  activeCharacters: string[],
  statId: string,
  kind: Exclude<CustomStatKind, "numeric">,
  input: {
    enumOptions?: string[];
    textMaxLength?: number;
  } = {},
  nameAliases?: CharacterNameAliases,
): {
  confidence: Record<string, number>;
  value: Record<string, CustomNonNumericValue>;
} {
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
  const parsed = safeJsonParse(rawText);
  const byName = new Map<string, Record<string, unknown>>();
  const result = {
    confidence: {} as Record<string, number>,
    value: {} as Record<string, CustomNonNumericValue>,
  };
  if (!parsed || typeof parsed !== "object") return result;

  const source = parsed as Record<string, unknown>;
  const list = Array.isArray(source.characters) ? source.characters : null;
  if (list) {
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const rawName = String(obj.name ?? "").trim();
      const resolved = resolveCharacterName(rawName, activeCharacters, nameAliases);
      if (!resolved) continue;
      byName.set(resolved, obj);
    }
  } else {
    for (const name of activeCharacters) {
      const row = source[name];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      byName.set(name, row as Record<string, unknown>);
    }
  }

  const enumOptions = Array.isArray(input.enumOptions)
    ? input.enumOptions.map(item => String(item ?? "")).filter(item => item.length > 0 && !hasScriptLikeContent(item))
    : [];
  const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(input.textMaxLength) || 120)));
  const normalizeArrayItems = (raw: unknown): string[] => {
    const source = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/\r?\n|[,;]+/g)
        : [];
    const items: string[] = [];
    const seenItems = new Set<string>();
    for (const item of source) {
      const cleaned = String(item ?? "").trim().replace(/\s+/g, " ").slice(0, textMaxLength);
      if (!cleaned) continue;
      if (hasScriptLikeContent(cleaned)) continue;
      const dedupeKey = cleaned.toLowerCase();
      if (seenItems.has(dedupeKey)) continue;
      seenItems.add(dedupeKey);
      items.push(cleaned);
      if (items.length >= 20) break;
    }
    return items;
  };

  for (const name of activeCharacters) {
    const row = byName.get(name);
    if (!row) continue;

    const confRaw = Number(row.confidence);
    if (!Number.isNaN(confRaw)) {
      result.confidence[name] = Math.max(0, Math.min(1, confRaw));
    }

    const valueObj = (row.value && typeof row.value === "object" ? row.value : null) as Record<string, unknown> | null;
    const candidate = valueObj?.[statId] ?? row[statId] ?? row.value;
    if (kind === "boolean") {
      if (typeof candidate === "boolean") {
        result.value[name] = candidate;
      } else if (typeof candidate === "string") {
        const cleaned = candidate.trim().toLowerCase();
        if (cleaned === "true") result.value[name] = true;
        if (cleaned === "false") result.value[name] = false;
      }
      continue;
    }
    if (kind === "array") {
      const items = normalizeArrayItems(candidate);
      if (items.length > 0) result.value[name] = items;
      continue;
    }
    if (typeof candidate !== "string") continue;
    if (kind === "enum_single") {
      const matched = resolveEnumOption(enumOptions, candidate);
      if (matched != null && !hasScriptLikeContent(matched)) result.value[name] = matched;
      continue;
    }
    const cleaned = candidate.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    result.value[name] = cleaned.slice(0, textMaxLength);
  }

  return result;
}
