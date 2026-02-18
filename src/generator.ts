import type { BetterSimTrackerSettings } from "./types";
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

function extractContentFromData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
  }
  return extractContent(data as GenerateResponse);
}

async function generateViaGenerator(prompt: string, profileId: string): Promise<string> {
  const messages: Message[] = [{ role: "user", content: prompt }];

  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    generator.generateRequest(
      {
        profileId,
        prompt: messages,
        maxTokens: 300,
        custom: { signal: abortController.signal }
      },
      {
        abortController,
        onFinish: (_requestId: string, data: unknown, error: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          if (!data) {
            reject(new DOMException("Request aborted by user", "AbortError"));
            return;
          }
          const output = extractContentFromData(data).trim();
          if (!output) {
            reject(new Error("Generator returned empty output"));
            return;
          }
          resolve(output);
        }
      }
    );
  });
}

export async function generateJson(
  prompt: string,
  settings: BetterSimTrackerSettings,
): Promise<string> {
  const profileId = normalizeProfileId(settings);
  if (!profileId) {
    throw new Error("Please select a connection profile in BetterSimTracker settings.");
  }
  return generateViaGenerator(prompt, profileId);
}
