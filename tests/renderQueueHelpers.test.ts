import test from "node:test";
import assert from "node:assert/strict";

import { computeManualPlaceholderMessageIndices } from "../src/renderQueueHelpers";

test("computeManualPlaceholderMessageIndices returns none when auto-generate is on", () => {
  const context = {
    chat: [{}, {}, {}],
  } as any;
  const result = computeManualPlaceholderMessageIndices(
    context,
    new Set<number>(),
    true,
    () => true,
  );
  assert.deepEqual(result, []);
});

test("computeManualPlaceholderMessageIndices returns only missing trackable indices", () => {
  const context = {
    chat: [{}, {}, {}, {}],
  } as any;
  const result = computeManualPlaceholderMessageIndices(
    context,
    new Set<number>([1, 3]),
    false,
    (_ctx, index) => index % 2 === 0,
  );
  assert.deepEqual(result, [0, 2]);
});

