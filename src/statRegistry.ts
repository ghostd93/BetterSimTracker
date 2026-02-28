import type { BetterSimTrackerSettings, NumericStatKey } from "./types";

export interface NumericStatDefinition {
  id: string;
  label: string;
  description: string;
  defaultValue: number;
  maxDeltaPerTurn: number;
  track: boolean;
  showOnCard: boolean;
  showInGraph: boolean;
  includeInInjection: boolean;
  builtIn: boolean;
  color?: string;
  promptOverride?: string;
}

const BUILT_IN_NUMERIC_META: Record<NumericStatKey, { label: string; description: string; color: string }> = {
  affection: {
    label: "Affection",
    description: "Emotional warmth, fondness, and care toward the user.",
    color: "#ff6b81",
  },
  trust: {
    label: "Trust",
    description: "Perceived safety, reliability, and willingness to be vulnerable.",
    color: "#55d5ff",
  },
  desire: {
    label: "Desire",
    description: "Physical or romantic attraction and tension.",
    color: "#ffb347",
  },
  connection: {
    label: "Connection",
    description: "Bond depth, emotional attunement, and felt closeness.",
    color: "#9cff8f",
  },
};

function toBuiltInDef(settings: BetterSimTrackerSettings, key: NumericStatKey): NumericStatDefinition {
  const meta = BUILT_IN_NUMERIC_META[key];
  const track = key === "affection"
    ? settings.trackAffection
    : key === "trust"
      ? settings.trackTrust
      : key === "desire"
        ? settings.trackDesire
        : settings.trackConnection;
  const defaultValue = key === "affection"
    ? settings.defaultAffection
    : key === "trust"
      ? settings.defaultTrust
      : key === "desire"
        ? settings.defaultDesire
        : settings.defaultConnection;
  const ui = settings.builtInNumericStatUi?.[key] ?? {
    showOnCard: true,
    showInGraph: true,
    includeInInjection: true,
  };
  return {
    id: key,
    label: meta.label,
    description: meta.description,
    defaultValue,
    maxDeltaPerTurn: settings.maxDeltaPerTurn,
    track,
    showOnCard: track && ui.showOnCard,
    showInGraph: track && ui.showInGraph,
    includeInInjection: track && ui.includeInInjection,
    builtIn: true,
    color: meta.color,
  };
}

export function getBuiltInNumericStatDefinitions(settings: BetterSimTrackerSettings): NumericStatDefinition[] {
  return (["affection", "trust", "desire", "connection"] as const).map(key => toBuiltInDef(settings, key));
}

export function getCustomNumericStatDefinitions(settings: BetterSimTrackerSettings): NumericStatDefinition[] {
  return settings.customStats
    .filter(def => (def.kind ?? "numeric") === "numeric")
    .map(def => ({
    id: def.id,
    label: def.label,
    description: def.description ?? "",
    defaultValue: Math.max(0, Math.min(100, Math.round(Number(def.defaultValue) || 50))),
    maxDeltaPerTurn: def.maxDeltaPerTurn ?? settings.maxDeltaPerTurn,
    track: def.track,
    showOnCard: def.showOnCard,
    showInGraph: def.showInGraph,
    includeInInjection: def.includeInInjection,
    builtIn: false,
    color: def.color,
    promptOverride: def.promptOverride ?? def.sequentialPromptTemplate,
  }));
}

export function getAllNumericStatDefinitions(settings: BetterSimTrackerSettings): NumericStatDefinition[] {
  return [...getBuiltInNumericStatDefinitions(settings), ...getCustomNumericStatDefinitions(settings)];
}
