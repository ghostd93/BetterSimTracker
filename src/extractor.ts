import { STAT_KEYS } from "./constants";
import { generateJson } from "./generator";
import { parseCustomDeltaResponse, parseUnifiedDeltaResponse } from "./parse";
import {
  DEFAULT_REPAIR_LAST_THOUGHT_TEMPLATE,
  DEFAULT_REPAIR_MOOD_TEMPLATE,
  DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_STRICT_RETRY_TEMPLATE,
  buildSequentialCustomNumericPrompt,
  buildSequentialPrompt,
  buildUnifiedPrompt,
  moodOptions
} from "./prompts";
import type {
  BetterSimTrackerSettings,
  CustomStatDefinition,
  CustomStatistics,
  DeltaDebugRecord,
  GenerateRequestMeta,
  StatKey,
  Statistics,
  TrackerData
} from "./types";

function enabledBuiltInAndTextStats(settings: BetterSimTrackerSettings): StatKey[] {
  const selected: StatKey[] = [];
  if (settings.trackAffection) selected.push("affection");
  if (settings.trackTrust) selected.push("trust");
  if (settings.trackDesire) selected.push("desire");
  if (settings.trackConnection) selected.push("connection");
  if (settings.trackMood) selected.push("mood");
  if (settings.trackLastThought) selected.push("lastThought");
  return selected;
}

function enabledCustomStats(settings: BetterSimTrackerSettings): CustomStatDefinition[] {
  if (!Array.isArray(settings.customStats)) return [];
  return settings.customStats.filter(def => Boolean(def.track));
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

function hasValuesForRequestedBuiltInAndTextStats(
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

function countMapValuesByStat(values: Record<string, Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, map] of Object.entries(values)) {
    out[key] = Object.keys(map ?? {}).length;
  }
  return out;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

export async function extractStatisticsParallel(input: {
  settings: BetterSimTrackerSettings;
  userName: string;
  activeCharacters: string[];
  contextText: string;
  previousStatistics: Statistics | null;
  previousCustomStatistics?: CustomStatistics | null;
  history: TrackerData[];
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number, label?: string) => void;
}): Promise<{ statistics: Statistics; customStatistics: CustomStatistics; debug: DeltaDebugRecord | null }> {
  const {
    settings,
    userName,
    activeCharacters,
    contextText,
    previousStatistics,
    previousCustomStatistics,
    history,
    onProgress,
  } = input;
  const builtInAndTextStats = enabledBuiltInAndTextStats(settings);
  const customStats = enabledCustomStats(settings);
  const output = emptyStatistics();
  const outputCustom: CustomStatistics = {};
  let debugRecord: DeltaDebugRecord | null = null;
  let cancelled = false;

  const isAbortError = (error: unknown): boolean => {
    if (error instanceof DOMException && error.name === "AbortError") return true;
    const raw = typeof error === "string"
      ? error
      : error && typeof error === "object"
        ? [
            String((error as Record<string, unknown>).name ?? ""),
            String((error as Record<string, unknown>).message ?? ""),
            String((((error as Record<string, unknown>).meta as Record<string, unknown> | undefined)?.error ?? "")),
          ].join(" ")
        : "";
    const normalized = raw.toLowerCase();
    return normalized.includes("abort") || normalized.includes("cancel");
  };
  const checkCancelled = (): void => {
    if (cancelled || input.isCancelled?.()) {
      cancelled = true;
      throw new DOMException("Request aborted by user", "AbortError");
    }
  };

  if ((!builtInAndTextStats.length && !customStats.length) || !activeCharacters.length) {
    return { statistics: output, customStatistics: outputCustom, debug: debugRecord };
  }

  const progressTotal = settings.sequentialExtraction
    ? Math.max(1, (builtInAndTextStats.length + customStats.length) * 3)
    : Math.max(1, (builtInAndTextStats.length ? 3 : 0) + customStats.length * 3);
  onProgress?.(0, progressTotal, "Preparing context");

  try {
    const applyDelta = (prev: number, delta: number, confidence: number, maxDeltaOverride?: number): number => {
      const conf = Math.max(0, Math.min(1, confidence));
      const damp = Math.max(0, Math.min(1, settings.confidenceDampening));
      const scale = (1 - damp) + conf * damp;
      const fallbackLimit = Math.max(1, Math.round(settings.maxDeltaPerTurn || 15));
      const limit = Math.max(1, Math.round(Number(maxDeltaOverride ?? fallbackLimit) || fallbackLimit));
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
      customStatistics: {} as Record<string, Record<string, number>>,
    };
    const moodFallbackApplied = new Set<string>();
    const parsed = {
      confidence: {} as Record<string, number>,
      deltas: {
        affection: {} as Record<string, number>,
        trust: {} as Record<string, number>,
        desire: {} as Record<string, number>,
        connection: {} as Record<string, number>,
        custom: {} as Record<string, Record<string, number>>,
      },
      mood: {} as Record<string, string>,
      lastThought: {} as Record<string, string>,
    };

    const applyParsedForBuiltInOrTextStat = (
      stat: StatKey,
      parsedOne: ReturnType<typeof parseUnifiedDeltaResponse>,
    ): void => {
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

    const applyParsedForCustomStat = (
      statDef: CustomStatDefinition,
      parsedOne: ReturnType<typeof parseCustomDeltaResponse>,
    ): void => {
      const statId = statDef.id;
      if (!parsed.deltas.custom[statId]) parsed.deltas.custom[statId] = {};
      if (!applied.customStatistics[statId]) applied.customStatistics[statId] = {};
      if (!outputCustom[statId]) outputCustom[statId] = {};
      for (const [name, value] of Object.entries(parsedOne.confidence)) {
        parsed.confidence[name] = value;
      }
      for (const name of activeCharacters) {
        const delta = parsedOne.delta[name];
        if (delta === undefined) continue;
        parsed.deltas.custom[statId][name] = delta;
        const confidence = parsedOne.confidence[name] ?? 0.8;
        const prevValue = Number(previousCustomStatistics?.[statId]?.[name] ?? statDef.defaultValue);
        const next = applyDelta(prevValue, delta, confidence, statDef.maxDeltaPerTurn);
        outputCustom[statId][name] = next;
        applied.customStatistics[statId][name] = next;
      }
    };

    let attempts = 0;
    let requestSeq = 0;
    let retryUsed = false;
    let firstParseHadValues = true;
    const rawBlocks: Array<{ label: string; raw: string }> = [];
    const promptBlocks: Array<{ label: string; prompt: string }> = [];
    const requestMetas: Array<GenerateRequestMeta & { statList: string[]; attempt: number; retryType: string }> = [];
    let progressDone = 0;
    const tickProgress = (label?: string): void => {
      progressDone = Math.min(progressTotal, progressDone + 1);
      onProgress?.(progressDone, progressTotal, label);
    };

    const callGenerate = async (
      prompt: string,
      statList: string[],
      retryType: string,
    ): Promise<{ text: string; meta: GenerateRequestMeta }> => {
      const retryDelaysMs = [350, 1200];
      let lastError: unknown = null;
      for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex += 1) {
        attempts += 1;
        requestSeq += 1;
        try {
          checkCancelled();
          const response = await generateJson(prompt, settings);
          checkCancelled();
          const type = attemptIndex === 0 ? retryType : `${retryType}_transport_retry_${attemptIndex}`;
          requestMetas.push({ ...response.meta, statList, attempt: requestSeq, retryType: type });
          return response;
        } catch (error) {
          if (isAbortError(error) || input.isCancelled?.()) {
            cancelled = true;
            throw new DOMException("Request aborted by user", "AbortError");
          }
          lastError = error;
          if (attemptIndex >= retryDelaysMs.length) {
            throw error;
          }
          // Some providers transiently reject immediate follow-up requests after main generation.
          await wait(retryDelaysMs[attemptIndex]);
          checkCancelled();
        }
      }
      throw (lastError ?? new Error("Generation failed"));
    };

    const getSequentialTemplate = (stat: StatKey): string => {
      if (stat === "affection") return settings.promptTemplateSequentialAffection || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection;
      if (stat === "trust") return settings.promptTemplateSequentialTrust || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust;
      if (stat === "desire") return settings.promptTemplateSequentialDesire || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire;
      if (stat === "connection") return settings.promptTemplateSequentialConnection || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection;
      if (stat === "mood") return settings.promptTemplateSequentialMood || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood;
      return settings.promptTemplateSequentialLastThought || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought;
    };

    const runOneBuiltInOrTextRequest = async (
      statList: StatKey[],
    ): Promise<{ prompt: string; raw: string; parsedOne: ReturnType<typeof parseUnifiedDeltaResponse> }> => {
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
      let rawResponse = await callGenerate(prompt, statList, "initial");
      checkCancelled();
      let raw = rawResponse.text;
      tickProgress(`Parsing ${statLabel}`);
      let parsedOne = parseUnifiedDeltaResponse(raw, activeCharacters, statList, settings.maxDeltaPerTurn);
      const firstHasValues = hasParsedValues(parsedOne);
      firstParseHadValues = firstParseHadValues && firstHasValues;
      let retriesLeft = Math.max(0, Math.min(4, settings.maxRetriesPerStat));
      if (!hasValuesForRequestedBuiltInAndTextStats(parsedOne, statList) && retriesLeft > 0 && settings.strictJsonRepair) {
        const retryPrompt = buildStrictJsonRetryPrompt(prompt);
        retryUsed = true;
        retriesLeft -= 1;
        const retryResponse = await callGenerate(retryPrompt, statList, "strict");
        checkCancelled();
        const retryParsed = parseUnifiedDeltaResponse(retryResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedBuiltInAndTextStats(retryParsed, statList)) {
          raw = retryResponse.text;
          parsedOne = retryParsed;
        }
      }
      if (
        statList.length === 1 &&
        !hasValuesForRequestedBuiltInAndTextStats(parsedOne, statList) &&
        retriesLeft > 0 &&
        settings.strictJsonRepair
      ) {
        const repairPrompt = buildStatRepairRetryPrompt(prompt, statList[0]);
        retryUsed = true;
        retriesLeft -= 1;
        const repairResponse = await callGenerate(repairPrompt, statList, "repair");
        checkCancelled();
        const repairParsed = parseUnifiedDeltaResponse(repairResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedBuiltInAndTextStats(repairParsed, statList)) {
          raw = repairResponse.text;
          parsedOne = repairParsed;
        }
      }
      while (!hasValuesForRequestedBuiltInAndTextStats(parsedOne, statList) && retriesLeft > 0 && settings.strictJsonRepair) {
        const strictPrompt = buildStrictJsonRetryPrompt(prompt);
        retryUsed = true;
        retriesLeft -= 1;
        const strictResponse = await callGenerate(strictPrompt, statList, "strict_loop");
        checkCancelled();
        const strictParsed = parseUnifiedDeltaResponse(strictResponse.text, activeCharacters, statList, settings.maxDeltaPerTurn);
        if (hasValuesForRequestedBuiltInAndTextStats(strictParsed, statList)) {
          raw = strictResponse.text;
          parsedOne = strictParsed;
          break;
        }
      }
      tickProgress(`Applying ${statLabel}`);
      return { prompt, raw, parsedOne };
    };

    const runOneCustomRequest = async (
      statDef: CustomStatDefinition,
    ): Promise<{ prompt: string; raw: string; parsedOne: ReturnType<typeof parseCustomDeltaResponse> }> => {
      checkCancelled();
      const label = statDef.label || statDef.id;
      const statId = statDef.id;
      const prompt = buildSequentialCustomNumericPrompt({
        statId,
        statLabel: label,
        statDescription: statDef.description,
        statDefault: statDef.defaultValue,
        maxDeltaPerTurn: statDef.maxDeltaPerTurn ?? settings.maxDeltaPerTurn,
        userName,
        characters: activeCharacters,
        contextText,
        current: previousStatistics,
        currentCustom: previousCustomStatistics ?? {},
        history,
        template: statDef.sequentialPromptTemplate
          || settings.promptTemplateSequentialCustomNumeric
          || DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
      });
      tickProgress(`Requesting ${label}`);
      let rawResponse = await callGenerate(prompt, [statId], "initial");
      checkCancelled();
      let raw = rawResponse.text;
      tickProgress(`Parsing ${label}`);
      let parsedOne = parseCustomDeltaResponse(raw, activeCharacters, statId, statDef.maxDeltaPerTurn ?? settings.maxDeltaPerTurn);
      const firstHasValues = hasAnyValues(parsedOne.delta);
      firstParseHadValues = firstParseHadValues && firstHasValues;
      let retriesLeft = Math.max(0, Math.min(4, settings.maxRetriesPerStat));
      while (!hasAnyValues(parsedOne.delta) && retriesLeft > 0 && settings.strictJsonRepair) {
        const strictPrompt = buildStrictJsonRetryPrompt(prompt);
        retryUsed = true;
        retriesLeft -= 1;
        const strictResponse = await callGenerate(strictPrompt, [statId], "strict_loop");
        checkCancelled();
        const strictParsed = parseCustomDeltaResponse(
          strictResponse.text,
          activeCharacters,
          statId,
          statDef.maxDeltaPerTurn ?? settings.maxDeltaPerTurn,
        );
        if (hasAnyValues(strictParsed.delta)) {
          raw = strictResponse.text;
          parsedOne = strictParsed;
          break;
        }
      }
      tickProgress(`Applying ${label}`);
      return { prompt, raw, parsedOne };
    };

    if (!settings.sequentialExtraction) {
      if (builtInAndTextStats.length) {
        const one = await runOneBuiltInOrTextRequest(builtInAndTextStats);
        checkCancelled();
        rawBlocks.push({ label: "builtins", raw: one.raw });
        promptBlocks.push({ label: "builtins", prompt: one.prompt });
        for (const stat of builtInAndTextStats) {
          applyParsedForBuiltInOrTextStat(stat, one.parsedOne);
        }
      }

      const customQueue = [...customStats];
      const customWorkers = Math.max(1, Math.min(settings.maxConcurrentCalls || 1, 8, customQueue.length || 1));
      const runCustomWorker = async (): Promise<void> => {
        while (customQueue.length) {
          checkCancelled();
          const statDef = customQueue.shift();
          if (!statDef) return;
          const one = await runOneCustomRequest(statDef);
          checkCancelled();
          rawBlocks.push({ label: `custom:${statDef.id}`, raw: one.raw });
          promptBlocks.push({ label: `custom:${statDef.id}`, prompt: one.prompt });
          applyParsedForCustomStat(statDef, one.parsedOne);
        }
      };
      await Promise.all(Array.from({ length: customWorkers }, () => runCustomWorker()));
    } else {
      const builtInQueue = [...builtInAndTextStats];
      const builtInWorkers = Math.max(1, Math.min(settings.maxConcurrentCalls || 1, 8, builtInQueue.length || 1));
      const runBuiltInWorker = async (): Promise<void> => {
        while (builtInQueue.length) {
          checkCancelled();
          const stat = builtInQueue.shift();
          if (!stat) return;
          const one = await runOneBuiltInOrTextRequest([stat]);
          checkCancelled();
          rawBlocks.push({ label: stat, raw: one.raw });
          promptBlocks.push({ label: stat, prompt: one.prompt });
          applyParsedForBuiltInOrTextStat(stat, one.parsedOne);
        }
      };
      await Promise.all(Array.from({ length: builtInWorkers }, () => runBuiltInWorker()));

      const customQueue = [...customStats];
      const customWorkers = Math.max(1, Math.min(settings.maxConcurrentCalls || 1, 8, customQueue.length || 1));
      const runCustomWorker = async (): Promise<void> => {
        while (customQueue.length) {
          checkCancelled();
          const statDef = customQueue.shift();
          if (!statDef) return;
          const one = await runOneCustomRequest(statDef);
          checkCancelled();
          rawBlocks.push({ label: `custom:${statDef.id}`, raw: one.raw });
          promptBlocks.push({ label: `custom:${statDef.id}`, prompt: one.prompt });
          applyParsedForCustomStat(statDef, one.parsedOne);
        }
      };
      await Promise.all(Array.from({ length: customWorkers }, () => runCustomWorker()));
    }

    const rawOutputAggregate = rawBlocks.map(item => `--- ${item.label} ---\n${item.raw}`).join("\n\n");
    const promptAggregate = promptBlocks.map(item => `--- ${item.label} ---\n${item.prompt}`).join("\n\n");

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
        statsRequested: [
          ...builtInAndTextStats,
          ...customStats.map(stat => stat.id),
        ],
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
          lastThought: countMapValues(parsed.lastThought),
          customByStat: countMapValuesByStat(parsed.deltas.custom),
        },
        appliedCounts: {
          affection: countMapValues(applied.affection),
          trust: countMapValues(applied.trust),
          desire: countMapValues(applied.desire),
          connection: countMapValues(applied.connection),
          mood: countMapValues(applied.mood),
          lastThought: countMapValues(applied.lastThought),
          customByStat: countMapValuesByStat(applied.customStatistics),
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
      throw error;
    }
  } finally {
    onProgress?.(progressTotal, progressTotal, "Finalizing");
  }

  if (cancelled) {
    throw new DOMException("Request aborted by user", "AbortError");
  }

  for (const key of STAT_KEYS) {
    if (!output[key]) output[key] = {};
  }

  return { statistics: output, customStatistics: outputCustom, debug: debugRecord };
}
