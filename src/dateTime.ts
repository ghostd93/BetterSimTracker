function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function parseFromParts(
  yearText: string,
  monthText: string,
  dayText: string,
  hourText: string,
  minuteText: string,
): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return "";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (!Number.isInteger(day) || day < 1 || day > 31) return "";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) return "";
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return "";
  }
  return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}`;
}

function parseNormalizedToDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

const WEEKDAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function parseRelativeMinutes(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const explicit = value.match(/^([+-]?\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i);
  if (!explicit) return null;
  const amount = Number(explicit[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = String(explicit[2] ?? "m").toLowerCase();
  if (unit.startsWith("d")) return amount * 24 * 60;
  if (unit.startsWith("h")) return amount * 60;
  return amount;
}

function inferHourFromPhase(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const phase = raw.trim().toLowerCase();
  if (!phase) return null;
  // Check most-specific phrases first to avoid partial collisions.
  if (phase.includes("midnight")) return 0;
  if (phase.includes("late evening")) return 23;
  if (phase.includes("early evening")) return 19;
  if (phase.includes("late afternoon")) return 18;
  if (phase.includes("early afternoon")) return 14;
  if (phase.includes("late morning")) return 11;
  if (phase.includes("early morning")) return 8;
  if (phase.includes("dawn")) return 6;
  if (phase.includes("night")) return 2;
  if (phase.includes("morning")) return 10;
  if (phase.includes("noon")) return 12;
  if (phase.includes("afternoon")) return 16;
  if (phase.includes("evening")) return 21;
  return null;
}

function resolvePhaseByHour(hour: number): string {
  if (hour === 0) return "Midnight";
  if (hour >= 1 && hour <= 4) return "Night";
  if (hour >= 5 && hour <= 6) return "Dawn";
  if (hour >= 7 && hour <= 8) return "Early Morning";
  if (hour >= 9 && hour <= 10) return "Morning";
  if (hour === 11) return "Late Morning";
  if (hour === 12) return "Noon";
  if (hour >= 13 && hour <= 14) return "Early Afternoon";
  if (hour >= 15 && hour <= 16) return "Afternoon";
  if (hour >= 17 && hour <= 18) return "Late Afternoon";
  if (hour >= 19 && hour <= 20) return "Early Evening";
  if (hour === 21) return "Evening";
  return "Late Evening";
}

export function normalizeStructuredDateTimeCandidate(raw: unknown, previous?: unknown): string {
  if (raw == null) return "";

  const prevNormalized = normalizeDateTimeValue(previous);
  const prevDate = prevNormalized ? parseNormalizedToDate(prevNormalized) : null;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeStructuredDateTimeCandidate(parsed, previous);
      } catch {
        return normalizeDateTimeValue(raw);
      }
    }
    const relativeMinutes = parseRelativeMinutes(trimmed);
    if (relativeMinutes != null && prevDate) {
      const shifted = new Date(prevDate.getTime() + relativeMinutes * 60_000);
      return formatLocalDateTime(shifted);
    }
    return normalizeDateTimeValue(raw);
  }

  if (typeof raw !== "object" || Array.isArray(raw)) return normalizeDateTimeValue(raw);
  const obj = raw as Record<string, unknown>;

  const absoluteCandidates = [obj.absolute, obj.datetime, obj.timestamp, obj.value, obj.iso];
  for (const candidate of absoluteCandidates) {
    const normalized = normalizeDateTimeValue(candidate);
    if (normalized) return normalized;
  }

  const hasParts =
    obj.year !== undefined ||
    obj.month !== undefined ||
    obj.day !== undefined ||
    obj.hour !== undefined ||
    obj.minute !== undefined;
  if (hasParts) {
    const prevYear = prevDate ? String(prevDate.getFullYear()) : "2026";
    const prevMonth = prevDate ? pad2(prevDate.getMonth() + 1) : "01";
    const prevDay = prevDate ? pad2(prevDate.getDate()) : "01";
    const prevHour = prevDate ? pad2(prevDate.getHours()) : "00";
    const prevMinute = prevDate ? pad2(prevDate.getMinutes()) : "00";
    const phaseHour = inferHourFromPhase(obj.ofDay);
    const parsed = parseFromParts(
      String(obj.year ?? prevYear).padStart(4, "0"),
      String(obj.month ?? prevMonth).padStart(2, "0"),
      String(obj.day ?? prevDay).padStart(2, "0"),
      String(obj.hour ?? (phaseHour != null ? String(phaseHour) : prevHour)).padStart(2, "0"),
      String(obj.minute ?? prevMinute).padStart(2, "0"),
    );
    if (parsed) return parsed;
  }

  const relativeMinutes =
    parseRelativeMinutes(obj.delta_minutes)
    ?? parseRelativeMinutes(obj.relative_delta)
    ?? parseRelativeMinutes(obj.delta);
  if (relativeMinutes != null && prevDate) {
    const shifted = new Date(prevDate.getTime() + relativeMinutes * 60_000);
    return formatLocalDateTime(shifted);
  }

  return "";
}

export function normalizeDateTimeWithMode(raw: unknown, mode: unknown, previous?: unknown): string {
  const normalizedMode = mode === "structured" ? "structured" : "timestamp";
  if (normalizedMode === "structured") {
    const structured = normalizeStructuredDateTimeCandidate(raw, previous);
    if (structured) return structured;
  }
  return normalizeDateTimeValue(raw);
}

export function getDateTimeStructuredParts(raw: unknown): {
  date: string;
  time: string;
  dayOfWeek: string;
  phase: string;
} | null {
  const normalized = normalizeDateTimeValue(raw);
  const date = normalized ? parseNormalizedToDate(normalized) : null;
  if (!date) return null;
  const dayOfWeek = WEEKDAY_NAMES_EN[date.getDay()] ?? "Unknown";
  const hour = date.getHours();
  const phase = resolvePhaseByHour(hour);
  return {
    date: normalized.slice(0, 10),
    time: normalized.slice(11),
    dayOfWeek,
    phase,
  };
}

export function normalizeDateTimeValue(raw: unknown): string {
  if (raw == null) return "";

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? "" : formatLocalDateTime(raw);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "" : formatLocalDateTime(date);
  }

  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";

  const plain = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  if (plain) {
    return parseFromParts(plain[1], plain[2], plain[3], plain[4], plain[5]);
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return parseFromParts(dateOnly[1], dateOnly[2], dateOnly[3], "00", "00");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatLocalDateTime(parsed);
}

export function toDateTimeInputValue(raw: unknown): string {
  const normalized = normalizeDateTimeValue(raw);
  return normalized ? normalized.replace(" ", "T") : "";
}
