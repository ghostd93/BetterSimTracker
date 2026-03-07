import test from "node:test";
import assert from "node:assert/strict";

import { buildCharacterCardsContext } from "../src/characterCardContext";

test("buildCharacterCardsContext includes all same-name cards and disambiguates by avatar", () => {
  const context = {
    characters: [
      { name: "Chloe", avatar: "chloe_a.png", description: "Variant A description." },
      { name: "Chloe", avatar: "chloe_b.png", personality: "Variant B personality." },
      { name: "Billie", avatar: "billie.png", description: "Billie card." },
    ],
  } as any;

  const rendered = buildCharacterCardsContext(context, ["Chloe"]);
  assert.match(rendered, /Character Card - Chloe \[chloe_a\.png\]/);
  assert.match(rendered, /Character Card - Chloe \[chloe_b\.png\]/);
  assert.match(rendered, /Variant A description\./);
  assert.match(rendered, /Variant B personality\./);
  assert.doesNotMatch(rendered, /Billie card\./);
});

test("buildCharacterCardsContext can target by avatar token", () => {
  const context = {
    characters: [
      { name: "Chloe", avatar: "chloe_a.png", description: "Variant A description." },
      { name: "Chloe", avatar: "chloe_b.png", description: "Variant B description." },
    ],
  } as any;

  const rendered = buildCharacterCardsContext(context, ["chloe_b.png"]);
  assert.match(rendered, /Character Card - Chloe \[chloe_b\.png\]/);
  assert.match(rendered, /Variant B description\./);
  assert.doesNotMatch(rendered, /chloe_a\.png/);
});

test("buildCharacterCardsContext in 1:1 chat scopes duplicate names to current characterId avatar", () => {
  const context = {
    characterId: 0,
    groupId: "",
    characters: [
      { name: "Chloe", avatar: "chloe_a.png", description: "Variant A description." },
      { name: "Chloe", avatar: "chloe_b.png", description: "Variant B description." },
    ],
  } as any;

  const rendered = buildCharacterCardsContext(context, ["Chloe"]);
  assert.match(rendered, /Character Card - Chloe \[chloe_a\.png\]/);
  assert.match(rendered, /Variant A description\./);
  assert.doesNotMatch(rendered, /chloe_b\.png/);
  assert.doesNotMatch(rendered, /Variant B description\./);
});

test("buildCharacterCardsContext skips cards without descriptive fields", () => {
  const context = {
    characters: [
      { name: "Chloe", avatar: "chloe_a.png" },
    ],
  } as any;

  const rendered = buildCharacterCardsContext(context, ["Chloe"]);
  assert.equal(rendered, "");
});

