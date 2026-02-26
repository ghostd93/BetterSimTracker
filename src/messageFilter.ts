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

export function isTrackableAiMessage(message: ChatMessage | null | undefined): boolean {
  if (!message || typeof message !== "object") return false;
  if (message.is_user || message.is_system) return false;
  if (isTrackerSummaryNote(message)) return false;
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

