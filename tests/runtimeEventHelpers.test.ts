import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapturedGenerationIntent,
  cloneCapturedGenerationIntent,
  getEventMessageIndex,
  isReplayableGenerationIntent,
  sanitizeGenerationOptions,
} from "../src/runtimeEventHelpers";

test("getEventMessageIndex resolves numeric payloads and common object keys", () => {
  assert.equal(getEventMessageIndex(5), 5);
  assert.equal(getEventMessageIndex({ message: 7 }), 7);
  assert.equal(getEventMessageIndex({ messageId: 8 }), 8);
  assert.equal(getEventMessageIndex({ id: 9 }), 9);
  assert.equal(getEventMessageIndex({ message: 1.5 }), null);
  assert.equal(getEventMessageIndex({ message: "7" }), null);
  assert.equal(getEventMessageIndex(null), null);
});

test("isReplayableGenerationIntent ignores quiet/empty and dry-run requests", () => {
  assert.equal(isReplayableGenerationIntent("normal", false), true);
  assert.equal(isReplayableGenerationIntent("quiet", false), false);
  assert.equal(isReplayableGenerationIntent(" ", false), false);
  assert.equal(isReplayableGenerationIntent("normal", true), false);
});

test("sanitizeGenerationOptions strips signal/undefined and keeps serializable values", () => {
  const raw = {
    signal: "x",
    keepString: "ok",
    keepNumber: 2,
    keepBoolean: true,
    keepNull: null,
    skipUndefined: undefined,
    nested: { a: 1 },
    fn: () => 1,
  };
  const result = sanitizeGenerationOptions(raw);
  assert.deepEqual(result.keepString, "ok");
  assert.deepEqual(result.keepNumber, 2);
  assert.deepEqual(result.keepBoolean, true);
  assert.equal("signal" in result, false);
  assert.equal("skipUndefined" in result, false);
  assert.deepEqual(result.nested, { a: 1 });
  assert.equal("fn" in result, false);
});

test("captured generation intents are built and cloned safely", () => {
  const built = buildCapturedGenerationIntent("normal", { foo: "bar" }, false);
  assert.ok(built);
  if (!built) return;
  assert.equal(built.type, "normal");
  assert.deepEqual(built.options, { foo: "bar" });

  const cloned = cloneCapturedGenerationIntent(built);
  assert.deepEqual(cloned, built);
  assert.notEqual(cloned.options, built.options);

  assert.equal(buildCapturedGenerationIntent("quiet", {}, false), null);
});

