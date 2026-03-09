import test from "node:test";
import assert from "node:assert/strict";

import { buildOwnerCssClasses, toOwnerCssSuffixFromIdentity } from "../src/ownerCss";

test("toOwnerCssSuffixFromIdentity prefers avatar filename over display name", () => {
  assert.equal(toOwnerCssSuffixFromIdentity("Billie", "billie_alt.png"), "billie-alt");
});

test("toOwnerCssSuffixFromIdentity normalizes persona avatar keys", () => {
  assert.equal(toOwnerCssSuffixFromIdentity("User", "persona:my-main-persona"), "my-main-persona");
});

test("buildOwnerCssClasses keeps avatar-first class and legacy name alias when different", () => {
  assert.equal(
    buildOwnerCssClasses("Billie", "billie_alt.png"),
    "bst-owner-billie-alt bst-owner-name-billie",
  );
});
