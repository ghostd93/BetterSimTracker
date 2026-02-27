import type { CustomStatDefinition, CustomStatKind, CustomNonNumericStatistics, CustomStatistics, StatKey } from "./types";
import type { Statistics } from "./types";
import type { TrackerData } from "./types";

export const moodOptions = [
  "Happy",
  "Sad",
  "Angry",
  "Excited",
  "Confused",
  "In Love",
  "Shy",
  "Playful",
  "Serious",
  "Lonely",
  "Hopeful",
  "Anxious",
  "Content",
  "Frustrated",
  "Neutral"
];

export const MAIN_PROMPT = `SYSTEM:
You are a relationship-state extraction engine. Follow the task and protocol exactly.
Stat meanings:
- affection: emotional warmth, fondness, care toward the user
- trust: perceived safety/reliability; willingness to be vulnerable
- desire: physical/romantic attraction and flirt/sexual tension
- connection: felt closeness/bond depth and emotional attunement
- mood: immediate emotional tone for this turn
- lastThought: brief internal thought grounded in recent messages
Rule:
- If the relationship is non-romantic, desire deltas must be 0 or negative.
 - Do not infer romance from affection or playfulness.
Do not add commentary or roleplay.`;

export const DEFAULT_UNIFIED_PROMPT_INSTRUCTION = [
  "- Propose incremental changes to tracker state from the recent messages.",
  "- Do NOT rewrite absolute values; provide per-stat deltas.",
  "- Keep updates conservative and realistic.",
  "- It is valid to return 0 or negative deltas if the interaction is neutral or negative.",
  "- Do not reuse the same delta for all stats unless strongly justified by context.",
  "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
  "- Only increase desire if the relationship is explicitly romantic/sexual in the recent messages. If the relationship is non-romantic, desire must be 0 or negative. Do not infer romance from affectionate or playful behavior alone.",
].join("\n");

export const DEFAULT_INJECTION_PROMPT_TEMPLATE = [
  "{{header}}",
  "",
  "Stat semantics:",
  "{{statSemantics}}",
  "",
  "{{behaviorBands}}",
  "",
  "{{reactRules}}",
  "",
  "Priority rules:",
  "{{priorityRules}}",
  "",
  "{{lines}}",
  "",
  "{{summarizationNote}}",
].join("\n");

export const UNIFIED_PROMPT_PROTOCOL = `Numeric stats to update ({{numericStats}}):
- Return deltas only, each in range -{{maxDelta}}..{{maxDelta}}.

Text stats to update ({{textStats}}):
- mood must be one of: {{moodOptions}}.
- lastThought must be one short sentence.

Return STRICT JSON only:
{
  "characters": [
    {
      "name": "Character Name",
      "confidence": 0.0,
      "delta": {
        "affection": 0,
        "trust": 0,
        "desire": 0,
        "connection": 0
      },
      "mood": "Neutral",
      "lastThought": ""
    }
  ]
}

Rules:
- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.
- include one entry for each character name exactly: {{characters}}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;

export const DEFAULT_STRICT_RETRY_TEMPLATE = `SYSTEM OVERRIDE:
Return ONLY valid JSON.
No prose. No roleplay. No markdown except optional \`\`\`json fences.
If uncertain, still return best-effort JSON with required keys.

{{basePrompt}}`;

export const DEFAULT_REPAIR_MOOD_TEMPLATE = `SYSTEM OVERRIDE:
Return ONLY valid JSON, no prose, no roleplay.
MANDATORY: include \`mood\` for every character.
Use one of allowed mood labels exactly: {{moodOptions}}.

{{basePrompt}}`;

export const DEFAULT_REPAIR_LAST_THOUGHT_TEMPLATE = `SYSTEM OVERRIDE:
Return ONLY valid JSON, no prose, no roleplay.
MANDATORY: include \`lastThought\` for every character.
Keep it to one short sentence per character.

{{basePrompt}}`;

export const NUMERIC_PROMPT_PROTOCOL = (key: string): string => `Return deltas only, each in range -{{maxDelta}}..{{maxDelta}}.

Return STRICT JSON only:
{
  "characters": [
    {
      "name": "Character Name",
      "confidence": 0.0,
      "delta": {
        "${key}": 0
      }
    }
  ]
}

Rules:
- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.
- include one entry for each character name exactly: {{characters}}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;

export const MOOD_PROMPT_PROTOCOL = `Return STRICT JSON only:
{
  "characters": [
    {
      "name": "Character Name",
      "confidence": 0.0,
      "mood": "Neutral"
    }
  ]
}

Rules:
- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.
- include one entry for each character name exactly: {{characters}}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;

export const LAST_THOUGHT_PROMPT_PROTOCOL = `Return STRICT JSON only:
{
  "characters": [
    {
      "name": "Character Name",
      "confidence": 0.0,
      "lastThought": ""
    }
  ]
}

Rules:
- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.
- include one entry for each character name exactly: {{characters}}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;

export const DEFAULT_CUSTOM_NON_NUMERIC_PROTOCOL_TEMPLATE = `Value schema:
{{valueSchemaRules}}

Return STRICT JSON only:
{
  "characters": [
    {
      "name": "Character Name",
      "confidence": 0.0,
      "value": {
        "{{statId}}": {{valueSchemaSample}}
      }
    }
  ]
}

Rules:
- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.
- include one entry for each character name exactly: {{characters}}.
- output JSON only, no commentary.`;

export const DEFAULT_PROTOCOL_UNIFIED = UNIFIED_PROMPT_PROTOCOL;
export const DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION = NUMERIC_PROMPT_PROTOCOL("affection");
export const DEFAULT_PROTOCOL_SEQUENTIAL_TRUST = NUMERIC_PROMPT_PROTOCOL("trust");
export const DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE = NUMERIC_PROMPT_PROTOCOL("desire");
export const DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION = NUMERIC_PROMPT_PROTOCOL("connection");
export const DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC = NUMERIC_PROMPT_PROTOCOL("{{statId}}");
export const DEFAULT_PROTOCOL_SEQUENTIAL_MOOD = MOOD_PROMPT_PROTOCOL;
export const DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT = LAST_THOUGHT_PROMPT_PROTOCOL;
export const DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC = DEFAULT_CUSTOM_NON_NUMERIC_PROTOCOL_TEMPLATE;

const buildNumericInstruction = (label: string, key: string): string => [
  `- Propose incremental changes to ${label} from the recent messages.`,
  `- Only update ${key} deltas. Ignore other stats.`,
  "- Keep updates conservative and realistic.",
  "- It is valid to return 0 or negative deltas if the interaction is neutral or negative.",
  "- Do not reuse the same delta for all characters unless strongly justified by context.",
  "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
].join("\n");

export const DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS: Record<StatKey, string> = {
  affection: buildNumericInstruction("AFFECTION", "affection"),
  trust: buildNumericInstruction("TRUST", "trust"),
  desire: [
    "- Propose incremental changes to DESIRE from the recent messages.",
    "- Only update desire deltas. Ignore other stats.",
    "- Keep updates conservative and realistic.",
    "- It is valid to return 0 or negative deltas if the interaction is neutral or negative.",
    "- Do not reuse the same delta for all characters unless strongly justified by context.",
    "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
    "- Only increase desire if the relationship is explicitly romantic/sexual in the recent messages. If the relationship is non-romantic, desire must be 0 or negative. Do not infer romance from affectionate or playful behavior alone.",
  ].join("\n"),
  connection: buildNumericInstruction("CONNECTION", "connection"),
  mood: [
    "- Determine each character's current mood toward the user.",
    "- Choose one mood label from: {{moodOptions}}.",
    "- Keep updates conservative and realistic.",
    "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
  ].join("\n"),
  lastThought: [
    "- Write a short internal thought (one sentence) each character has right now.",
    "- Keep it concise and grounded in the recent messages.",
    "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
  ].join("\n"),
};

export const DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION = [
  "- Propose incremental changes to {{statLabel}} from the recent messages.",
  "- Only update {{statId}} deltas. Ignore other stats.",
  "- Keep updates conservative and realistic.",
  "- It is valid to return 0 or negative deltas if the interaction is neutral or negative.",
  "- Do not reuse the same delta for all characters unless strongly justified by context.",
  "- Use recent messages first; use character cards only to disambiguate when context is unclear.",
].join("\n");

export const DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION = [
  "- Determine the best current value for {{statLabel}} from recent messages.",
  "- Update only {{statId}} and ignore other stats.",
  "- Return one valid value per character using the exact schema for this stat kind.",
  "- Keep updates conservative and context-grounded.",
  "- Prefer recent messages first; use character cards only to disambiguate when needed.",
].join("\n");

function commonEnvelope(userName: string, characters: string[], contextText: string): string {
  return [
    `User: ${userName}`,
    `Characters: ${characters.join(", ")}`,
    "",
    "Recent messages:",
    contextText,
    ""
  ].join("\n");
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

function buildSourcePriorityRule(includeCharacterCards: boolean, includeLorebook: boolean): string {
  if (includeCharacterCards && includeLorebook) {
    return "- Use recent messages first; use character cards and lorebook only to disambiguate when context is unclear.";
  }
  if (includeCharacterCards) {
    return "- Use recent messages first; use character cards only to disambiguate when context is unclear.";
  }
  if (includeLorebook) {
    return "- Use recent messages first; use lorebook only to disambiguate when context is unclear.";
  }
  return "";
}

function applySourcePriorityRule(
  instruction: string,
  includeCharacterCards: boolean,
  includeLorebook: boolean,
): string {
  const cleaned = instruction
    .replace(/^- (Use|Prefer) recent messages first; use [^\n]+\.$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [cleaned, buildSourcePriorityRule(includeCharacterCards, includeLorebook)]
    .filter(Boolean)
    .join("\n");
}

function primaryCharacter(characters: string[]): string {
  const first = characters.find(name => typeof name === "string" && name.trim());
  return first?.trim() || "Character";
}

function resolvePrimaryCharacter(characters: string[], preferredCharacterName?: string): string {
  const preferred = String(preferredCharacterName ?? "").trim();
  if (preferred) {
    const preferredLower = preferred.toLowerCase();
    const matched = characters.find(name => {
      if (typeof name !== "string") return false;
      const trimmed = name.trim();
      return Boolean(trimmed) && trimmed.toLowerCase() === preferredLower;
    });
    if (matched && matched.trim()) return matched.trim();
  }
  return primaryCharacter(characters);
}

export function buildPrompt(
  stat: StatKey,
  userName: string,
  characters: string[],
  contextText: string,
): string {
  const envelope = commonEnvelope(userName, characters, contextText);

  switch (stat) {
    case "affection":
      return `${envelope}
Rate AFFECTION each character feels toward the user on 0-100.
Return JSON object only, keys must be exact character names, values must be numbers.`;
    case "trust":
      return `${envelope}
Rate TRUST each character has toward the user on 0-100.
Return JSON object only, keys must be exact character names, values must be numbers.`;
    case "desire":
      return `${envelope}
Rate DESIRE (physical attraction) each character feels toward the user on 0-100.
Return JSON object only, keys must be exact character names, values must be numbers.`;
    case "connection":
      return `${envelope}
Rate CONNECTION (emotional intimacy) each character has with the user on 0-100.
Return JSON object only, keys must be exact character names, values must be numbers.`;
    case "mood":
      return `${envelope}
Determine each character's current mood toward the user.
Allowed moods: ${moodOptions.join(", ")}.
Return JSON object only, keys must be exact character names, values must be short mood strings.`;
    case "lastThought":
      return `${envelope}
Write a short internal thought (1 sentence) each character has right now.
Return JSON object only, keys must be exact character names, values must be plain strings.`;
    default:
      return envelope;
  }
}

export function buildUnifiedPrompt(
  stats: StatKey[],
  userName: string,
  characters: string[],
  contextText: string,
  current: Statistics | null,
  history: TrackerData[] = [],
  maxDeltaPerTurn = 15,
  template?: string,
  protocolTemplate?: string,
  preferredCharacterName?: string,
  includeCharacterCardsInPrompt = true,
  includeLorebookInExtraction = true,
): string {
  const envelope = commonEnvelope(userName, characters, contextText);
  const char = resolvePrimaryCharacter(characters, preferredCharacterName);
  const numericStats = stats.filter(stat =>
    stat === "affection" || stat === "trust" || stat === "desire" || stat === "connection",
  );
  const textStats = stats.filter(stat => stat === "mood" || stat === "lastThought");

  const currentLines = characters.map(name => {
    const affection = Number(current?.affection?.[name] ?? 50);
    const trust = Number(current?.trust?.[name] ?? 50);
    const desire = Number(current?.desire?.[name] ?? 50);
    const connection = Number(current?.connection?.[name] ?? 50);
    const mood = String(current?.mood?.[name] ?? "Neutral");
    return `- ${name}: affection=${Math.max(0, Math.min(100, Math.round(affection)))}, trust=${Math.max(0, Math.min(100, Math.round(trust)))}, desire=${Math.max(0, Math.min(100, Math.round(desire)))}, connection=${Math.max(0, Math.min(100, Math.round(connection)))}, mood=${mood}`;
  }).join("\n");

  const historyLines = history.slice(0, 3).map((entry, idx) => {
    const header = `Snapshot ${idx + 1} (newest-${idx}):`;
    const rows = characters.map(name => {
      const affection = Number(entry.statistics.affection?.[name] ?? 50);
      const trust = Number(entry.statistics.trust?.[name] ?? 50);
      const desire = Number(entry.statistics.desire?.[name] ?? 50);
      const connection = Number(entry.statistics.connection?.[name] ?? 50);
      const mood = String(entry.statistics.mood?.[name] ?? "Neutral");
      return `  - ${name}: affection=${Math.round(affection)}, trust=${Math.round(trust)}, desire=${Math.round(desire)}, connection=${Math.round(connection)}, mood=${mood}`;
    }).join("\n");
    return `${header}\n${rows}`;
  }).join("\n");

  const safeMaxDelta = Math.max(1, Math.round(Number(maxDeltaPerTurn) || 15));
  const instructionRaw = template?.trim() ? template : DEFAULT_UNIFIED_PROMPT_INSTRUCTION;
  const instruction = applySourcePriorityRule(
    instructionRaw,
    includeCharacterCardsInPrompt,
    includeLorebookInExtraction,
  );
  const protocol = protocolTemplate?.trim() ? protocolTemplate : UNIFIED_PROMPT_PROTOCOL;
  const assembled = [
    MAIN_PROMPT,
    "",
    "{{envelope}}",
    "Current tracker state:",
    "{{currentLines}}",
    "",
    "Recent tracker snapshots:",
    "{{historyLines}}",
    "",
    "Task:",
    "{{instruction}}",
    "",
    protocol,
  ].join("\n");
  return renderTemplate(assembled, {
    envelope,
    user: userName,
    userName,
    char,
    characters: characters.join(", "),
    contextText,
    currentLines,
    historyLines: historyLines || "- none",
    instruction,
    numericStats: numericStats.length ? numericStats.join(", ") : "none",
    textStats: textStats.length ? textStats.join(", ") : "none",
    maxDelta: String(safeMaxDelta),
    moodOptions: moodOptions.join(", "),
  });
}

export function buildUnifiedAllStatsPrompt(input: {
  stats: StatKey[];
  customStats: CustomStatDefinition[];
  userName: string;
  characters: string[];
  contextText: string;
  current: Statistics | null;
  currentCustom?: CustomStatistics | null;
  currentCustomNonNumeric?: CustomNonNumericStatistics | null;
  history: TrackerData[];
  maxDeltaPerTurn?: number;
  template?: string;
  preferredCharacterName?: string;
  includeCharacterCardsInPrompt?: boolean;
  includeLorebookInExtraction?: boolean;
}): string {
  const envelope = commonEnvelope(input.userName, input.characters, input.contextText);
  const char = resolvePrimaryCharacter(input.characters, input.preferredCharacterName);
  const safeMaxDelta = Math.max(1, Math.round(Number(input.maxDeltaPerTurn) || 15));
  const instructionRaw = input.template?.trim() ? input.template : DEFAULT_UNIFIED_PROMPT_INSTRUCTION;
  const instruction = applySourcePriorityRule(
    instructionRaw,
    Boolean(input.includeCharacterCardsInPrompt),
    Boolean(input.includeLorebookInExtraction),
  );
  const builtInNumeric = input.stats.filter(stat =>
    stat === "affection" || stat === "trust" || stat === "desire" || stat === "connection",
  );
  const builtInText = input.stats.filter(stat => stat === "mood" || stat === "lastThought");
  const customNumeric = input.customStats.filter(stat => (stat.kind ?? "numeric") === "numeric");
  const customNonNumeric = input.customStats.filter(stat => (stat.kind ?? "numeric") !== "numeric");
  const numericDeltaKeys = [...builtInNumeric, ...customNumeric.map(stat => stat.id)];

  const currentLines = input.characters.map(name => {
    const chunks: string[] = [];
    const affection = Number(input.current?.affection?.[name] ?? 50);
    const trust = Number(input.current?.trust?.[name] ?? 50);
    const desire = Number(input.current?.desire?.[name] ?? 50);
    const connection = Number(input.current?.connection?.[name] ?? 50);
    const mood = String(input.current?.mood?.[name] ?? "Neutral");
    chunks.push(`affection=${Math.max(0, Math.min(100, Math.round(affection)))}`);
    chunks.push(`trust=${Math.max(0, Math.min(100, Math.round(trust)))}`);
    chunks.push(`desire=${Math.max(0, Math.min(100, Math.round(desire)))}`);
    chunks.push(`connection=${Math.max(0, Math.min(100, Math.round(connection)))}`);
    chunks.push(`mood=${mood}`);
    for (const stat of customNumeric) {
      const customRaw = Number(input.currentCustom?.[stat.id]?.[name] ?? stat.defaultValue);
      const customValue = Math.max(0, Math.min(100, Math.round(customRaw)));
      chunks.push(`${stat.id}=${customValue}`);
    }
    for (const stat of customNonNumeric) {
      const kind = stat.kind ?? "text_short";
      const fallback = kind === "boolean"
        ? (typeof stat.defaultValue === "boolean" ? stat.defaultValue : false)
        : String(stat.defaultValue ?? "");
      const customRaw = input.currentCustomNonNumeric?.[stat.id]?.[name];
      const customValue = formatCustomNonNumericValue(kind, customRaw, fallback);
      const literal = typeof customValue === "boolean" ? String(customValue) : `"${customValue}"`;
      chunks.push(`${stat.id}=${literal}`);
    }
    return `- ${name}: ${chunks.join(", ")}`;
  }).join("\n");

  const historyLines = input.history.slice(0, 3).map((entry, idx) => {
    const header = `Snapshot ${idx + 1} (newest-${idx}):`;
    const rows = input.characters.map(name => {
      const chunks: string[] = [];
      const affection = Number(entry.statistics.affection?.[name] ?? 50);
      const trust = Number(entry.statistics.trust?.[name] ?? 50);
      const desire = Number(entry.statistics.desire?.[name] ?? 50);
      const connection = Number(entry.statistics.connection?.[name] ?? 50);
      const mood = String(entry.statistics.mood?.[name] ?? "Neutral");
      chunks.push(`affection=${Math.round(affection)}`);
      chunks.push(`trust=${Math.round(trust)}`);
      chunks.push(`desire=${Math.round(desire)}`);
      chunks.push(`connection=${Math.round(connection)}`);
      chunks.push(`mood=${mood}`);
      for (const stat of customNumeric) {
        const customRaw = Number(entry.customStatistics?.[stat.id]?.[name] ?? stat.defaultValue);
        const customValue = Math.max(0, Math.min(100, Math.round(customRaw)));
        chunks.push(`${stat.id}=${customValue}`);
      }
      for (const stat of customNonNumeric) {
        const kind = stat.kind ?? "text_short";
        const fallback = kind === "boolean"
          ? (typeof stat.defaultValue === "boolean" ? stat.defaultValue : false)
          : String(stat.defaultValue ?? "");
        const customRaw = entry.customNonNumericStatistics?.[stat.id]?.[name];
        const customValue = formatCustomNonNumericValue(kind, customRaw, fallback);
        const literal = typeof customValue === "boolean" ? String(customValue) : `"${customValue}"`;
        chunks.push(`${stat.id}=${literal}`);
      }
      return `  - ${name}: ${chunks.join(", ")}`;
    }).join("\n");
    return `${header}\n${rows}`;
  }).join("\n");

  const deltaSample = numericDeltaKeys.length
    ? numericDeltaKeys.map(key => `        "${key}": 0`).join(",\n")
    : "        ";
  const valueSample = customNonNumeric.length
    ? customNonNumeric.map(stat => {
      const kind = stat.kind ?? "text_short";
      if (kind === "boolean") return `        "${stat.id}": false`;
      return `        "${stat.id}": ""`;
    }).join(",\n")
    : "";

  const nonNumericRules = customNonNumeric.map(stat => {
    const kind = stat.kind ?? "text_short";
    if (kind === "enum_single") {
      const options = Array.isArray(stat.enumOptions)
        ? stat.enumOptions.map(item => String(item ?? "").trim()).filter(Boolean)
        : [];
      return `- ${stat.id} (enum_single): one of [${options.join(", ") || "none"}].`;
    }
    if (kind === "boolean") {
      const trueLabel = String(stat.booleanTrueLabel ?? "enabled").trim() || "enabled";
      const falseLabel = String(stat.booleanFalseLabel ?? "disabled").trim() || "disabled";
      return `- ${stat.id} (boolean): strict true/false (true=${trueLabel}, false=${falseLabel}).`;
    }
    const textMaxLen = Math.max(20, Math.min(200, Math.round(Number(stat.textMaxLength) || 120)));
    return `- ${stat.id} (text_short): one concise single-line text, max ${textMaxLen} chars.`;
  }).join("\n");

  const protocol = [
    `Numeric delta stats to update (${numericDeltaKeys.length ? numericDeltaKeys.join(", ") : "none"}):`,
    `- Return deltas only, each in range -${safeMaxDelta}..${safeMaxDelta}.`,
    "",
    `Text stats to update (${builtInText.length ? builtInText.join(", ") : "none"}):`,
    `- mood must be one of: ${moodOptions.join(", ")}.`,
    "- lastThought must be one short sentence.",
    "",
    customNonNumeric.length
      ? [
        `Custom non-numeric stats to update (${customNonNumeric.map(stat => stat.id).join(", ")}):`,
        "- Return them under `value` object per character using exact stat ids.",
        nonNumericRules,
        "",
      ].join("\n")
      : "",
    "Return STRICT JSON only:",
    "{",
    "  \"characters\": [",
    "    {",
    "      \"name\": \"Character Name\",",
    "      \"confidence\": 0.0,",
    "      \"delta\": {",
    deltaSample,
    "      }",
    customNonNumeric.length ? "      ,\"value\": {\n" + valueSample + "\n      }" : "",
    builtInText.includes("mood") ? "      ,\"mood\": \"Neutral\"" : "",
    builtInText.includes("lastThought") ? "      ,\"lastThought\": \"\"" : "",
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- confidence is 0..1 (0 low confidence, 1 high confidence) and reflects your certainty in the extracted update for that character.",
    `- include one entry for each character name exactly: ${input.characters.join(", ")}.`,
    "- omit fields for stats that are not requested.",
    "- output JSON only, no commentary.",
  ]
    .filter(Boolean)
    .join("\n");

  const assembled = [
    MAIN_PROMPT,
    "",
    "{{envelope}}",
    "Current tracker state:",
    "{{currentLines}}",
    "",
    "Recent tracker snapshots:",
    "{{historyLines}}",
    "",
    "Task:",
    "{{instruction}}",
    "- Update built-in and custom stats in this single response.",
    "- For custom numeric stats, use `delta.<statId>`.",
    "- For custom non-numeric stats, use `value.<statId>`.",
    "",
    protocol,
  ].join("\n");

  return renderTemplate(assembled, {
    envelope,
    user: input.userName,
    userName: input.userName,
    char,
    characters: input.characters.join(", "),
    contextText: input.contextText,
    currentLines,
    historyLines: historyLines || "- none",
    instruction,
  });
}

export function buildSequentialPrompt(
  stat: StatKey,
  userName: string,
  characters: string[],
  contextText: string,
  current: Statistics | null,
  history: TrackerData[] = [],
  maxDeltaPerTurn = 15,
  template?: string,
  protocolTemplate?: string,
  preferredCharacterName?: string,
  includeCharacterCardsInPrompt = true,
  includeLorebookInExtraction = true,
): string {
  const envelope = commonEnvelope(userName, characters, contextText);
  const char = resolvePrimaryCharacter(characters, preferredCharacterName);
  const numericStats = stat === "affection" || stat === "trust" || stat === "desire" || stat === "connection"
    ? [stat]
    : [];
  const textStats = stat === "mood" || stat === "lastThought" ? [stat] : [];

  const currentLines = characters.map(name => {
    const affection = Number(current?.affection?.[name] ?? 50);
    const trust = Number(current?.trust?.[name] ?? 50);
    const desire = Number(current?.desire?.[name] ?? 50);
    const connection = Number(current?.connection?.[name] ?? 50);
    const mood = String(current?.mood?.[name] ?? "Neutral");
    return `- ${name}: affection=${Math.max(0, Math.min(100, Math.round(affection)))}, trust=${Math.max(0, Math.min(100, Math.round(trust)))}, desire=${Math.max(0, Math.min(100, Math.round(desire)))}, connection=${Math.max(0, Math.min(100, Math.round(connection)))}, mood=${mood}`;
  }).join("\n");

  const historyLines = history.slice(0, 3).map((entry, idx) => {
    const header = `Snapshot ${idx + 1} (newest-${idx}):`;
    const rows = characters.map(name => {
      const affection = Number(entry.statistics.affection?.[name] ?? 50);
      const trust = Number(entry.statistics.trust?.[name] ?? 50);
      const desire = Number(entry.statistics.desire?.[name] ?? 50);
      const connection = Number(entry.statistics.connection?.[name] ?? 50);
      const mood = String(entry.statistics.mood?.[name] ?? "Neutral");
      return `  - ${name}: affection=${Math.round(affection)}, trust=${Math.round(trust)}, desire=${Math.round(desire)}, connection=${Math.round(connection)}, mood=${mood}`;
    }).join("\n");
    return `${header}\n${rows}`;
  }).join("\n");

  const safeMaxDelta = Math.max(1, Math.round(Number(maxDeltaPerTurn) || 15));
  const instructionRaw = template?.trim()
    ? template
    : DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS[stat] || DEFAULT_UNIFIED_PROMPT_INSTRUCTION;
  const instruction = applySourcePriorityRule(
    instructionRaw,
    includeCharacterCardsInPrompt,
    includeLorebookInExtraction,
  );
  const defaultProtocol = stat === "mood"
    ? MOOD_PROMPT_PROTOCOL
    : stat === "lastThought"
      ? LAST_THOUGHT_PROMPT_PROTOCOL
      : NUMERIC_PROMPT_PROTOCOL(stat);
  const protocol = protocolTemplate?.trim() ? protocolTemplate : defaultProtocol;
  const assembled = [
    MAIN_PROMPT,
    "",
    "{{envelope}}",
    "Current tracker state:",
    "{{currentLines}}",
    "",
    "Recent tracker snapshots:",
    "{{historyLines}}",
    "",
    "Task:",
    "{{instruction}}",
    "",
    protocol,
  ].join("\n");
  return renderTemplate(assembled, {
    envelope,
    user: userName,
    userName,
    char,
    characters: characters.join(", "),
    contextText,
    currentLines,
    historyLines: historyLines || "- none",
    instruction,
    numericStats: numericStats.length ? numericStats.join(", ") : "none",
    textStats: textStats.length ? textStats.join(", ") : "none",
    maxDelta: String(safeMaxDelta),
    moodOptions: moodOptions.join(", "),
  });
}

export function buildSequentialCustomNumericPrompt(input: {
  statId: string;
  statLabel: string;
  statDescription?: string;
  statDefault: number;
  maxDeltaPerTurn: number;
  userName: string;
  characters: string[];
  contextText: string;
  current: Statistics | null;
  currentCustom?: Record<string, Record<string, number>> | null;
  history: TrackerData[];
  template?: string;
  protocolTemplate?: string;
  preferredCharacterName?: string;
  includeCharacterCardsInPrompt?: boolean;
  includeLorebookInExtraction?: boolean;
}): string {
  const statId = input.statId.trim();
  const statLabel = input.statLabel.trim() || statId;
  const statDescription = String(input.statDescription ?? "").trim();
  const defaultValue = Math.max(0, Math.min(100, Math.round(Number(input.statDefault) || 50)));
  const envelope = commonEnvelope(input.userName, input.characters, input.contextText);
  const char = resolvePrimaryCharacter(input.characters, input.preferredCharacterName);
  const safeMaxDelta = Math.max(1, Math.round(Number(input.maxDeltaPerTurn) || 15));

  const currentLines = input.characters.map(name => {
    const affection = Number(input.current?.affection?.[name] ?? 50);
    const trust = Number(input.current?.trust?.[name] ?? 50);
    const desire = Number(input.current?.desire?.[name] ?? 50);
    const connection = Number(input.current?.connection?.[name] ?? 50);
    const mood = String(input.current?.mood?.[name] ?? "Neutral");
    const customValueRaw = Number(input.currentCustom?.[statId]?.[name] ?? defaultValue);
    const customValue = Math.max(0, Math.min(100, Math.round(customValueRaw)));
    return `- ${name}: affection=${Math.max(0, Math.min(100, Math.round(affection)))}, trust=${Math.max(0, Math.min(100, Math.round(trust)))}, desire=${Math.max(0, Math.min(100, Math.round(desire)))}, connection=${Math.max(0, Math.min(100, Math.round(connection)))}, mood=${mood}, ${statId}=${customValue}`;
  }).join("\n");

  const historyLines = input.history.slice(0, 3).map((entry, idx) => {
    const header = `Snapshot ${idx + 1} (newest-${idx}):`;
    const rows = input.characters.map(name => {
      const affection = Number(entry.statistics.affection?.[name] ?? 50);
      const trust = Number(entry.statistics.trust?.[name] ?? 50);
      const desire = Number(entry.statistics.desire?.[name] ?? 50);
      const connection = Number(entry.statistics.connection?.[name] ?? 50);
      const mood = String(entry.statistics.mood?.[name] ?? "Neutral");
      const customValueRaw = Number(entry.customStatistics?.[statId]?.[name] ?? defaultValue);
      const customValue = Math.max(0, Math.min(100, Math.round(customValueRaw)));
      return `  - ${name}: affection=${Math.round(affection)}, trust=${Math.round(trust)}, desire=${Math.round(desire)}, connection=${Math.round(connection)}, mood=${mood}, ${statId}=${customValue}`;
    }).join("\n");
    return `${header}\n${rows}`;
  }).join("\n");

  const instructionTemplate = input.template?.trim() || DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION;
  const instructionRendered = renderTemplate(instructionTemplate, {
    statId,
    statLabel,
    statDescription,
    statDefault: String(defaultValue),
    maxDelta: String(safeMaxDelta),
    user: input.userName,
    userName: input.userName,
    char,
    characters: input.characters.join(", "),
    envelope,
    contextText: input.contextText,
  });
  const instruction = applySourcePriorityRule(
    instructionRendered,
    Boolean(input.includeCharacterCardsInPrompt),
    Boolean(input.includeLorebookInExtraction),
  );

  const protocol = input.protocolTemplate?.trim() || NUMERIC_PROMPT_PROTOCOL(statId);
  const assembled = [
    MAIN_PROMPT,
    "",
    "{{envelope}}",
    "Current tracker state:",
    "{{currentLines}}",
    "",
    "Recent tracker snapshots:",
    "{{historyLines}}",
    "",
    "Task:",
    "{{instruction}}",
    "",
    protocol,
  ].join("\n");

  return renderTemplate(assembled, {
    envelope,
    user: input.userName,
    userName: input.userName,
    char,
    currentLines,
    historyLines: historyLines || "- none",
    instruction,
    maxDelta: String(safeMaxDelta),
    characters: input.characters.join(", "),
  });
}

function formatCustomNonNumericValue(
  kind: CustomStatKind,
  value: unknown,
  fallback: string | boolean,
): string | boolean {
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const cleaned = value.trim().toLowerCase();
      if (cleaned === "true") return true;
      if (cleaned === "false") return false;
    }
    return Boolean(fallback);
  }

  const text = typeof value === "string" ? value.trim() : "";
  if (text) return text;
  return typeof fallback === "string" ? fallback : "";
}

function getCustomNonNumericProtocolValues(input: {
  kind: CustomStatKind;
  statId: string;
  allowedValues: string[];
  textMaxLen: number;
  trueLabel: string;
  falseLabel: string;
}): { valueSchemaRules: string; valueSchemaSample: string } {
  if (input.kind === "enum_single") {
    const fallback = JSON.stringify(input.allowedValues[0] ?? "state");
    return {
      valueSchemaRules: `- Return one of allowed values exactly: ${input.allowedValues.join(", ")}.`,
      valueSchemaSample: fallback,
    };
  }

  if (input.kind === "boolean") {
    return {
      valueSchemaRules: [
        `- Return strict boolean only for ${input.statId} (true/false).`,
        `- true means: ${input.trueLabel}.`,
        `- false means: ${input.falseLabel}.`,
      ].join("\n"),
      valueSchemaSample: "false",
    };
  }

  return {
    valueSchemaRules: [
      `- Return one concise single-line text value for ${input.statId}.`,
      `- Maximum length: ${input.textMaxLen} characters.`,
    ].join("\n"),
    valueSchemaSample: "\"\"",
  };
}

function customNonNumericProtocol(input: {
  kind: CustomStatKind;
  statId: string;
  allowedValues: string[];
  textMaxLen: number;
  trueLabel: string;
  falseLabel: string;
  template?: string;
}): string {
  const values = getCustomNonNumericProtocolValues(input);
  const protocolTemplate = input.template?.trim() || DEFAULT_CUSTOM_NON_NUMERIC_PROTOCOL_TEMPLATE;
  return renderTemplate(protocolTemplate, {
    statId: input.statId,
    valueSchemaRules: values.valueSchemaRules,
    valueSchemaSample: values.valueSchemaSample,
    allowedValues: input.allowedValues.join(", "),
    textMaxLen: String(input.textMaxLen),
    booleanTrueLabel: input.trueLabel,
    booleanFalseLabel: input.falseLabel,
  });
}

export function buildSequentialCustomNonNumericPrompt(input: {
  statId: string;
  statKind: Exclude<CustomStatKind, "numeric">;
  statLabel: string;
  statDescription?: string;
  statDefault: string | boolean;
  enumOptions?: string[];
  textMaxLength?: number;
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
  userName: string;
  characters: string[];
  contextText: string;
  current: Statistics | null;
  currentCustomNonNumeric?: CustomNonNumericStatistics | null;
  history: TrackerData[];
  template?: string;
  protocolTemplate?: string;
  preferredCharacterName?: string;
  includeCharacterCardsInPrompt?: boolean;
  includeLorebookInExtraction?: boolean;
}): string {
  const statId = input.statId.trim();
  const statLabel = input.statLabel.trim() || statId;
  const statDescription = String(input.statDescription ?? "").trim();
  const statKind = input.statKind;
  const enumOptions = Array.isArray(input.enumOptions)
    ? input.enumOptions.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const textMaxLen = Math.max(20, Math.min(200, Math.round(Number(input.textMaxLength) || 120)));
  const trueLabel = String(input.booleanTrueLabel ?? "enabled").trim() || "enabled";
  const falseLabel = String(input.booleanFalseLabel ?? "disabled").trim() || "disabled";
  const envelope = commonEnvelope(input.userName, input.characters, input.contextText);
  const char = resolvePrimaryCharacter(input.characters, input.preferredCharacterName);

  const defaultValue = formatCustomNonNumericValue(statKind, input.statDefault, statKind === "boolean" ? false : "");
  const defaultLiteral = typeof defaultValue === "boolean" ? String(defaultValue) : defaultValue;
  const allowedValuesLiteral = enumOptions.join(", ");
  const valueSchema = statKind === "enum_single"
    ? "enum"
    : statKind === "boolean"
      ? "boolean"
      : `text<=${textMaxLen}`;

  const currentLines = input.characters.map(name => {
    const affection = Number(input.current?.affection?.[name] ?? 50);
    const trust = Number(input.current?.trust?.[name] ?? 50);
    const desire = Number(input.current?.desire?.[name] ?? 50);
    const connection = Number(input.current?.connection?.[name] ?? 50);
    const mood = String(input.current?.mood?.[name] ?? "Neutral");
    const customRaw = input.currentCustomNonNumeric?.[statId]?.[name];
    const customValue = formatCustomNonNumericValue(statKind, customRaw, defaultValue);
    const customLiteral = typeof customValue === "boolean" ? String(customValue) : `"${customValue}"`;
    return `- ${name}: affection=${Math.max(0, Math.min(100, Math.round(affection)))}, trust=${Math.max(0, Math.min(100, Math.round(trust)))}, desire=${Math.max(0, Math.min(100, Math.round(desire)))}, connection=${Math.max(0, Math.min(100, Math.round(connection)))}, mood=${mood}, ${statId}=${customLiteral}`;
  }).join("\n");

  const historyLines = input.history.slice(0, 3).map((entry, idx) => {
    const header = `Snapshot ${idx + 1} (newest-${idx}):`;
    const rows = input.characters.map(name => {
      const affection = Number(entry.statistics.affection?.[name] ?? 50);
      const trust = Number(entry.statistics.trust?.[name] ?? 50);
      const desire = Number(entry.statistics.desire?.[name] ?? 50);
      const connection = Number(entry.statistics.connection?.[name] ?? 50);
      const mood = String(entry.statistics.mood?.[name] ?? "Neutral");
      const customRaw = entry.customNonNumericStatistics?.[statId]?.[name];
      const customValue = formatCustomNonNumericValue(statKind, customRaw, defaultValue);
      const customLiteral = typeof customValue === "boolean" ? String(customValue) : `"${customValue}"`;
      return `  - ${name}: affection=${Math.round(affection)}, trust=${Math.round(trust)}, desire=${Math.round(desire)}, connection=${Math.round(connection)}, mood=${mood}, ${statId}=${customLiteral}`;
    }).join("\n");
    return `${header}\n${rows}`;
  }).join("\n");

  const instructionTemplate = input.template?.trim() || DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION;
  const instructionRendered = renderTemplate(instructionTemplate, {
    statId,
    statLabel,
    statDescription,
    statDefault: String(defaultLiteral),
    maxDelta: "",
    user: input.userName,
    userName: input.userName,
    char,
    characters: input.characters.join(", "),
    envelope,
    contextText: input.contextText,
    statKind,
    allowedValues: allowedValuesLiteral,
    textMaxLen: String(textMaxLen),
    booleanTrueLabel: trueLabel,
    booleanFalseLabel: falseLabel,
    valueSchema,
  });
  const instruction = applySourcePriorityRule(
    instructionRendered,
    Boolean(input.includeCharacterCardsInPrompt),
    Boolean(input.includeLorebookInExtraction),
  );

  const assembled = [
    MAIN_PROMPT,
    "",
    "{{envelope}}",
    "Current tracker state:",
    "{{currentLines}}",
    "",
    "Recent tracker snapshots:",
    "{{historyLines}}",
    "",
    "Task:",
    "{{instruction}}",
    "",
    customNonNumericProtocol({
      kind: statKind,
      statId,
      allowedValues: enumOptions,
      textMaxLen,
      trueLabel,
      falseLabel,
      template: input.protocolTemplate,
    }),
  ].join("\n");

  return renderTemplate(assembled, {
    envelope,
    user: input.userName,
    userName: input.userName,
    char,
    currentLines,
    historyLines: historyLines || "- none",
    instruction,
    characters: input.characters.join(", "),
  });
}

export function buildSequentialCustomOverrideGenerationPrompt(input: {
  statId: string;
  statLabel: string;
  statDescription: string;
  statKind?: CustomStatKind;
  enumOptions?: string[];
  textMaxLength?: number;
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
}): string {
  const statId = input.statId.trim().toLowerCase();
  const statLabel = input.statLabel.trim();
  const statDescription = input.statDescription.trim();
  const statKind = input.statKind ?? "numeric";
  const enumOptions = Array.isArray(input.enumOptions)
    ? input.enumOptions.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(input.textMaxLength) || 120)));
  const trueLabel = String(input.booleanTrueLabel ?? "enabled").trim() || "enabled";
  const falseLabel = String(input.booleanFalseLabel ?? "disabled").trim() || "disabled";
  const middleEnumValue = enumOptions.length
    ? enumOptions[Math.floor((enumOptions.length - 1) / 2)]
    : "";

  const kindRequirements = (() => {
    if (statKind === "numeric") {
      return [
        `- Explicitly say to update only ${statId} deltas and ignore other stats.`,
        "- Allow 0 or negative deltas when context is neutral/negative.",
        `- Include concrete evidence cues for when ${statId} should increase vs decrease.`,
      ];
    }
    if (statKind === "enum_single") {
      const lowValue = enumOptions[0] ?? "low";
      const midValue = middleEnumValue || enumOptions[0] || "medium";
      const highValue = enumOptions[enumOptions.length - 1] ?? "high";
      return [
        `- Explicitly say to update only ${statId} value and ignore other stats.`,
        `- Require output values to be one exact token from: ${enumOptions.join(", ") || "(none provided)"}.`,
        `- Include concrete evidence cues for choosing anchor values \"${lowValue}\", \"${midValue}\", and \"${highValue}\".`,
      ];
    }
    if (statKind === "boolean") {
      return [
        `- Explicitly say to update only ${statId} value and ignore other stats.`,
        `- Require strict boolean output only (true/false), where true=${trueLabel} and false=${falseLabel}.`,
        `- Include concrete evidence cues for switching ${statId} from false->true and true->false.`,
      ];
    }
    return [
      `- Explicitly say to update only ${statId} value and ignore other stats.`,
      `- Require one concise single-line text value (max ${textMaxLength} chars).`,
      `- Include concrete evidence cues for when ${statId} should be kept, changed, or rewritten.`,
    ];
  })();

  return [
    "SYSTEM:",
    "You write instruction text for BetterSimTracker custom sequential extraction.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not add explanations before or after the instruction block.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Custom stat:",
    `- ID: ${statId}`,
    `- Kind: ${statKind}`,
    `- Label: ${statLabel}`,
    `- Description: ${statDescription}`,
    ...(statKind === "enum_single" ? [`- Allowed values: ${enumOptions.join(", ") || "(none provided)"}`] : []),
    ...(statKind === "text_short" ? [`- Text max length: ${textMaxLength}`] : []),
    ...(statKind === "boolean" ? [`- True label: ${trueLabel}`, `- False label: ${falseLabel}`] : []),
    "",
    "Task:",
    "Write exactly 6 short bullet lines. Every line must start with \"- \".",
    "Write a stat-specific override for this exact stat, not a generic template.",
    "This is extraction instruction text (state update logic), not behavior-reaction guidance.",
    "The instruction must:",
    `- Mention ${statLabel} and ${statId} directly (literal), not macro placeholders.`,
    `- Use the provided description (${statDescription}) to define what evidence should move ${statId}.`,
    ...kindRequirements,
    "- Keep updates conservative and realistic from recent messages.",
    "- Prefer recent messages first; use character cards only for disambiguation.",
    "- Avoid generic filler and keep each bullet actionable.",
    "- Do not write assistant reply-style behavior tips (tone/boundaries/persona).",
    "- Do not mention JSON, response format, confidence math, or this generator prompt.",
    "",
    "Return the 6-line instruction block only.",
  ].join("\n");
}

export function buildCustomStatDescriptionGenerationPrompt(input: {
  statId: string;
  statLabel: string;
  currentDescription: string;
  statKind?: CustomStatKind;
  enumOptions?: string[];
  textMaxLength?: number;
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
}): string {
  const statId = input.statId.trim().toLowerCase();
  const statLabel = input.statLabel.trim();
  const currentDescription = input.currentDescription.trim();
  const statKind = input.statKind ?? "numeric";
  const enumOptions = Array.isArray(input.enumOptions)
    ? input.enumOptions.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(input.textMaxLength) || 120)));
  const trueLabel = String(input.booleanTrueLabel ?? "enabled").trim() || "enabled";
  const falseLabel = String(input.booleanFalseLabel ?? "disabled").trim() || "disabled";

  return [
    "SYSTEM:",
    "You rewrite custom-stat descriptions for BetterSimTracker.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Custom stat:",
    `- ID: ${statId}`,
    `- Kind: ${statKind}`,
    `- Label: ${statLabel}`,
    `- Current description: ${currentDescription}`,
    ...(statKind === "enum_single" ? [`- Allowed values: ${enumOptions.join(", ") || "(none provided)"}`] : []),
    ...(statKind === "text_short" ? [`- Text max length: ${textMaxLength}`] : []),
    ...(statKind === "boolean" ? [`- True label: ${trueLabel}`, `- False label: ${falseLabel}`] : []),
    "",
    "Task:",
    "Rewrite the description into one clear sentence for extraction logic.",
    "Requirements:",
    "- Keep the same meaning but make it precise and practical.",
    "- Focus on what should increase/decrease this stat from conversational evidence.",
    "- Keep it neutral and domain-agnostic (no roleplay flavor text).",
    "- Keep it between 12 and 28 words.",
    "- Avoid placeholders, bullets, quotes, and extra commentary.",
    "",
    "Return exactly one sentence.",
  ].join("\n");
}

export function buildBuiltInSequentialPromptGenerationPrompt(input: {
  stat: "affection" | "trust" | "desire" | "connection" | "mood" | "lastThought";
  currentInstruction: string;
}): string {
  const stat = input.stat;
  const currentInstruction = input.currentInstruction.trim();
  const labelByStat: Record<typeof stat, string> = {
    affection: "Affection",
    trust: "Trust",
    desire: "Desire",
    connection: "Connection",
    mood: "Mood",
    lastThought: "Last Thought",
  };
  const statLabel = labelByStat[stat];
  const statNotesByStat: Record<typeof stat, string[]> = {
    affection: [
      "- Focus on emotional warmth/care signals toward the user.",
      "- Avoid overreacting to one polite line; keep conservative movement.",
    ],
    trust: [
      "- Focus on safety/reliability/vulnerability signals toward the user.",
      "- Distinguish polite compliance from genuine trust increases.",
    ],
    desire: [
      "- Only increase when context is explicitly romantic/sexual.",
      "- Non-romantic context should keep desire flat or lower.",
    ],
    connection: [
      "- Focus on emotional attunement, continuity, and bond depth cues.",
      "- Prefer sustained interaction patterns over one-off phrases.",
    ],
    mood: [
      "- Focus on immediate emotional tone for this turn only.",
      "- Keep mood interpretation anchored to recent explicit cues.",
    ],
    lastThought: [
      "- Focus on one brief internal thought grounded in recent messages.",
      "- Keep it concise, in-character, and tied to immediate context.",
    ],
  };
  const statNotes = statNotesByStat[stat];

  return [
    "SYSTEM:",
    "You write one instruction block for BetterSimTracker sequential extraction.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Target sequential prompt:",
    `- Stat: ${stat} (${statLabel})`,
    "",
    "Current instruction:",
    currentInstruction || "(empty)",
    "",
    "Task:",
    "Rewrite this instruction into a stronger, practical, model-facing version for this stat only.",
    "Output requirements:",
    "- Write exactly 6 short bullet lines.",
    "- Every line must start with \"- \".",
    "- Keep wording concrete and extraction-focused.",
    "- Prioritize recent messages; use character cards only for disambiguation.",
    "- Keep updates conservative and realistic.",
    ...statNotes,
    "- Do not mention JSON/format/protocol/confidence math/token limits.",
    "- Do not mention this generator prompt or meta instructions.",
    "",
    "Return the 6-line instruction block only.",
  ].join("\n");
}

export function buildCustomStatBehaviorGuidanceGenerationPrompt(input: {
  statId: string;
  statLabel: string;
  statDescription: string;
  currentGuidance?: string;
  statKind?: CustomStatKind;
  enumOptions?: string[];
  textMaxLength?: number;
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
}): string {
  const statId = input.statId.trim().toLowerCase();
  const statLabel = input.statLabel.trim();
  const statDescription = input.statDescription.trim();
  const currentGuidance = String(input.currentGuidance ?? "").trim();
  const statKind = input.statKind ?? "numeric";
  const enumOptions = Array.isArray(input.enumOptions)
    ? input.enumOptions.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(input.textMaxLength) || 120)));
  const trueLabel = String(input.booleanTrueLabel ?? "enabled").trim() || "enabled";
  const falseLabel = String(input.booleanFalseLabel ?? "disabled").trim() || "disabled";
  const middleEnumValue = enumOptions.length
    ? enumOptions[Math.floor((enumOptions.length - 1) / 2)]
    : "";

  const taskByKind = (() => {
    if (statKind === "numeric") {
      return [
        "Write exactly 5 short bullet lines for this exact stat.",
        "Requirements:",
        "- Each line must start with \"- \".",
        `- Mention ${statId} and ${statLabel} literally at least once across the block.`,
        `- Include one line for LOW ${statId} behavior, one for MEDIUM ${statId}, and one for HIGH ${statId}.`,
        `- Include one line describing evidence that should move ${statId} upward over time.`,
        `- Include one line describing evidence that should move ${statId} downward over time.`,
      ];
    }
    if (statKind === "enum_single") {
      const lowValue = enumOptions[0] ?? "low";
      const midValue = middleEnumValue || enumOptions[0] || "medium";
      const highValue = enumOptions[enumOptions.length - 1] ?? "high";
      return [
        "Write exactly 5 short bullet lines for this exact stat.",
        "Requirements:",
        "- Each line must start with \"- \".",
        `- Mention ${statId} and ${statLabel} literally at least once across the block.`,
        `- Include one behavior line for value \"${lowValue}\", one for \"${midValue}\", and one for \"${highValue}\".`,
        `- Include one line describing cues that should move ${statId} toward higher-value states.`,
        `- Include one line describing cues that should move ${statId} toward lower-value states.`,
      ];
    }
    if (statKind === "boolean") {
      return [
        "Write exactly 5 short bullet lines for this exact stat.",
        "Requirements:",
        "- Each line must start with \"- \".",
        `- Mention ${statId} and ${statLabel} literally at least once across the block.`,
        `- Include one behavior line for ${statId}=true (${trueLabel}) and one for ${statId}=false (${falseLabel}).`,
        `- Include one line describing cues that should switch ${statId} from false to true.`,
        `- Include one line describing cues that should switch ${statId} from true to false.`,
        `- Include one stability line about how to stay consistent with current ${statId} state across nearby turns.`,
      ];
    }
    return [
      "Write exactly 5 short bullet lines for this exact stat.",
      "Requirements:",
      "- Each line must start with \"- \".",
      `- Mention ${statId} and ${statLabel} literally at least once across the block.`,
      `- Treat ${statId} as a short current-state note (max ${textMaxLength} chars), then define how replies should adapt to that state.`,
      `- Include one line for open/positive state wording, one for guarded/negative state wording, and one for neutral/unclear state wording.`,
      `- Include one line describing what evidence should strengthen the current ${statId} state.`,
      `- Include one line describing what evidence should weaken or redirect the current ${statId} state.`,
    ];
  })();

  return [
    "SYSTEM:",
    "You write behavior-guidance lines for BetterSimTracker prompt injection.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Custom stat:",
    `- ID: ${statId}`,
    `- Kind: ${statKind}`,
    `- Label: ${statLabel}`,
    `- Description: ${statDescription}`,
    ...(statKind === "enum_single" ? [`- Allowed values: ${enumOptions.join(", ") || "(none provided)"}`] : []),
    ...(statKind === "text_short" ? [`- Text max length: ${textMaxLength}`] : []),
    ...(statKind === "boolean" ? [`- True label: ${trueLabel}`, `- False label: ${falseLabel}`] : []),
    `- Current guidance: ${currentGuidance || "(empty)"}`,
    "",
    "Task:",
    ...taskByKind,
    "- Keep phrasing specific and practical, not generic (avoid \"more/less [label]\" wording).",
    "- Keep wording model-facing, actionable, and neutral (no roleplay narration).",
    "- Focus on reply behavior (tone, initiative, boundaries, detail level), not extraction mechanics.",
    "- Do not instruct parsing/updating/extracting values and do not mention deltas.",
    "- Do not mention JSON, confidence, output schema, or this generator prompt.",
    "",
    "Return only the 5 bullet lines.",
  ].join("\n");
}

export function buildTrackerSummaryGenerationPrompt(input: {
  userName: string;
  activeCharacters: string[];
  characters: string[];
  contextText: string;
  trackerStateLines: string;
  trackedDimensions: string[];
}): string {
  const userName = String(input.userName ?? "").trim() || "User";
  const activeCharacters = input.activeCharacters.filter(Boolean);
  const allCharacters = input.characters.filter(Boolean);
  const contextText = String(input.contextText ?? "").trim() || "(no recent context)";
  const trackerStateLines = String(input.trackerStateLines ?? "").trim() || "- no tracker values available";
  const trackedDimensions = input.trackedDimensions.filter(Boolean);

  return [
    "SYSTEM:",
    "You write a relationship-status summary for a chat system comment.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Goal:",
    "Write a concise descriptive prose summary of the current interpersonal dynamics.",
    "The output will be posted directly in chat as a system-style note.",
    "",
    "Hard rules:",
    "- Do not use numerals or percentages.",
    "- Do not output score labels like affection/trust/desire/connection IDs with values.",
    "- Keep it to 4-6 natural sentences.",
    "- Keep tone neutral and observant, not roleplay dialogue.",
    "- Mention relevant character names naturally.",
    "- Ground the summary in both the recent messages and tracker state.",
    "- Reflect only tracked dimensions listed below; do not invent dimensions that are absent.",
    "",
    "Tracked dimensions (only these):",
    `- ${trackedDimensions.length ? trackedDimensions.join(", ") : "Use only dimensions explicitly present in the tracker snapshot."}`,
    "",
    "Inputs:",
    `- User: ${userName}`,
    `- Active characters: ${activeCharacters.length ? activeCharacters.join(", ") : "none"}`,
    `- All tracked characters: ${allCharacters.length ? allCharacters.join(", ") : "none"}`,
    "",
    "Recent messages:",
    contextText,
    "",
    "Tracker state snapshot:",
    trackerStateLines,
    "",
    "Return only the final prose summary.",
  ].join("\n");
}

export function buildTrackerSummaryNoNumbersRewritePrompt(input: {
  draftSummary: string;
}): string {
  const draftSummary = String(input.draftSummary ?? "").trim();
  return [
    "SYSTEM:",
    "Rewrite the text into clean prose for a chat system comment.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Hard rules:",
    "- Remove all numerals and percentages.",
    "- Keep meaning and tone intact.",
    "- Keep it to 4-6 natural sentences.",
    "- Preserve only dimensions already present in the draft (do not introduce new ones).",
    "",
    "Draft text:",
    draftSummary || "(empty)",
    "",
    "Return only the rewritten prose.",
  ].join("\n");
}

export function buildTrackerSummaryLengthenPrompt(input: {
  draftSummary: string;
}): string {
  const draftSummary = String(input.draftSummary ?? "").trim();
  return [
    "SYSTEM:",
    "Expand the summary into fuller prose for a chat system comment.",
    "Return plain text only.",
    "Do not return JSON.",
    "Do not return markdown code fences.",
    "Do not include any reasoning tags like <think>, <analysis>, or similar.",
    "",
    "Hard rules:",
    "- Keep it to 4-6 natural sentences.",
    "- Do not use numerals or percentages.",
    "- Keep tone neutral and observant, not roleplay dialogue.",
    "- Keep existing meaning, but add useful detail grounded in context.",
    "- Mention relevant character names naturally.",
    "- Preserve only dimensions already present in the draft (do not introduce new ones).",
    "",
    "Draft summary:",
    draftSummary || "(empty)",
    "",
    "Return only the expanded summary.",
  ].join("\n");
}
