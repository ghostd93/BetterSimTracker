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

  const targets: Array<{ obj: Record<string, unknown>; key: string; prev: unknown; had: boolean }> = [];
  const addTarget = (obj: Record<string, unknown> | undefined, key: string, value: string | undefined): void => {
    if (!obj || value === undefined) return;
    const had = Object.prototype.hasOwnProperty.call(obj, key);
    targets.push({ obj, key, prev: obj[key], had });
    obj[key] = value;
  };

  if (profileId) {
    try {
      const context = SillyTavern.getContext();
      const ctxConn = (context.extensionSettings as Record<string, unknown> | undefined)?.connectionManager as Record<string, unknown> | undefined;
      addTarget(ctxConn, "selectedProfile", profileId);
      addTarget(ctxConn, "selected_profile", profileId);

      const globalExt = (globalThis as Record<string, unknown>).extension_settings as Record<string, unknown> | undefined;
      const globalConn = globalExt?.connectionManager as Record<string, unknown> | undefined;
      addTarget(globalConn, "selectedProfile", profileId);
      addTarget(globalConn, "selected_profile", profileId);

      const moduleExt = (module as Record<string, unknown>).extension_settings as Record<string, unknown> | undefined;
      const moduleConn = moduleExt?.connectionManager as Record<string, unknown> | undefined;
      addTarget(moduleConn, "selectedProfile", profileId);
      addTarget(moduleConn, "selected_profile", profileId);
    } catch {
      // ignore profile forcing failures
    }
  }

  let text = "";
  try {
    text = await quietFn({
      quietPrompt: prompt,
      responseLength: 300,
      removeReasoning: true,
      profileId,
      profile_id: profileId,
      connectionProfile: profileId
    });
  } finally {
    for (const target of targets.reverse()) {
      if (target.had) {
        target.obj[target.key] = target.prev;
      } else {
        delete target.obj[target.key];
      }
    }
  }

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
