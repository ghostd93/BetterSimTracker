import type { BetterSimTrackerSettings, Character, STContext } from "./types";
import { isTrackableAiMessage } from "./messageFilter";

function getGroupCharacters(context: STContext): Character[] {
  if (!context.groupId || !context.groups || !context.characters) return [];
  const group = context.groups.find(g => g.id === context.groupId);
  if (!group?.members?.length) return [];

  const disabled = new Set(group.disabled_members ?? []);
  return context.characters.filter(
    character => character.avatar && group.members?.includes(character.avatar) && !disabled.has(character.avatar),
  );
}

function getSingleCharacter(context: STContext): Character[] {
  if (!context.characters || context.characterId === undefined) return [];
  const character = context.characters[context.characterId];
  return character ? [character] : [];
}

export function getAllTrackedCharacterNames(context: STContext): string[] {
  const groupCharacters = getGroupCharacters(context);
  if (groupCharacters.length) {
    return groupCharacters.map(c => c.name).filter(Boolean);
  }

  if (context.groupId) {
    const fromChat = Array.from(
      new Set(
        context.chat
          .filter(message => isTrackableAiMessage(message))
          .map(message => String(message.name ?? "").trim())
          .filter(Boolean),
      ),
    );
    if (fromChat.length) {
      return fromChat;
    }
  }

  const single = getSingleCharacter(context);
  if (single.length) return single.map(c => c.name).filter(Boolean);

  return context.name2 ? [context.name2] : [];
}

export function getActiveCharacterNames(
  context: STContext,
  settings: BetterSimTrackerSettings,
): string[] {
  return resolveActiveCharacterAnalysis(context, settings).activeCharacters;
}

export function resolveActiveCharacterAnalysis(
  context: STContext,
  settings: BetterSimTrackerSettings,
): {
  allCharacterNames: string[];
  activeCharacters: string[];
  reasons: Record<string, string>;
  lookback: number;
} {
  const allNames = getAllTrackedCharacterNames(context);
  const lookback = Math.max(1, settings.activityLookback);
  const reasons: Record<string, string> = {};
  if (!settings.autoDetectActive) {
    for (const name of allNames) {
      reasons[name] = "autoDetectActive disabled";
    }
    return { allCharacterNames: allNames, activeCharacters: allNames, reasons, lookback };
  }

  const recentMessages = context.chat.slice(-lookback);
  const seen = new Set<string>();

  for (const message of recentMessages) {
    if (!message.name || !isTrackableAiMessage(message)) continue;
    if (allNames.includes(message.name)) {
      seen.add(message.name);
      reasons[message.name] = `spoke in last ${lookback} messages`;
    }
  }

  const maxDepartureScan = Math.max(6, lookback * 3);
  const scanStart = Math.max(0, context.chat.length - maxDepartureScan);
  const scanSlice = context.chat.slice(scanStart);

  const hasDepartureCue = (text: string, name: string): boolean => {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const target = name.toLowerCase().trim();
    if (!normalized || !target || !normalized.includes(target)) return false;
    const departureVerbs = [
      "went",
      "goes",
      "left",
      "leaves",
      "walked",
      "walks",
      "ran",
      "returns",
      "returned",
      "headed",
      "moved",
      "retreated",
      "stayed in",
      "stays in",
      "is in",
    ];
    const departurePlaces = [
      "away",
      "out",
      "back",
      "home",
      "room",
      "bedroom",
      "upstairs",
      "downstairs",
      "outside",
      "bathroom",
      "hallway",
      "kitchen",
      "garden",
      "her room",
      "his room",
      "their room",
    ];
    const hasVerb = departureVerbs.some(verb => normalized.includes(verb));
    const hasPlace = departurePlaces.some(place => normalized.includes(place));
    return hasVerb && hasPlace;
  };

  for (const name of allNames) {
    let lastDepartureIndex = -1;
    for (let i = 0; i < scanSlice.length; i += 1) {
      const msg = scanSlice[i];
      if (!msg.is_user || msg.is_system) continue;
      const text = String(msg.mes ?? "");
      if (!text.trim()) continue;
      if (hasDepartureCue(text, name)) {
        lastDepartureIndex = scanStart + i;
      }
    }
    if (lastDepartureIndex < 0) continue;

    let spokeAfterDeparture = false;
    for (let i = lastDepartureIndex + 1; i < context.chat.length; i += 1) {
      const msg = context.chat[i];
      if (!isTrackableAiMessage(msg)) continue;
      if (String(msg.name ?? "").trim() === name) {
        spokeAfterDeparture = true;
        break;
      }
    }
    if (!spokeAfterDeparture) {
      seen.delete(name);
      reasons[name] = `departure cue at message ${lastDepartureIndex}, no speech after`;
    } else {
      reasons[name] = `departure cue at message ${lastDepartureIndex}, but spoke later`;
    }
  }

  if (seen.size === 0) {
    const visible = allNames.filter(name => {
      let lastDepartureIndex = -1;
      for (let i = 0; i < scanSlice.length; i += 1) {
        const msg = scanSlice[i];
        if (!msg.is_user || msg.is_system) continue;
        const text = String(msg.mes ?? "");
        if (!text.trim()) continue;
        if (hasDepartureCue(text, name)) {
          lastDepartureIndex = scanStart + i;
        }
      }
      if (lastDepartureIndex < 0) return true;
      for (let i = lastDepartureIndex + 1; i < context.chat.length; i += 1) {
        const msg = context.chat[i];
        if (!isTrackableAiMessage(msg)) continue;
        if (String(msg.name ?? "").trim() === name) {
          reasons[name] = `fallback visibility: spoke after departure cue at ${lastDepartureIndex}`;
          return true;
        }
      }
      reasons[name] = `fallback visibility: hidden after departure cue at ${lastDepartureIndex}`;
      return false;
    });
    const active = visible.length ? visible : allNames;
    for (const name of active) {
      if (!reasons[name]) reasons[name] = "fallback: include all tracked characters";
    }
    return { allCharacterNames: allNames, activeCharacters: active, reasons, lookback };
  }
  const activeCharacters = Array.from(seen);
  for (const name of allNames) {
    if (!reasons[name]) {
      reasons[name] = activeCharacters.includes(name)
        ? `no departure cue; included by recent activity window (${lookback})`
        : `not seen in recent activity window (${lookback})`;
    }
  }
  return { allCharacterNames: allNames, activeCharacters, reasons, lookback };
}

export function buildRecentContext(context: STContext, messageCount: number): string {
  const chunk = context.chat.slice(-Math.max(1, messageCount));
  return chunk
    .map(message => {
      if (!message.is_user && !isTrackableAiMessage(message)) return null;
      const speaker = message.is_user ? context.name1 ?? "User" : message.name ?? "Character";
      return `${speaker}: ${message.mes}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}
