import type { BetterSimTrackerSettings, GenerateRequestMeta } from "./types";
import { Generator } from "sillytavern-utils-lib";
import type { Message } from "sillytavern-utils-lib";

interface GenerateResponse {
  content?: string;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
}

function extractContent(payload: GenerateResponse): string {
  if (typeof payload.content === "string") return payload.content;
  const first = payload.choices?.[0];
  return first?.message?.content ?? first?.text ?? "";
}

const generator = new Generator();

function normalizeProfileId(settings: BetterSimTrackerSettings): string | undefined {
  const raw = settings.connectionProfile?.trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === "default") return undefined;
  return raw;
}

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

async function generateViaGenerator(prompt: string, profileId: string): Promise<{ text: string; meta: GenerateRequestMeta }> {
  const messages: Message[] = [{ role: "user", content: prompt }];
  const promptChars = prompt.length;
  const maxTokens = 300;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    generator.generateRequest(
      {
        profileId,
        prompt: messages,
        maxTokens,
        custom: { signal: abortController.signal }
      },
      {
        abortController,
        onFinish: (_requestId: string, data: unknown, error: unknown) => {
          const durationMs = Date.now() - startedAt;
          const baseMeta: GenerateRequestMeta = {
            profileId,
            promptChars,
            maxTokens,
            requestId: _requestId,
            durationMs,
            outputChars: 0,
            responseMeta: extractResponseMeta(data),
            timestamp: Date.now()
          };
          if (error) {
            reject(Object.assign(new Error(String(error)), { meta: { ...baseMeta, error: String(error) } }));
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

export async function generateJson(
  prompt: string,
  settings: BetterSimTrackerSettings,
): Promise<{ text: string; meta: GenerateRequestMeta }> {
  const profileId = normalizeProfileId(settings);
  if (!profileId) {
    throw new Error("Please select a connection profile in BetterSimTracker settings.");
  }
  return generateViaGenerator(prompt, profileId);
}
