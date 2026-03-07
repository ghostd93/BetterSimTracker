import test from "node:test";
import assert from "node:assert/strict";

import {
  countSummarySentences,
  hasNumericCharacters,
  normalizeSummaryProse,
  sanitizeGeneratedSummaryText,
  stripHiddenReasoningBlocks,
  wrapAsSystemNarrativeText,
} from "../src/summaryText";

test("stripHiddenReasoningBlocks removes hidden reasoning tags", () => {
  const input = `Before <think>secret</think> After`;
  assert.equal(stripHiddenReasoningBlocks(input), "Before  After");
});

test("sanitizeGeneratedSummaryText unwraps fenced summary and trims wrappers", () => {
  const input = "```text\nSummary: \"Safe state maintained\"\n```";
  assert.equal(sanitizeGeneratedSummaryText(input), "Safe state maintained");
});

test("normalizeSummaryProse flattens markdown-like lines and ensures punctuation", () => {
  const input = "- calm tone\n- steady trust\n";
  assert.equal(normalizeSummaryProse(input), "calm tone steady trust.");
});

test("summary helpers detect numbers, sentence count, and wrap narrative text", () => {
  assert.equal(hasNumericCharacters("Trust is 65"), true);
  assert.equal(hasNumericCharacters("No numbers here"), false);
  assert.equal(countSummarySentences("One. Two! Three?"), 3);
  assert.equal(wrapAsSystemNarrativeText("**quiet scene**"), "*quiet scene*");
});

