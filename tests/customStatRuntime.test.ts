import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CUSTOM_TEXT_MAX_LENGTH,
  MAX_CUSTOM_ARRAY_ITEMS,
  MAX_CUSTOM_ENUM_OPTIONS,
  normalizeCustomEnumOptions,
  normalizeCustomNonNumericValue,
  normalizeCustomStatDefaultValue,
  normalizeCustomStatKind,
  normalizeCustomTextMaxLength,
  normalizeDateTimeMode,
  normalizeNonNumericArrayItems,
  normalizeNonNumericTextValue,
  resolveEnumOption,
} from "../src/customStatRuntime";

test("normalizeCustomStatKind falls back to numeric for unknown kinds", () => {
  assert.equal(normalizeCustomStatKind("array"), "array");
  assert.equal(normalizeCustomStatKind("weird"), "numeric");
});

test("normalizeDateTimeMode defaults to timestamp", () => {
  assert.equal(normalizeDateTimeMode("structured"), "structured");
  assert.equal(normalizeDateTimeMode("something"), "timestamp");
});

test("normalizeCustomTextMaxLength clamps into supported range", () => {
  assert.equal(normalizeCustomTextMaxLength(5), 20);
  assert.equal(normalizeCustomTextMaxLength(999), 200);
  assert.equal(normalizeCustomTextMaxLength(undefined), DEFAULT_CUSTOM_TEXT_MAX_LENGTH);
});

test("normalizeCustomEnumOptions deduplicates and strips unsafe values", () => {
  const options = normalizeCustomEnumOptions([
    "Low",
    "Low",
    "<script>alert(1)</script>",
    "Medium",
    "High",
  ]);
  assert.deepEqual(options, ["Low", "Medium", "High"]);
});

test("normalizeCustomEnumOptions respects option cap", () => {
  const options = normalizeCustomEnumOptions(Array.from({ length: 80 }, (_, i) => `v${i}`));
  assert.equal(options.length, MAX_CUSTOM_ENUM_OPTIONS);
});

test("resolveEnumOption matches exact, trimmed, and case-insensitive values", () => {
  const options = ["Low", "Medium", "High"];
  assert.equal(resolveEnumOption(options, "Medium"), "Medium");
  assert.equal(resolveEnumOption(options, " medium "), "Medium");
  assert.equal(resolveEnumOption(options, "high"), "High");
  assert.equal(resolveEnumOption(options, "missing"), null);
});

test("normalizeNonNumericTextValue trims whitespace and clamps length", () => {
  assert.equal(normalizeNonNumericTextValue("  hello   world  ", 50), "hello world");
  assert.equal(normalizeNonNumericTextValue("x".repeat(500), 30).length, 30);
});

test("normalizeNonNumericArrayItems parses loose text, removes duplicates, and caps item count", () => {
  const items = normalizeNonNumericArrayItems(" one,\nTwo\n1. Three\n- two\n", 40);
  assert.deepEqual(items, ["one", "Two", "Three"]);

  const manyItems = normalizeNonNumericArrayItems(
    Array.from({ length: 40 }, (_, i) => `item ${i}`),
    40,
  );
  assert.equal(manyItems.length, MAX_CUSTOM_ARRAY_ITEMS);
});

test("normalizeNonNumericArrayItems preserves explicit empty arrays when requested", () => {
  assert.deepEqual(
    normalizeNonNumericArrayItems("[]", 40, { preserveExplicitEmpty: true }),
    [],
  );
});

test("normalizeCustomStatDefaultValue handles all supported kinds", () => {
  assert.equal(
    normalizeCustomStatDefaultValue({ kind: "numeric", defaultValue: 150 }),
    100,
  );
  assert.equal(
    normalizeCustomStatDefaultValue({ kind: "boolean", defaultValue: "true" }),
    true,
  );
  assert.equal(
    normalizeCustomStatDefaultValue({
      kind: "enum_single",
      defaultValue: "medium",
      enumOptions: ["Low", "Medium", "High"],
    }),
    "Medium",
  );
  assert.deepEqual(
    normalizeCustomStatDefaultValue({
      kind: "array",
      defaultValue: ["Hat", "Boots"],
      textMaxLength: 40,
    }),
    ["Hat", "Boots"],
  );
  assert.equal(
    normalizeCustomStatDefaultValue({
      kind: "date_time",
      defaultValue: "2026-03-06 21:30",
    }),
    "2026-03-06 21:30",
  );
  assert.equal(
    normalizeCustomStatDefaultValue({
      kind: "text_short",
      defaultValue: "  hello   world  ",
      textMaxLength: 20,
    }),
    "hello world",
  );
});

test("normalizeCustomNonNumericValue handles supported non-numeric kinds", () => {
  assert.equal(
    normalizeCustomNonNumericValue("boolean", "false"),
    false,
  );
  assert.equal(
    normalizeCustomNonNumericValue("enum_single", "medium", {
      enumOptions: ["Low", "Medium", "High"],
    }),
    "Medium",
  );
  assert.deepEqual(
    normalizeCustomNonNumericValue("array", "hat, boots", {
      textMaxLength: 40,
    }),
    ["hat", "boots"],
  );
  assert.equal(
    normalizeCustomNonNumericValue("date_time", "2026-03-06T21:30:00Z"),
    "2026-03-06 22:30",
  );
  assert.equal(
    normalizeCustomNonNumericValue("text_short", "  hello world  ", {
      textMaxLength: 20,
    }),
    "hello world",
  );
  assert.equal(normalizeCustomNonNumericValue("numeric", "x"), undefined);
});
