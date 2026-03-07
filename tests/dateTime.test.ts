import test from "node:test";
import assert from "node:assert/strict";

import {
  getDateTimeStructuredParts,
  normalizeDateTimeValue,
  normalizeDateTimeWithMode,
  normalizeStructuredDateTimeCandidate,
  toDateTimeInputValue,
} from "../src/dateTime";

test("normalizeDateTimeValue accepts canonical, date-only, Date, and rejects invalid values", () => {
  assert.equal(normalizeDateTimeValue("2026-03-06 21:30"), "2026-03-06 21:30");
  assert.equal(normalizeDateTimeValue("2026-03-06"), "2026-03-06 00:00");
  assert.equal(normalizeDateTimeValue(new Date(2026, 2, 6, 21, 30)), "2026-03-06 21:30");
  assert.equal(normalizeDateTimeValue("2026-02-31 12:00"), "");
});

test("normalizeStructuredDateTimeCandidate handles relative shifts and semantic phases", () => {
  assert.equal(
    normalizeStructuredDateTimeCandidate("+15m", "2026-03-06 21:30"),
    "2026-03-06 21:45",
  );
  assert.equal(
    normalizeStructuredDateTimeCandidate({ delta_minutes: 120 }, "2026-03-06 21:30"),
    "2026-03-06 23:30",
  );
  assert.equal(
    normalizeStructuredDateTimeCandidate(
      { year: 2026, month: 3, day: 7, ofDay: "Early Evening" },
      "2026-03-06 21:30",
    ),
    "2026-03-07 19:30",
  );
});

test("normalizeDateTimeWithMode respects structured candidates before timestamp fallback", () => {
  assert.equal(
    normalizeDateTimeWithMode({ value: "2026-03-07 08:45" }, "structured"),
    "2026-03-07 08:45",
  );
  assert.equal(
    normalizeDateTimeWithMode("2026-03-07 08:45", "timestamp"),
    "2026-03-07 08:45",
  );
});

test("getDateTimeStructuredParts returns weekday, phase, and canonical pieces", () => {
  const parts = getDateTimeStructuredParts("2026-03-03 20:00");
  assert.deepEqual(parts, {
    date: "2026-03-03",
    time: "20:00",
    dayOfWeek: "Tuesday",
    phase: "Early Evening",
  });
});

test("toDateTimeInputValue produces datetime-local compatible value", () => {
  assert.equal(toDateTimeInputValue("2026-03-06 21:30"), "2026-03-06T21:30");
  assert.equal(toDateTimeInputValue("invalid"), "");
});
