import type { CustomStatDefinition } from "./types";

export function isCustomStatTrackableForOwnerToggle(
  definition: CustomStatDefinition,
  scope: "character" | "user",
): boolean {
  if (definition.track === false) return false;
  if (definition.globalScope) return false;
  if (scope === "character") return definition.trackCharacters !== false;
  return definition.trackUser !== false;
}

