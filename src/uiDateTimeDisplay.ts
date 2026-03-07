import { getDateTimeStructuredParts, normalizeDateTimeValue } from "./dateTime";

export const DATE_TIME_PART_KEYS = ["weekday", "date", "time", "phase"] as const;
export type DateTimePartKey = (typeof DATE_TIME_PART_KEYS)[number];
export type DateTimeDisplayFormat = "iso" | "dmy" | "mdy" | "d_mmm_yyyy" | "mmmm_d_yyyy" | "mmmm_do_yyyy";

type StructuredChipOptions = {
  showWeekday?: boolean;
  showDate?: boolean;
  showTime?: boolean;
  showPhase?: boolean;
  showPartLabels?: boolean;
  labelWeekday?: string;
  labelDate?: string;
  labelTime?: string;
  labelPhase?: string;
  dateFormat?: DateTimeDisplayFormat;
  partOrder?: DateTimePartKey[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTH_NAMES_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_NAMES_LONG_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function getOrdinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = day % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function parseNormalizedDateTime(raw: unknown): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const normalized = normalizeDateTimeValue(raw);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { year, month, day, hour, minute };
}

function formatDateWithPreset(
  parts: { year: number; month: number; day: number },
  format: DateTimeDisplayFormat,
): string {
  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  const monthShort = MONTH_NAMES_SHORT_EN[parts.month - 1] ?? mm;
  const monthLong = MONTH_NAMES_LONG_EN[parts.month - 1] ?? mm;
  if (format === "dmy") return `${dd}-${mm}-${yyyy}`;
  if (format === "mdy") return `${mm}-${dd}-${yyyy}`;
  if (format === "d_mmm_yyyy") return `${dd} ${monthShort} ${yyyy}`;
  if (format === "mmmm_d_yyyy") return `${monthLong} ${parts.day}, ${yyyy}`;
  if (format === "mmmm_do_yyyy") return `${monthLong} ${parts.day}${getOrdinalSuffix(parts.day)}, ${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateTimeTimestampDisplay(raw: unknown, format: DateTimeDisplayFormat): string {
  const parsed = parseNormalizedDateTime(raw);
  if (!parsed) return String(raw ?? "");
  const datePart = formatDateWithPreset(parsed, format);
  const timePart = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
  return `${datePart} ${timePart}`;
}

export function normalizeDateTimePartOrder(parts: string[]): DateTimePartKey[] {
  const next: DateTimePartKey[] = [];
  for (const raw of parts) {
    const key = String(raw ?? "").trim().toLowerCase();
    if ((key === "weekday" || key === "date" || key === "time" || key === "phase") && !next.includes(key)) {
      next.push(key);
    }
  }
  for (const key of DATE_TIME_PART_KEYS) {
    if (!next.includes(key)) next.push(key);
  }
  return next;
}

export function renderDateTimeStructuredChips(
  value: string | boolean | string[],
  color: string,
  options?: StructuredChipOptions,
): string {
  const parts = getDateTimeStructuredParts(value);
  if (!parts) {
    const raw = String(value ?? "").trim();
    return raw
      ? `<span class="bst-array-item-chip" style="--bst-stat-color:${escapeHtml(color)};" title="${escapeHtml(raw)}">${escapeHtml(raw)}</span>`
      : `<span class="bst-array-item-empty">Not set</span>`;
  }
  const formatDatePart = (rawDate: string): string => {
    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return rawDate;
    const [, y, m, d] = match;
    const mode =
      options?.dateFormat === "dmy" ||
      options?.dateFormat === "mdy" ||
      options?.dateFormat === "d_mmm_yyyy" ||
      options?.dateFormat === "mmmm_d_yyyy" ||
      options?.dateFormat === "mmmm_do_yyyy"
        ? options.dateFormat
        : "iso";
    return formatDateWithPreset({ year: Number(y), month: Number(m), day: Number(d) }, mode);
  };
  const showMap = {
    weekday: options?.showWeekday !== false,
    date: options?.showDate !== false,
    time: options?.showTime !== false,
    phase: options?.showPhase !== false,
  };
  const labelMap = {
    weekday: String(options?.labelWeekday ?? "Day").trim() || "Day",
    date: String(options?.labelDate ?? "Date").trim() || "Date",
    time: String(options?.labelTime ?? "Time").trim() || "Time",
    phase: String(options?.labelPhase ?? "Phase").trim() || "Phase",
  };
  const valueMap = {
    weekday: parts.dayOfWeek,
    date: formatDatePart(parts.date),
    time: parts.time,
    phase: parts.phase,
  };
  const rawOrder = normalizeDateTimePartOrder(Array.isArray(options?.partOrder) ? options!.partOrder : ["weekday", "date", "time", "phase"]);
  const showPartLabels = Boolean(options?.showPartLabels);
  const chips = rawOrder
    .filter(key => showMap[key])
    .map(key => {
      const valueText = valueMap[key];
      const displayText = showPartLabels ? `${labelMap[key]}: ${valueText}` : valueText;
      return `<span class="bst-array-item-chip" style="--bst-stat-color:${escapeHtml(color)};" title="${escapeHtml(displayText)}">${escapeHtml(displayText)}</span>`;
    });
  return chips.length
    ? chips.join("")
    : `<span class="bst-array-item-empty">Not set</span>`;
}
