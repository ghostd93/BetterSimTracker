export type CapturedGenerationIntent = {
  type: string;
  options: Record<string, unknown>;
  dryRun: boolean;
  capturedAt: number;
};

export function getEventMessageIndex(payload: unknown): number | null {
  if (typeof payload === "number") return Number.isInteger(payload) ? payload : null;
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidate = obj.message ?? obj.messageId ?? obj.id;
  if (typeof candidate !== "number") return null;
  return Number.isInteger(candidate) ? candidate : null;
}

export function isReplayableGenerationIntent(type: string, dryRun: boolean): boolean {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (dryRun) return false;
  if (!normalized) return false;
  return normalized !== "quiet";
}

export function sanitizeGenerationOptions(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "signal" || value === undefined) continue;
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    try {
      out[key] = JSON.parse(JSON.stringify(value));
    } catch {
      // Skip non-serializable options (functions, cyclic refs, etc.).
    }
  }
  return out;
}

export function buildCapturedGenerationIntent(
  type: string,
  options: unknown,
  dryRun: boolean,
): CapturedGenerationIntent | null {
  if (!isReplayableGenerationIntent(type, dryRun)) return null;
  return {
    type,
    options: sanitizeGenerationOptions(options),
    dryRun,
    capturedAt: Date.now(),
  };
}

export function cloneCapturedGenerationIntent(intent: CapturedGenerationIntent): CapturedGenerationIntent {
  return {
    type: intent.type,
    options: sanitizeGenerationOptions(intent.options),
    dryRun: intent.dryRun,
    capturedAt: intent.capturedAt,
  };
}

