import test from "node:test";
import assert from "node:assert/strict";
import { formatDateTimeTimestampDisplay, normalizeDateTimePartOrder, renderDateTimeStructuredChips } from "../src/uiDateTimeDisplay";

test("normalizeDateTimePartOrder deduplicates and appends missing keys", () => {
  const ordered = normalizeDateTimePartOrder(["time", "date", "time", "invalid", "phase"]);
  assert.deepEqual(ordered, ["time", "date", "phase", "weekday"]);
});

test("formatDateTimeTimestampDisplay supports multiple date presets", () => {
  const input = "2026-03-06 20:05";
  assert.equal(formatDateTimeTimestampDisplay(input, "iso"), "2026-03-06 20:05");
  assert.equal(formatDateTimeTimestampDisplay(input, "dmy"), "06-03-2026 20:05");
  assert.equal(formatDateTimeTimestampDisplay(input, "mdy"), "03-06-2026 20:05");
  assert.equal(formatDateTimeTimestampDisplay(input, "d_mmm_yyyy"), "06 Mar 2026 20:05");
  assert.equal(formatDateTimeTimestampDisplay(input, "mmmm_d_yyyy"), "March 6, 2026 20:05");
  assert.equal(formatDateTimeTimestampDisplay(input, "mmmm_do_yyyy"), "March 6th, 2026 20:05");
});

test("renderDateTimeStructuredChips honors labels, order, and show toggles", () => {
  const html = renderDateTimeStructuredChips("2026-03-06 20:05", "#66ccff", {
    showPartLabels: true,
    showWeekday: false,
    partOrder: ["phase", "time", "date", "weekday"],
    labelDate: "Calendar Date",
    labelTime: "Clock",
    labelPhase: "Phase Label",
    dateFormat: "d_mmm_yyyy",
  });
  assert.match(html, /Phase Label:/);
  assert.match(html, /Clock:/);
  assert.match(html, /Calendar Date: 06 Mar 2026/);
  assert.doesNotMatch(html, /Day:/);
});
