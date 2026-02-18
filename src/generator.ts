import type { BetterSimTrackerSettings } from "./types";

interface GenerateResponse {
  content?: string;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
}

function extractContent(payload: GenerateResponse): string {
  if (typeof payload.content === "string") return payload.content;
  const first = payload.choices?.[0];
  return first?.message?.content ?? first?.text ?? "";
}

function normalizeProfileId(settings: BetterSimTrackerSettings): string | undefined {
  const raw = settings.connectionProfile?.trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === "default") return undefined;
  return raw;
}

async function generateViaSillyTavern(prompt: string, profileId?: string): Promise<string> {
  const loadScriptModule = Function("return import('/script.js')") as () => Promise<unknown>;
  const module = await loadScriptModule();
  const quietFn = (module as { generateQuietPrompt?: (args: {
    quietPrompt?: string;
    responseLength?: number;
    removeReasoning?: boolean;
    profileId?: string;
    profile_id?: string;
    connectionProfile?: string;
  }) => Promise<string> }).generateQuietPrompt;

  if (typeof quietFn !== "function") {
    throw new Error("generateQuietPrompt not available from /script.js");
  }

  const text = await quietFn({
    quietPrompt: prompt,
    responseLength: 300,
    removeReasoning: true,
    profileId,
    profile_id: profileId,
    connectionProfile: profileId
  });

  const output = String(text ?? "").trim();
  if (!output) {
    throw new Error("generateQuietPrompt returned empty output");
  }
  return output;
}

export async function generateJson(
  prompt: string,
  settings: BetterSimTrackerSettings,
): Promise<string> {
  const profileId = normalizeProfileId(settings);
  return generateViaSillyTavern(prompt, profileId);
}
