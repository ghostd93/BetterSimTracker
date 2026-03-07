import type { STContext } from "./types";

export function computeManualPlaceholderMessageIndices(
  context: STContext | null,
  existingMessageIndices: Set<number>,
  autoGenerateTracker: boolean,
  isTrackableAtIndex: (context: STContext, messageIndex: number) => boolean,
): number[] {
  if (!context || autoGenerateTracker) return [];
  const out: number[] = [];
  for (let i = 0; i < context.chat.length; i += 1) {
    if (existingMessageIndices.has(i)) continue;
    if (!isTrackableAtIndex(context, i)) continue;
    out.push(i);
  }
  return out;
}

