import type { ChatMessage } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function hasGeneratedMediaAttachment(message: ChatMessage): boolean {
  const extra = asRecord((message as unknown as { extra?: unknown }).extra);
  if (!extra) return false;

  const media = Array.isArray(extra.media) ? extra.media : [];
  for (const item of media) {
    const entry = asRecord(item);
    if (!entry) continue;
    const source = String(entry.source ?? "").trim().toLowerCase();
    if (source === "generated") return true;
    if (typeof entry.generation_type === "number") return true;
  }

  if (typeof extra.generation_type === "number") return true;
  return false;
}

function isTrackerSummaryNote(message: ChatMessage): boolean {
  const extra = asRecord((message as unknown as { extra?: unknown }).extra);
  if (!extra) return false;
  if (extra.bstSummaryNote === true) return true;
  if (extra.bst_summary_note === true) return true;
  return String(extra.model ?? "").trim().toLowerCase() === "bettersimtracker.summary";
}

function getMessageExtraType(message: ChatMessage): string {
  const extra = asRecord((message as unknown as { extra?: unknown }).extra);
  if (!extra) return "";
  return String(extra.type ?? "").trim().toLowerCase();
}

function isSillyTavernSystemByName(message: ChatMessage): boolean {
  const name = String((message as unknown as { name?: unknown }).name ?? "").trim().toLowerCase();
  return name === "sillytavern system";
}

function isSillyTavernWelcomeAssistantMessage(message: ChatMessage): boolean {
  if (message.is_user || message.is_system) return false;
  const extraType = getMessageExtraType(message);
  if (extraType === "assistant_message" || extraType === "welcome_prompt") return true;
  const text = String(message.mes ?? "").trim().toLowerCase();
  if (!text) return false;
  // ST welcome page default assistant text variants. Keep this conservative to avoid filtering normal chats.
  const hasWelcomeHint =
    text.includes("if you're connected to an api, try asking me something") ||
    text.includes("set any character as your welcome page assistant");
  if (!hasWelcomeHint) return false;
  return true;
}

function isNonTrackableSystemUtilityMessage(message: ChatMessage): boolean {
  if (message.is_user || message.is_system) return false;
  if (isSillyTavernSystemByName(message)) return true;
  const extraType = getMessageExtraType(message);
  // ST utility/system chat entries that should never be treated as RP character turns.
  if (extraType === "assistant_message" || extraType === "welcome_prompt" || extraType === "assistant_note") {
    return true;
  }
  return false;
}

export function isTrackableAiMessage(message: ChatMessage | null | undefined): boolean {
  if (!message || typeof message !== "object") return false;
  if (message.is_user || message.is_system) return false;
  if (isTrackerSummaryNote(message)) return false;
  if (isNonTrackableSystemUtilityMessage(message)) return false;
  if (isSillyTavernWelcomeAssistantMessage(message)) return false;
  if (hasGeneratedMediaAttachment(message)) return false;
  return true;
}

export function isTrackableUserMessage(message: ChatMessage | null | undefined): boolean {
  if (!message || typeof message !== "object") return false;
  if (!message.is_user || message.is_system) return false;
  if (isTrackerSummaryNote(message)) return false;
  if (!String(message.mes ?? "").trim()) return false;
  return true;
}

export function isTrackableMessage(message: ChatMessage | null | undefined): boolean {
  return isTrackableAiMessage(message) || isTrackableUserMessage(message);
}

