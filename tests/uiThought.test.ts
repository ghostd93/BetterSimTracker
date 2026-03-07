import test from "node:test";
import assert from "node:assert/strict";
import { renderThoughtMarkup, shouldEnableThoughtExpand } from "../src/uiThought";

test("shouldEnableThoughtExpand enables for long one-line text", () => {
  const longBubble = "a".repeat(191);
  const longPanel = "b".repeat(151);
  assert.equal(shouldEnableThoughtExpand(longBubble, "bubble"), true);
  assert.equal(shouldEnableThoughtExpand(longPanel, "panel"), true);
});

test("shouldEnableThoughtExpand enables for multiline and disables for short text", () => {
  assert.equal(shouldEnableThoughtExpand("line1\nline2", "bubble"), true);
  assert.equal(shouldEnableThoughtExpand("short", "bubble"), false);
  assert.equal(shouldEnableThoughtExpand("   ", "panel"), false);
});

test("renderThoughtMarkup renders escaped text and proper toggle state", () => {
  const text = "<unsafe> " + "x".repeat(200);
  const htmlCollapsed = renderThoughtMarkup(text, "k1", "bubble", false);
  assert.match(htmlCollapsed, /bst-mood-bubble/);
  assert.match(htmlCollapsed, /More thought/);
  assert.match(htmlCollapsed, /aria-expanded="false"/);
  assert.doesNotMatch(htmlCollapsed, /<unsafe>/);
  assert.match(htmlCollapsed, /&lt;unsafe&gt;/);

  const htmlExpanded = renderThoughtMarkup(text, "k1", "panel", true);
  assert.match(htmlExpanded, /bst-thought/);
  assert.match(htmlExpanded, /bst-thought-expanded/);
  assert.match(htmlExpanded, /Less thought/);
  assert.match(htmlExpanded, /aria-expanded="true"/);
});
