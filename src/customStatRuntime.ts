import { normalizeDateTimeValue } from "./dateTime";
import type { CustomNonNumericValue, CustomStatKind, DateTimeMode } from "./types";

export const DEFAULT_CUSTOM_TEXT_MAX_LENGTH = 120;
export const MIN_CUSTOM_TEXT_MAX_LENGTH = 20;
export const MAX_CUSTOM_TEXT_MAX_LENGTH = 200;
export const MAX_CUSTOM_ENUM_OPTIONS = 12;
export const MAX_CUSTOM_ARRAY_ITEMS = 20;

export function normalizeCustomStatKind(value: unknown): CustomStatKind {
  if (value === "enum_single" || value === "boolean" || value === "text_short" || value === "array" || value === "date_time") {
    return value;
  }
  return "numeric";
}

export function normalizeDateTimeMode(value: unknown): DateTimeMode {
  return value === "structured" ? "structured" : "timestamp";
}

export function normalizeCustomTextMaxLength(value: unknown, fallback = DEFAULT_CUSTOM_TEXT_MAX_LENGTH): number {
  const parsed = Math.round(Number(value) || fallback);
  return Math.max(MIN_CUSTOM_TEXT_MAX_LENGTH, Math.min(MAX_CUSTOM_TEXT_MAX_LENGTH, parsed));
}

export function hasScriptLikeContent(value: string): boolean {
  return /<\s*\/?\s*script\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i.test(value);
}

export function normalizeCustomEnumOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const option = String(item ?? "");
    if (!option.length || hasScriptLikeContent(option) || seen.has(option)) continue;
    seen.add(option);
    out.push(option);
    if (out.length >= MAX_CUSTOM_ENUM_OPTIONS) break;
  }
  return out;
}

export function resolveEnumOption(options: string[], candidate: unknown): string | null {
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
}

export function normalizeNonNumericTextValue(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, normalizeCustomTextMaxLength(maxLength));
}

function normalizeArrayToken(token: string): string {
  return token
    .replace(/^[\s\-–—*•Â·\u2022\u25E6]+/, "")
    .replace(/^\s*\d+[\.\)]\s+/, "")
    .replace(/^"(.*)"$/s, "$1")
    .replace(/^'(.*)'$/s, "$1")
    .trim();
}

export function normalizeNonNumericArrayItems(
  value: unknown,
  maxLength: number,
  options?: { preserveExplicitEmpty?: boolean },
): string[] {
  const boundedMaxLength = normalizeCustomTextMaxLength(maxLength);
  const emptyMarkers = new Set(["[]", "none", "no items", "empty", "n/a", "null", "clear"]);
  const parseString = (text: string): unknown[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (emptyMarkers.has(trimmed.toLowerCase())) {
      return options?.preserveExplicitEmpty ? ["__BST_EMPTY_ARRAY__"] : [];
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fall through to loose tokenization.
      }
    }
    return trimmed.split(/\r?\n|[,;]+/g);
  };

  const source = Array.isArray(value)
    ? value
    : (typeof value === "string" ? parseString(value) : []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const raw = String(item ?? "");
    if (raw === "__BST_EMPTY_ARRAY__") {
      if (options?.preserveExplicitEmpty) return [];
      continue;
    }
    const text = normalizeArrayToken(raw).replace(/\s+/g, " ").slice(0, boundedMaxLength);
    if (!text || hasScriptLikeContent(text)) continue;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(text);
    if (out.length >= MAX_CUSTOM_ARRAY_ITEMS) break;
  }
  return out;
}

export function normalizeCustomStatDefaultValue(
  stat: {
    kind: unknown;
    defaultValue: unknown;
    enumOptions?: unknown;
    textMaxLength?: unknown;
    dateTimeMode?: unknown;
  },
): number | string | boolean | string[] {
  const kind = normalizeCustomStatKind(stat.kind);
  const textMaxLength = normalizeCustomTextMaxLength(stat.textMaxLength);
  if (kind === "numeric") {
    const parsed = Math.round(Number(stat.defaultValue) || 50);
    return Math.max(0, Math.min(100, parsed));
  }
  if (kind === "boolean") {
    if (typeof stat.defaultValue === "boolean") return stat.defaultValue;
    if (typeof stat.defaultValue === "string") {
      const cleaned = stat.defaultValue.trim().toLowerCase();
      if (cleaned === "true") return true;
      if (cleaned === "false") return false;
    }
    return false;
  }
  if (kind === "enum_single") {
    const options = normalizeCustomEnumOptions(stat.enumOptions);
    return resolveEnumOption(options, stat.defaultValue) ?? options[0] ?? "state";
  }
  if (kind === "array") {
    return normalizeNonNumericArrayItems(stat.defaultValue, textMaxLength);
  }
  if (kind === "date_time") {
    return normalizeDateTimeValue(stat.defaultValue);
  }
  return normalizeNonNumericTextValue(stat.defaultValue, textMaxLength);
}

export function normalizeCustomNonNumericValue(
  kindInput: unknown,
  value: unknown,
  options?: {
    enumOptions?: string[];
    textMaxLength?: number;
    dateTimeMode?: DateTimeMode;
    preserveExplicitEmptyArray?: boolean;
  },
): CustomNonNumericValue | undefined {
  const kind = normalizeCustomStatKind(kindInput);
  const textMaxLength = normalizeCustomTextMaxLength(options?.textMaxLength);
  if (kind === "numeric") return undefined;
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const cleaned = value.trim().toLowerCase();
      if (cleaned === "true") return true;
      if (cleaned === "false") return false;
    }
    return undefined;
  }
  if (kind === "enum_single") {
    const optionsList = normalizeCustomEnumOptions(options?.enumOptions);
    return resolveEnumOption(optionsList, value) ?? undefined;
  }
  if (kind === "array") {
    if (Array.isArray(value) || typeof value === "string") {
      return normalizeNonNumericArrayItems(value, textMaxLength, { preserveExplicitEmpty: options?.preserveExplicitEmptyArray });
    }
    return undefined;
  }
  if (kind === "date_time") {
    const mode = normalizeDateTimeMode(options?.dateTimeMode);
    return mode === "structured"
      ? normalizeDateTimeValue(value)
      : normalizeDateTimeValue(value);
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeNonNumericTextValue(value, textMaxLength);
  return normalized || undefined;
}
