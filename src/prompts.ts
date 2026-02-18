import type { StatKey } from "./types";
import type { Statistics } from "./types";
import type { TrackerData } from "./types";

const moodOptions = [
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

  return `${envelope}
Current tracker state:
${currentLines}

Recent tracker snapshots:
${historyLines || "- none"}

Task:
- Propose incremental changes to tracker state from the recent messages.
- Do NOT rewrite absolute values; provide per-stat deltas.
- Keep updates conservative and realistic.

Numeric stats to update (${numericStats.length ? numericStats.join(", ") : "none"}):
- Return deltas only, each in range -15..15.

Text stats to update (${textStats.length ? textStats.join(", ") : "none"}):
- mood must be one of: ${moodOptions.join(", ")}.
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
- include one entry for each character name exactly: ${characters.join(", ")}.
- omit fields for stats that are not requested.
- output JSON only, no commentary.`;
}
