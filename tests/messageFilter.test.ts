import test from "node:test";
import assert from "node:assert/strict";

import { isTrackableAiMessage, isTrackableMessage, isTrackableUserMessage } from "../src/messageFilter";
import type { ChatMessage } from "../src/types";

test("messageFilter accepts normal user and ai chat messages", () => {
  const ai: ChatMessage = { mes: "Hello", name: "Seraphina", is_user: false, is_system: false };
  const user: ChatMessage = { mes: "Hi", is_user: true, is_system: false };
  assert.equal(isTrackableAiMessage(ai), true);
  assert.equal(isTrackableUserMessage(user), true);
  assert.equal(isTrackableMessage(ai), true);
  assert.equal(isTrackableMessage(user), true);
});

test("messageFilter rejects tracker summaries, ST welcome assistant, and generated media", () => {
  const summary: ChatMessage = {
    mes: "summary",
    is_user: false,
    is_system: false,
    extra: { bstSummaryNote: true },
  };
  const welcome: ChatMessage = {
    mes: "If you're connected to an API, try asking me something!",
    is_user: false,
    is_system: false,
    extra: { type: "assistant_message" },
  };
  const media: ChatMessage = {
    mes: "img",
    is_user: false,
    is_system: false,
    extra: { media: [{ source: "generated" }] },
  };
  assert.equal(isTrackableAiMessage(summary), false);
  assert.equal(isTrackableAiMessage(welcome), false);
  assert.equal(isTrackableAiMessage(media), false);
});
