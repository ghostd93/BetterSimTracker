import { STAT_KEYS } from "./constants";
import { generateJson, getGenerationCancelToken } from "./generator";
import { parseUnifiedDeltaResponse } from "./parse";
import {
  DEFAULT_REPAIR_LAST_THOUGHT_TEMPLATE,
  DEFAULT_REPAIR_MOOD_TEMPLATE,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_STRICT_RETRY_TEMPLATE,
  buildSequentialPrompt,
  buildUnifiedPrompt,
  moodOptions
} from "./prompts";
import type { BetterSimTrackerSettings, DeltaDebugRecord, GenerateRequestMeta, StatKey, Statistics, TrackerData } from "./types";

function enabledStats(settings: BetterSimTrackerSettings): StatKey[] {
  const selected: StatKey[] = [];
  if (settings.trackAffection) selected.push("affection");
  if (settings.trackTrust) selected.push("trust");
  if (settings.trackDesire) selected.push("desire");
  if (settings.trackConnection) selected.push("connection");
  if (settings.trackMood) selected.push("mood");
  if (settings.trackLastThought) selected.push("lastThought");
  return selected;
}

function emptyStatistics(): Statistics {
  return {
    affection: {},
    trust: {},
    desire: {},
    connection: {},
    mood: {},
    lastThought: {}
  };
}

function hasAnyValues(values: Record<string, unknown>): boolean {
  return Object.keys(values).length > 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasParsedValues(parsed: ReturnType<typeof parseUnifiedDeltaResponse>): boolean {
  return (
    hasAnyValues(parsed.confidence) ||
    hasAnyValues(parsed.deltas.affection) ||
    hasAnyValues(parsed.deltas.trust) ||
    hasAnyValues(parsed.deltas.desire) ||
    hasAnyValues(parsed.deltas.connection) ||
    hasAnyValues(parsed.mood) ||
    hasAnyValues(parsed.lastThought)
  );
}

function hasValuesForRequestedStats(
  parsed: ReturnType<typeof parseUnifiedDeltaResponse>,
  stats: StatKey[],
): boolean {
  for (const stat of stats) {
    if (stat === "affection" && hasAnyValues(parsed.deltas.affection)) return true;
    if (stat === "trust" && hasAnyValues(parsed.deltas.trust)) return true;
    if (stat === "desire" && hasAnyValues(parsed.deltas.desire)) return true;
    if (stat === "connection" && hasAnyValues(parsed.deltas.connection)) return true;
    if (stat === "mood" && hasAnyValues(parsed.mood)) return true;
    if (stat === "lastThought" && hasAnyValues(parsed.lastThought)) return true;
  }
  return false;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

function buildStrictJsonRetryPrompt(basePrompt: string): string {
  return renderTemplate(DEFAULT_STRICT_RETRY_TEMPLATE, { basePrompt });
}

function buildStatRepairRetryPrompt(basePrompt: string, stat: StatKey): string {
  if (stat === "mood") {
    return renderTemplate(DEFAULT_REPAIR_MOOD_TEMPLATE, { basePrompt, moodOptions: moodOptions.join(", ") });
  }
  if (stat === "lastThought") {
    return renderTemplate(DEFAULT_REPAIR_LAST_THOUGHT_TEMPLATE, { basePrompt });
  }
  return buildStrictJsonRetryPrompt(basePrompt);
}

function countMapValues(values: Record<string, unknown>): number {
  return Object.keys(values).length;
}

export async function extractStatisticsParallel(input: {
  settings: BetterSimTrackerSettings;
  userName: string;
  activeCharacters: string[];
  contextText: string;
  previousStatistics: Statistics | null;
  history: TrackerData[];
  onProgress?: (done: number, total: number, label?: string) => void;
}): Promise<{ statistics: Statistics; debug: DeltaDebugRecord | null }> {
  const { settings, userName, activeCharacters, contextText, previousStatistics, history, onProgress } = input;
  const stats = enabledStats(settings);
  const output = emptyStatistics();
  let debugRecord: DeltaDebugRecord | null = null;
  let cancelled = false;
  const cancelToken = getGenerationCancelToken();

  const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === "AbortError";
  const checkCancelled = (): void => {
    if (cancelled || cancelToken !== getGenerationCancelToken()) {
      cancelled = true;
      throw new DOMException("Request aborted by user", "AbortError");
    }
  };

  if (!stats.length || !activeCharacters.length) return { statistics: output, debug: debugRecord };

  const total = 3;
  onProgress?.(0, settings.sequentialExtraction ? Math.max(1, stats.length * 3) : total, "Preparing context");

  try {
    const applyDelta = (prev: number, delta: number, confidence: number): number => {
      const conf = Math.max(0, Math.min(1, confidence));
      const damp = Math.max(0, Math.min(1, settings.confidenceDampening));
      const scale = (1 - damp) + conf * damp;
      const limit = Math.max(1, Math.round(settings.maxDeltaPerTurn || 15));
      const bounded = Math.max(-limit, Math.min(limit, delta));
      const scaledDelta = Math.round(bounded * scale);
      return clamp(prev + scaledDelta);
    };

    const applied = {
      affection: {} as Record<string, number>,
      trust: {} as Record<string, number>,
      desire: {} as Record<string, number>,
      connection: {} as Record<string, number>,
      mood: {} as Record<string, string>,
      lastThought: {} as Record<string, string>,
    };
    const moodFallbackApplied = new Set<string>();
    const parsed = {
      confidence: {} as Record<string, number>,
      deltas: {
        affection: {} as Record<string, number>,
        trust: {} as Record<string, number>,
        desire: {} as Record<string, number>,
        connection: {} as Record<string, number>,
      },
      mood: {} as Record<string, string>,
      lastThought: {} as Record<string, string>,
    };

    const applyParsedForStat = (stat: StatKey, parsedOne: ReturnType<typeof parseUnifiedDeltaResponse>): void => {
      for (const [name, value] of Object.entries(parsedOne.confidence)) {
        parsed.confidence[name] = value;
      }
      for (const name of activeCharacters) {
        const confidence = parsedOne.confidence[name] ?? 0.8;
        if (stat === "affection" && parsedOne.deltas.affection[name] !== undefined) {
          parsed.deltas.affection[name] = parsedOne.deltas.affection[name];
          const prevAffection = Number(previousStatistics?.affection?.[name] ?? settings.defaultAffection);
          const next = applyDelta(prevAffection, parsedOne.deltas.affection[name], confidence);
          output.affection[name] = next;
          applied.affection[name] = next;
        }
        if (stat === "trust" && parsedOne.deltas.trust[name] !== undefined) {
          parsed.deltas.trust[name] = parsedOne.deltas.trust[name];
          const prevTrust = Number(previousStatistics?.trust?.[name] ?? settings.defaultTrust);
          const next = applyDelta(prevTrust, parsedOne.deltas.trust[name], confidence);
          output.trust[name] = next;
          applied.trust[name] = next;
        }
        if (stat === "desire" && parsedOne.deltas.desire[name] !== undefined) {
          parsed.deltas.desire[name] = parsedOne.deltas.desire[name];
          const prevDesire = Number(previousStatistics?.desire?.[name] ?? settings.defaultDesire);
          const next = applyDelta(prevDesire, parsedOne.deltas.desire[name], confidence);
          output.desire[name] = next;
          applied.desire[name] = next;
        }
        if (stat === "connection" && parsedOne.deltas.connection[name] !== undefined) {
          parsed.deltas.connection[name] = parsedOne.deltas.connection[name];
          const prevConnection = Number(previousStatistics?.connection?.[name] ?? settings.defaultConnection);
          const next = applyDelta(prevConnection, parsedOne.deltas.connection[name], confidence);
          output.connection[name] = next;
          applied.connection[name] = next;
        }
        if (stat === "mood" && parsedOne.mood[name] !== undefined) {
          parsed.mood[name] = parsedOne.mood[name];
          const stick = Math.max(0, Math.min(1, settings.moodStickiness));
          const prevMood = String(previousStatistics?.mood?.[name] ?? settings.defaultMood);
          const keepPrev = confidence < stick;
          output.mood[name] = keepPrev ? prevMood : parsedOne.mood[name];
          applied.mood[name] = output.mood[name] as string;
        }
        if (stat === "lastThought" && parsedOne.lastThought[name] !== undefined) {
          parsed.lastThought[name] = parsedOne.lastThought[name];
          output.lastThought[name] = parsedOne.lastThought[name];
          applied.lastThought[name] = parsedOne.lastThought[name];
        }
      }
      if (stat === "mood") {
        for (const name of activeCharacters) {
          if (output.mood[name] !== undefined) continue;
          const prevMood = String(previousStatistics?.mood?.[name] ?? settings.defaultMood);
          output.mood[name] = prevMood;
          applied.mood[name] = prevMood;
          moodFallbackApplied.add(name);
        }
      }
    };

    let attempts = 0;
    let requestSeq = 0;
    let retryUsed = false;
    let firstParseHadValues = true;
    let rawOutputAggregate = "";
    let promptAggregate = "";
    const requestMetas: Array<GenerateRequestMeta & { statList: StatKey[]; attempt: number; retryType: string }> = [];
    let progressDone = 0;
    const progressTotal = settings.sequentialExtraction ? Math.max(1, stats.length * 3) : total;
    const tickProgress = (label?: string): void => {
      progressDone = Math.min(progressTotal, progressDone + 1);
      onProgress?.(progressDone, progressTotal, label);
    };

    const getSequentialTemplate = (stat: StatKey): string => {
      if (stat === "affection") return settings.promptTemplateSequentialAffection || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection;
      if (stat === "trust") return settings.promptTemplateSequentialTrust || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust;
      if (stat === "desire") return settings.promptTemplateSequentialDesire || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire;
      if (stat === "connection") return settings.promptTemplateSequentialConnection || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection;
      if (stat === "mood") return settings.promptTemplateSequentialMood || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood;
      return settings.promptTemplateSequentialLastThought || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought;
    };

    const runOneStat = async (statList: StatKey[]): Promise<{ prompt: string; raw: string; parsedOne: ReturnType<typeof parseUnifiedDeltaResponse> }> => {
      checkCancelled();
      const statLabel = statList.length === 1 ? statList[0] : "stats";
      const prompt = settings.sequentialExtraction && statList.length === 1
        ? buildSequentialPrompt(
            statList[0],
            userName,
            activeCharacters,
            contextText,
            previousStatistics,
            history,
            settings.maxDeltaPerTurn,
            getSequentialTemplate(statList[0]),
          )
        : buildUnifiedPrompt(
            statList,
            userName,
            activeCharacters,
            contextText,
            previousStatistics,
            history,
            settings.maxDeltaPerTurn,
            settings.promptTemplateUnified,
          );
      tickProgress(`Requesting ${statLabel}`);
      attempts += 1;
      requestSeq += 1;
      checkCancelled();
      let rawResponse = await generateJson(prompt, settings);
      requestMetas.push({ ...rawResponse.meta, statList, attempt: requestSeq, retryType: "initial" });
      let raw = rawResponse.text;
      tickProgress(`Parsing ${statLabel}`);
      let parsedOne = parseUnifiedDeltaResponse(raw, activeCharacters, statList, settings.maxDeltaPerTurn);
      const firstHasValues = hasParsedValues(parsedOne);
      firstParseHadValues = firstParseHadValues && firstHasValues;
      let retriesLeft = Math.max(0, Math.min(4, settings.maxRetriesPerStat));
      if (!hasValuesForRequestedStats(parsedOne, statList) && retriesLeft > 0 && settings.strictJsonRepair) {
        const retryPrompt = buildStrictJsonRetryPrompt(prompt);
        attempts += 1;
        requestSeq += 1;
        retryUsed = true;
        retriesLeft -= 1;
        checkCancelled();
        const retryResponse = await generateJson(retryPrompt, settings);
        requestMetas.push({ ...retryResponse.meta, statList, attempt: requestSeq, retryType: "strict" });
        const retryParsed = parseUnifiedDeltaResponse(retryResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedStats(retryParsed, statList)) {
          raw = retryResponse.text;
          parsedOne = retryParsed;
        }
      }
      if (
        statList.length === 1 &&
        !hasValuesForRequestedStats(parsedOne, statList) &&
        retriesLeft > 0 &&
        settings.strictJsonRepair
      ) {
        const repairPrompt = buildStatRepairRetryPrompt(prompt, statList[0]);
        attempts += 1;
        requestSeq += 1;
        retryUsed = true;
        retriesLeft -= 1;
        checkCancelled();
        const repairResponse = await generateJson(repairPrompt, settings);
        requestMetas.push({ ...repairResponse.meta, statList, attempt: requestSeq, retryType: "repair" });
        const repairParsed = parseUnifiedDeltaResponse(repairResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedStats(repairParsed, statList)) {
          raw = repairResponse.text;
          parsedOne = repairParsed;
        }
      }
      while (!hasValuesForRequestedStats(parsedOne, statList) && retriesLeft > 0 && settings.strictJsonRepair) {
        const strictPrompt = buildStrictJsonRetryPrompt(prompt);
        attempts += 1;
        requestSeq += 1;
        retryUsed = true;
        retriesLeft -= 1;
        checkCancelled();
        const strictResponse = await generateJson(strictPrompt, settings);
        requestMetas.push({ ...strictResponse.meta, statList, attempt: requestSeq, retryType: "strict_loop" });
        const strictParsed = parseUnifiedDeltaResponse(strictResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedStats(strictParsed, statList)) {
          raw = strictResponse.text;
          parsedOne = strictParsed;
          break;
        }
      }
      tickProgress(`Applying ${statLabel}`);
      return { prompt, raw, parsedOne };
    };

    if (!settings.sequentialExtraction) {
      const one = await runOneStat(stats);
      rawOutputAggregate = one.raw;
      promptAggregate = one.prompt;
      for (const stat of stats) {
        applyParsedForStat(stat, one.parsedOne);
      }
    } else {
      const queue = [...stats];
      const workers = Math.max(1, Math.min(settings.maxConcurrentCalls || 1, 8));
      const rawByStat: Array<{ stat: StatKey; raw: string }> = [];
      const promptByStat: Array<{ stat: StatKey; prompt: string }> = [];
      const worker = async (): Promise<void> => {
        while (queue.length) {
          checkCancelled();
          const stat = queue.shift();
          if (!stat) return;
          const one = await runOneStat([stat]);
          rawByStat.push({ stat, raw: one.raw });
          promptByStat.push({ stat, prompt: one.prompt });
          applyParsedForStat(stat, one.parsedOne);
        }
      };
      await Promise.all(Array.from({ length: Math.min(workers, stats.length) }, () => worker()));
      rawOutputAggregate = rawByStat.map(item => `--- ${item.stat} ---\n${item.raw}`).join("\n\n");
      promptAggregate = promptByStat.map(item => `--- ${item.stat} ---\n${item.prompt}`).join("\n\n");
    }

    debugRecord = {
      rawModelOutput: rawOutputAggregate,
      promptText: settings.includeContextInDiagnostics ? promptAggregate : undefined,
      contextText: settings.includeContextInDiagnostics ? contextText : undefined,
      parsed,
      applied,
      meta: {
        promptChars: promptAggregate.length,
        contextChars: contextText.length,
        historySnapshots: history.length,
        activeCharacters: [...activeCharacters],
        statsRequested: [...stats],
        attempts,
        extractionMode: settings.sequentialExtraction ? "sequential" : "unified",
        retryUsed,
        firstParseHadValues,
        rawLength: rawOutputAggregate.length,
        parsedCounts: {
          confidence: countMapValues(parsed.confidence),
          affection: countMapValues(parsed.deltas.affection),
          trust: countMapValues(parsed.deltas.trust),
          desire: countMapValues(parsed.deltas.desire),
          connection: countMapValues(parsed.deltas.connection),
          mood: countMapValues(parsed.mood),
          lastThought: countMapValues(parsed.lastThought)
        },
        appliedCounts: {
          affection: countMapValues(applied.affection),
          trust: countMapValues(applied.trust),
          desire: countMapValues(applied.desire),
          connection: countMapValues(applied.connection),
          mood: countMapValues(applied.mood),
          lastThought: countMapValues(applied.lastThought)
        },
        moodFallbackApplied: Array.from(moodFallbackApplied),
        requests: requestMetas
      }
    };
  } catch (error) {
    if (isAbortError(error)) {
      cancelled = true;
    } else {
      console.error("[BetterSimTracker] Unified extraction failed:", error);
    }
  } finally {
    const done = settings.sequentialExtraction ? Math.max(1, stats.length * 3) : 3;
    onProgress?.(done, done, "Finalizing");
  }

  if (cancelled) {
    throw new DOMException("Request aborted by user", "AbortError");
  }

  if (!settings.trackMood) {
    output.mood = Object.fromEntries(activeCharacters.map(name => [name, settings.defaultMood]));
  }

  for (const key of STAT_KEYS) {
    if (!output[key]) output[key] = {};
  }

  return { statistics: output, debug: debugRecord };
}
