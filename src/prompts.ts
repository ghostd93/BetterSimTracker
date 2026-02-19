import type { StatKey } from "./types";
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
- confidence is 0..1 (0 low confidence, 1 high confidence).
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
- confidence is 0..1 (0 low confidence, 1 high confidence).
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
- confidence is 0..1 (0 low confidence, 1 high confidence).
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
- confidence is 0..1 (0 low confidence, 1 high confidence).
- include one entry for each character name exactly: {{characters}}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;

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
): string {
  const envelope = commonEnvelope(userName, characters, contextText);
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
  const instruction = template?.trim() ? template : DEFAULT_UNIFIED_PROMPT_INSTRUCTION;
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
    UNIFIED_PROMPT_PROTOCOL,
  ].join("\n");
  return renderTemplate(assembled, {
    envelope,
    userName,
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

export function buildSequentialPrompt(
  stat: StatKey,
  userName: string,
  characters: string[],
  contextText: string,
  current: Statistics | null,
  history: TrackerData[] = [],
  maxDeltaPerTurn = 15,
  template?: string,
): string {
  const envelope = commonEnvelope(userName, characters, contextText);
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
  const instruction = template?.trim()
    ? template
    : DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS[stat] || DEFAULT_UNIFIED_PROMPT_INSTRUCTION;
  const protocol = stat === "mood"
    ? MOOD_PROMPT_PROTOCOL
    : stat === "lastThought"
      ? LAST_THOUGHT_PROMPT_PROTOCOL
      : NUMERIC_PROMPT_PROTOCOL(stat);
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
    userName,
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
