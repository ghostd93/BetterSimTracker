import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProgressApply,
  buildProgressApplyingDefaults,
  buildProgressNoExtractionNeeded,
  buildProgressParse,
  buildProgressRequest,
  buildProgressSeedingDefaults,
  buildProgressUnifiedBatch,
  formatBuiltInProgressLabel,
  formatCustomGroupProgressLabel,
  formatCustomProgressLabel,
} from "../src/extractorProgress";
import type { CustomStatDefinition } from "../src/types";

test("built-in and custom progress label formatters are stable", () => {
  assert.equal(formatBuiltInProgressLabel(["affection"]), "Built-in: affection");
  assert.equal(formatBuiltInProgressLabel(["affection", "trust"]), "Built-ins: affection, trust");

  const custom: CustomStatDefinition = {
    id: "clothes",
    kind: "text_short",
    label: "Clothes",
    description: "",
    behaviorGuidance: "",
    defaultValue: "",
    textMaxLength: 120,
    track: true,
    trackCharacters: true,
    trackUser: true,
    globalScope: false,
    privateToOwner: false,
    showOnCard: true,
    showInGraph: false,
    includeInInjection: true,
  };
  assert.equal(formatCustomProgressLabel(custom), "Custom: Clothes");
  assert.equal(formatCustomGroupProgressLabel([custom, { ...custom, id: "pose", label: "Pose" }]), "Custom Group: clothes+pose");
});

test("progress wrappers keep consistent prefixes", () => {
  assert.equal(buildProgressRequest("Custom: Clothes"), "Requesting Custom: Clothes");
  assert.equal(buildProgressParse("Custom: Clothes"), "Parsing Custom: Clothes");
  assert.equal(buildProgressApply("Custom: Clothes"), "Applying Custom: Clothes");
  assert.equal(buildProgressSeedingDefaults("unified"), "Seeding defaults (unified)");
  assert.equal(buildProgressNoExtractionNeeded("unified"), "No extraction needed (unified)");
  assert.equal(buildProgressApplyingDefaults("unified"), "Applying defaults (unified)");
  assert.equal(buildProgressUnifiedBatch("unified-private:Seraphina"), "Unified Batch (unified-private:Seraphina)");
});

