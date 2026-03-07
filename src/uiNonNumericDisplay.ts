import { getDateTimeStructuredParts } from "./dateTime";
import type { DateTimeMode } from "./types";
import { normalizeNonNumericArrayItems } from "./customStatRuntime";
import { formatDateTimeTimestampDisplay } from "./uiDateTimeDisplay";

export type NonNumericDisplayDefinition = {
  kind: "text_short" | "enum_single" | "boolean" | "array" | "date_time";
  booleanTrueLabel: string;
  booleanFalseLabel: string;
  textMaxLength: number;
  dateTimeMode: DateTimeMode;
};

export function formatNonNumericForDisplay(def: NonNumericDisplayDefinition, value: string | boolean | string[]): string {
  if (def.kind === "boolean") {
    return value ? def.booleanTrueLabel : def.booleanFalseLabel;
  }
  if (def.kind === "array") {
    const items = Array.isArray(value) ? value : normalizeNonNumericArrayItems(value, def.textMaxLength);
    if (!items.length) return "0 items";
    if (items.length === 1) return items[0];
    return `${items[0]} +${items.length - 1}`;
  }
  if (def.kind === "date_time" && def.dateTimeMode === "structured") {
    const parts = getDateTimeStructuredParts(value);
    if (!parts) return String(value);
    return `${parts.dayOfWeek}, ${parts.time} (${parts.phase})`;
  }
  if (def.kind === "date_time") {
    return formatDateTimeTimestampDisplay(value, "iso");
  }
  return String(value);
}

export function truncateDisplayText(value: string, maxLength: number | null | undefined): string {
  if (typeof maxLength !== "number" || !Number.isFinite(maxLength) || maxLength < 10) return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}
