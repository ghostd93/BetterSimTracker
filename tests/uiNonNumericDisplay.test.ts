import test from "node:test";
import assert from "node:assert/strict";
import { formatNonNumericForDisplay, truncateDisplayText } from "../src/uiNonNumericDisplay";

test("formatNonNumericForDisplay handles boolean labels", () => {
  const def = {
    kind: "boolean" as const,
    booleanTrueLabel: "On",
    booleanFalseLabel: "Off",
    textMaxLength: 100,
    dateTimeMode: "timestamp" as const,
  };
  assert.equal(formatNonNumericForDisplay(def, true), "On");
  assert.equal(formatNonNumericForDisplay(def, false), "Off");
});

test("formatNonNumericForDisplay summarizes array values", () => {
  const def = {
    kind: "array" as const,
    booleanTrueLabel: "On",
    booleanFalseLabel: "Off",
    textMaxLength: 100,
    dateTimeMode: "timestamp" as const,
  };
  assert.equal(formatNonNumericForDisplay(def, ["one"]), "one");
  assert.equal(formatNonNumericForDisplay(def, ["one", "two", "three"]), "one +2");
});

test("formatNonNumericForDisplay renders date_time in timestamp and structured modes", () => {
  const timestampDef = {
    kind: "date_time" as const,
    booleanTrueLabel: "On",
    booleanFalseLabel: "Off",
    textMaxLength: 100,
    dateTimeMode: "timestamp" as const,
  };
  const structuredDef = {
    ...timestampDef,
    dateTimeMode: "structured" as const,
  };
  assert.equal(formatNonNumericForDisplay(timestampDef, "2026-03-06 20:05"), "2026-03-06 20:05");
  const structured = formatNonNumericForDisplay(structuredDef, "2026-03-06 20:05");
  assert.match(structured, /Friday|Thursday|Wednesday|Tuesday|Monday|Saturday|Sunday/);
  assert.match(structured, /\(.*\)/);
});

test("truncateDisplayText truncates with ellipsis only when configured and needed", () => {
  assert.equal(truncateDisplayText("short", 20), "short");
  assert.equal(truncateDisplayText("123456789012345", 10), "123456789\u2026");
  assert.equal(truncateDisplayText("unchanged", 0), "unchanged");
});
