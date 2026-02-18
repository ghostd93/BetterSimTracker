import type { BetterSimTrackerSettings } from "./types";

interface GenerateResponse {
  content?: string;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
}

function getHeaders(): Record<string, string> {
  const token = SillyTavern.getContext().csrf_token ?? "";
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": token
  };
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

async function requestGenerate(body: Record<string, unknown>): Promise<string> {
  const response = await fetch("/api/backends/chat-completions/generate", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload: GenerateResponse | null = null;
  try {
    payload = JSON.parse(text) as GenerateResponse;
  } catch {
    payload = null;
  }

  const content = payload ? extractContent(payload).trim() : "";
  const explicitError = Boolean((payload as Record<string, unknown> | null)?.error);
  const isFailure = !response.ok || explicitError || !content;

  if (isFailure) {
    throw new Error(`Generation request failed (${response.status}): ${text}`);
  }

  return content;
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
  try {
    // Prefer ST's internal quiet generation pipeline for backend compatibility.
    return await generateViaSillyTavern(prompt, profileId);
  } catch {
    // Fallback to direct fetch attempts below.
  }

  const attempts: Array<Record<string, unknown>> = [
    {
      prompt,
      profileId,
      profile_id: profileId,
      profile: profileId,
      connectionProfile: profileId,
      temperature: 0.3,
      max_tokens: 300,
      no_cache: true,
      quiet_to_console: true
    },
    {
      messages: [{ role: "user", content: prompt }],
      profileId,
      profile_id: profileId,
      profile: profileId,
      connectionProfile: profileId,
      temperature: 0.3,
      max_tokens: 300,
      no_cache: true,
      quiet_to_console: true
    },
    {
      prompt,
      temperature: 0.3,
      max_tokens: 300,
      no_cache: true,
      quiet_to_console: true
    },
    {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
      no_cache: true,
      quiet_to_console: true
    }
  ];

  const errors: string[] = [];
  for (const body of attempts) {
    try {
      return await requestGenerate(body);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(" | "));
}
