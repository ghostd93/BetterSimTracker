import type { BetterSimTrackerSettings, GenerateRequestMeta } from "./types";
import type { STContext } from "./types";
import { Generator } from "sillytavern-utils-lib";
import type { Message } from "sillytavern-utils-lib";
import { getContext, resolveConnectionProfileId } from "./settings";

interface GenerateResponse {
  content?: string;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
}

function normalizeGenerationError(raw: unknown): string {
  const messages: string[] = [];
  const seen = new WeakSet<object>();
  let statusCode: number | null = null;
  let statusText = "";

  const addMessage = (value: unknown): void => {
    const text = String(value ?? "").trim();
    if (!text || text === "[object Object]") return;
    if (!messages.includes(text)) messages.push(text);
  };

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 3 || value == null) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return;
      if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
        try {
          visit(JSON.parse(text), depth + 1);
        } catch {
          addMessage(text);
        }
        return;
      }
      addMessage(text);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      addMessage(value);
      return;
    }
    if (value instanceof Error) {
      addMessage(value.message);
      visit((value as Error & { cause?: unknown }).cause, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    const record = value as Record<string, unknown>;
    const statusRaw = record.status;
    if (typeof statusRaw === "number" && Number.isFinite(statusRaw)) statusCode = Math.round(statusRaw);
    if (typeof record.statusText === "string" && record.statusText.trim()) statusText = record.statusText.trim();

    addMessage(record.message);
    addMessage(record.error_description);
    addMessage(record.detail);
    addMessage(record.reason);
    addMessage(record.error);
    if (record.code != null && (typeof record.code === "string" || typeof record.code === "number")) {
      addMessage(`code ${record.code}`);
    }

    const nestedKeys = ["error", "data", "body", "response", "meta", "details", "cause"];
    for (const key of nestedKeys) {
      visit(record[key], depth + 1);
    }
  };

  visit(raw);

  if (statusCode != null) {
    const prefix = statusText ? `HTTP ${statusCode} ${statusText}` : `HTTP ${statusCode}`;
    const first = messages[0];
    return first ? `${prefix}: ${first}` : prefix;
  }
  if (messages.length) return messages[0];
  const fallback = String(raw ?? "").trim();
  return fallback && fallback !== "[object Object]" ? fallback : "Generation failed.";
}

function extractContent(payload: GenerateResponse): string {
  if (typeof payload.content === "string") return payload.content;
  const first = payload.choices?.[0];
  return first?.message?.content ?? first?.text ?? "";
}

const generator = new Generator();
const activeAbortControllers = new Set<AbortController>();

function extractResponseMeta(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  const keys = ["model", "provider", "endpoint", "url", "name", "profile", "profileId", "id"];
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      meta[key] = value;
    }
  }
  meta.responseKeys = Object.keys(record).slice(0, 20);
  return meta;
}

function extractContentFromData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
  }
  return extractContent(data as GenerateResponse);
}

type TokenLimits = {
  maxTokens: number;
  truncationLength?: number;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function clampTokens(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return 300;
  return Math.max(1, Math.min(100000, rounded));
}

function extractTokenLimitsFromObject(obj: Record<string, unknown> | null): Partial<TokenLimits> {
  if (!obj) return {};
  const maxTokenKeys = ["max_new_tokens", "max_tokens", "maxTokens", "openai_max_tokens", "max_length", "genamt"];
  const truncKeys = ["truncation_length", "openai_max_context", "max_context", "context_length", "max_context_length"];
  let maxTokens: number | undefined;
  let truncationLength: number | undefined;

  for (const key of maxTokenKeys) {
    const value = asNumber(obj[key]);
    if (value != null && value > 0) {
      maxTokens = clampTokens(value);
      break;
    }
  }
  for (const key of truncKeys) {
    const value = asNumber(obj[key]);
    if (value != null && value > 0) {
      truncationLength = clampTokens(value);
      break;
    }
  }

  return { maxTokens, truncationLength };
}

function profileIdOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = String(
    obj.id ??
      obj.profileId ??
      obj.value ??
      obj.profile ??
      "",
  ).trim();
  return id || null;
}

function collectProfiles(context: STContext | null): Record<string, unknown>[] {
  const buckets: unknown[] = [];
  const extSettings = context?.extensionSettings as Record<string, unknown> | undefined;
  const extConn = extSettings?.connectionManager as Record<string, unknown> | undefined;
  buckets.push(extConn?.profiles);

  const cc = context?.chatCompletionSettings as Record<string, unknown> | undefined;
  if (cc) buckets.push(cc.profiles, cc.profileList, cc.connections);

  const globalObj = globalThis as Record<string, unknown>;
  const globalExt = globalObj.extension_settings as Record<string, unknown> | undefined;
  const globalConn = globalExt?.connectionManager as Record<string, unknown> | undefined;
  buckets.push(
    globalConn?.profiles,
    globalObj.chat_completion_profiles,
    globalObj.chatCompletionProfiles,
    (globalObj.power_user as Record<string, unknown> | undefined)?.chat_completion_profiles,
    (globalObj.power_user as Record<string, unknown> | undefined)?.chatCompletionProfiles,
  );

  const out: Record<string, unknown>[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (item && typeof item === "object") out.push(item as Record<string, unknown>);
    }
  }
  return out;
}

function resolveProfileLimits(
  profileId: string,
  context: STContext | null,
  settings: BetterSimTrackerSettings,
): TokenLimits {
  const fallbackMax = 300;
  const profiles = collectProfiles(context);
  let profile: Record<string, unknown> | null = null;
  for (const candidate of profiles) {
    if (profileIdOf(candidate) === profileId) {
      profile = candidate;
      break;
    }
  }

  const fromProfile = extractTokenLimitsFromObject(profile);
  const overrideMax = Number(settings.maxTokensOverride ?? 0);
  const overrideTrunc = Number(settings.truncationLengthOverride ?? 0);

  const maxTokens = (overrideMax > 0 ? clampTokens(overrideMax) : undefined) ?? fromProfile.maxTokens ?? (() => {
    const presetName = String(profile?.preset ?? "").trim();
    const presetManager = context?.getPresetManager?.(typeof profile?.api === "string" ? (profile.api as string) : undefined);
    const preset = presetName ? presetManager?.getCompletionPresetByName(presetName) : undefined;
    const fromPreset = extractTokenLimitsFromObject(preset as Record<string, unknown> | null);
    if (fromPreset.maxTokens) return fromPreset.maxTokens;

    const mode = String(profile?.mode ?? profile?.type ?? "").toLowerCase();
    if (mode.includes("tc") || mode.includes("text")) {
      const tc = context?.textCompletionSettings as Record<string, unknown> | undefined;
      const fromTc = extractTokenLimitsFromObject(tc ?? null);
      if (fromTc.maxTokens) return fromTc.maxTokens;
      const maxLength = asNumber(tc?.max_length);
      if (maxLength && maxLength > 0) return clampTokens(maxLength);
    }

    const cc = context?.chatCompletionSettings as Record<string, unknown> | undefined;
    const fromCc = extractTokenLimitsFromObject(cc ?? null);
    if (fromCc.maxTokens) return fromCc.maxTokens;
    const openaiMax = asNumber(cc?.openai_max_tokens);
    if (openaiMax && openaiMax > 0) return clampTokens(openaiMax);

    return fallbackMax;
  })();

  const truncationLength =
    (overrideTrunc > 0 ? clampTokens(overrideTrunc) : undefined) ??
    fromProfile.truncationLength ??
    (() => {
      const presetName = String(profile?.preset ?? "").trim();
      const presetManager = context?.getPresetManager?.(typeof profile?.api === "string" ? (profile.api as string) : undefined);
      const preset = presetName ? presetManager?.getCompletionPresetByName(presetName) : undefined;
      const fromPreset = extractTokenLimitsFromObject(preset as Record<string, unknown> | null);
      if (fromPreset.truncationLength) return fromPreset.truncationLength;

      const mode = String(profile?.mode ?? profile?.type ?? "").toLowerCase();
      if (mode.includes("tc") || mode.includes("text")) {
        const tc = context?.textCompletionSettings as Record<string, unknown> | undefined;
        const fromTc = extractTokenLimitsFromObject(tc ?? null);
        if (fromTc.truncationLength) return fromTc.truncationLength;
      }

      const cc = context?.chatCompletionSettings as Record<string, unknown> | undefined;
      const fromCc = extractTokenLimitsFromObject(cc ?? null);
      if (fromCc.truncationLength) return fromCc.truncationLength;
      const openaiContext = asNumber(cc?.openai_max_context);
      if (openaiContext && openaiContext > 0) return clampTokens(openaiContext);

      return undefined;
    })();

  return { maxTokens, truncationLength };
}

function isProfileMissingError(error: unknown): boolean {
  const message = String(
    error instanceof Error
      ? error.message
      : (error && typeof error === "object" ? (error as Record<string, unknown>).message : error) ?? "",
  ).toLowerCase();
  return message.includes("profile not found") || message.includes("connection manager is not available");
}

function hasExplicitConnectionProfile(settings: BetterSimTrackerSettings): boolean {
  const value = String(settings.connectionProfile ?? "").trim();
  return Boolean(value && value.toLowerCase() !== "default");
}

async function generateViaGenerator(prompt: string, profileId: string, limits: TokenLimits): Promise<{ text: string; meta: GenerateRequestMeta }> {
  const messages: Message[] = [{ role: "user", content: prompt }];
  const promptChars = prompt.length;
  const maxTokens = limits.maxTokens;
  const startedAt = Date.now();
  const overridePayload = limits.truncationLength
    ? { truncation_length: limits.truncationLength, max_new_tokens: maxTokens, max_tokens: maxTokens }
    : { max_new_tokens: maxTokens, max_tokens: maxTokens };

  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    activeAbortControllers.add(abortController);
    abortController.signal.addEventListener("abort", () => {
      activeAbortControllers.delete(abortController);
    });
    generator.generateRequest(
      {
        profileId,
        prompt: messages,
        maxTokens,
        custom: { signal: abortController.signal },
        overridePayload
      },
      {
        abortController,
        onFinish: (_requestId: string, data: unknown, error: unknown) => {
          activeAbortControllers.delete(abortController);
          const durationMs = Date.now() - startedAt;
          const baseMeta: GenerateRequestMeta = {
            profileId,
            promptChars,
            maxTokens,
            truncationLength: limits.truncationLength,
            requestId: _requestId,
            durationMs,
            outputChars: 0,
            responseMeta: extractResponseMeta(data),
            timestamp: Date.now()
          };
          if (error) {
            const normalizedError = normalizeGenerationError(error);
            if (abortController.signal.aborted) {
              reject(Object.assign(new DOMException("Request aborted by user", "AbortError"), { meta: { ...baseMeta, error: normalizedError } }));
              return;
            }
            reject(Object.assign(new Error(normalizedError), { meta: { ...baseMeta, error: normalizedError } }));
            return;
          }
          if (!data) {
            reject(Object.assign(new DOMException("Request aborted by user", "AbortError"), { meta: baseMeta }));
            return;
          }
          const output = extractContentFromData(data).trim();
          if (!output) {
            reject(Object.assign(new Error("Generator returned empty output"), { meta: baseMeta }));
            return;
          }
          resolve({ text: output, meta: { ...baseMeta, outputChars: output.length } });
        }
      }
    );
  });
}

async function generateViaActiveRuntime(
  prompt: string,
  limits: TokenLimits,
  context: STContext,
): Promise<{ text: string; meta: GenerateRequestMeta }> {
  const promptChars = prompt.length;
  const maxTokens = limits.maxTokens;
  const startedAt = Date.now();
  const abortController = new AbortController();
  activeAbortControllers.add(abortController);
  try {
    let data: unknown;
    const mainApi = String(context.mainApi ?? "").trim();
    if (mainApi === "openai") {
      const chatSettings = context.chatCompletionSettings as Record<string, unknown> | undefined;
      const source = String(chatSettings?.chat_completion_source ?? "").trim();
      if (!source) {
        throw new Error("Active chat completion source is not configured.");
      }
      const requestData: Record<string, unknown> = {
        stream: false,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        chat_completion_source: source,
      };
      if (limits.truncationLength) {
        requestData.truncation_length = limits.truncationLength;
      }
      data = await context.ChatCompletionService?.processRequest?.(requestData, {}, true, abortController.signal);
    } else if (mainApi === "textgenerationwebui") {
      const textSettings = context.textCompletionSettings as Record<string, unknown> | undefined;
      const apiType = String(textSettings?.type ?? "").trim();
      if (!apiType) {
        throw new Error("Active text completion API type is not configured.");
      }
      const requestData: Record<string, unknown> = {
        stream: false,
        prompt,
        max_tokens: maxTokens,
        api_type: apiType,
      };
      const server = context.getTextGenServer?.(apiType);
      if (server) {
        requestData.api_server = server;
      }
      if (limits.truncationLength) {
        requestData.truncation_length = limits.truncationLength;
      }
      data = await context.TextCompletionService?.processRequest?.(requestData, {}, true, abortController.signal);
    } else {
      throw new Error(`Unsupported active API for profile-less extraction: ${mainApi || "unknown"}.`);
    }

    const output = extractContentFromData(data).trim();
    if (!output) {
      throw new Error("Active runtime request returned empty output");
    }

    return {
      text: output,
      meta: {
        profileId: "__active_runtime__",
        promptChars,
        maxTokens,
        truncationLength: limits.truncationLength,
        durationMs: Date.now() - startedAt,
        outputChars: output.length,
        responseMeta: {
          mode: "active_runtime_fallback",
          mainApi,
        },
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    const normalizedError = normalizeGenerationError(error);
    if (abortController.signal.aborted) {
      throw Object.assign(new DOMException("Request aborted by user", "AbortError"), {
        meta: {
          profileId: "__active_runtime__",
          promptChars,
          maxTokens,
          truncationLength: limits.truncationLength,
          durationMs: Date.now() - startedAt,
          outputChars: 0,
          timestamp: Date.now(),
          error: normalizedError,
        } satisfies GenerateRequestMeta,
      });
    }
    throw Object.assign(new Error(normalizedError), {
      meta: {
        profileId: "__active_runtime__",
        promptChars,
        maxTokens,
        truncationLength: limits.truncationLength,
        durationMs: Date.now() - startedAt,
        outputChars: 0,
        timestamp: Date.now(),
        error: normalizedError,
      } satisfies GenerateRequestMeta,
    });
  } finally {
    activeAbortControllers.delete(abortController);
  }
}

export async function generateJson(
  prompt: string,
  settings: BetterSimTrackerSettings,
): Promise<{ text: string; meta: GenerateRequestMeta }> {
  const context = getContext();
  const profileId = resolveConnectionProfileId(settings, context);
  const profileLookupId = profileId ?? "__active_runtime__";
  const limits = resolveProfileLimits(profileLookupId, context, settings);

  if (!context) {
    throw new Error("SillyTavern context is unavailable.");
  }

  if (profileId) {
    try {
      return await generateViaGenerator(prompt, profileId, limits);
    } catch (error) {
      if (hasExplicitConnectionProfile(settings) || !isProfileMissingError(error)) {
        throw error;
      }
      return generateViaActiveRuntime(prompt, limits, context);
    }
  }

  return generateViaActiveRuntime(prompt, limits, context);
}

export function cancelActiveGenerations(): number {
  const controllers = Array.from(activeAbortControllers);
  controllers.forEach(controller => controller.abort());
  activeAbortControllers.clear();
  return controllers.length;
}
