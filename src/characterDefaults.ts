import type { BetterSimTrackerSettings } from "./types";

export type CharacterDefaultsIdentity = {
  name?: string | null;
  avatar?: string | null;
};

export function normalizeCharacterName(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

export function normalizeCharacterAvatar(avatar: unknown): string {
  return typeof avatar === "string" ? avatar.trim() : "";
}

export function toCharacterDefaultsAvatarKey(avatar: unknown): string | null {
  const normalized = normalizeCharacterAvatar(avatar);
  if (!normalized) return null;
  return `avatar:${normalized}`;
}

export function toCharacterDefaultsNameKey(name: unknown): string | null {
  const normalized = normalizeCharacterName(name);
  return normalized || null;
}

export function resolveCharacterDefaultsEntry(
  settings: BetterSimTrackerSettings,
  identity: CharacterDefaultsIdentity,
): Record<string, unknown> {
  const map = settings.characterDefaults ?? {};
  const avatarKey = toCharacterDefaultsAvatarKey(identity.avatar);
  if (avatarKey) {
    const entry = map[avatarKey];
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }
  const nameKey = toCharacterDefaultsNameKey(identity.name);
  if (nameKey) {
    const entry = map[nameKey];
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }
  return {};
}

export function updateCharacterDefaultsEntry(
  settings: BetterSimTrackerSettings,
  identity: CharacterDefaultsIdentity,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): BetterSimTrackerSettings {
  const avatarKey = toCharacterDefaultsAvatarKey(identity.avatar);
  const nameKey = toCharacterDefaultsNameKey(identity.name);
  const targetKey = avatarKey ?? nameKey;
  if (!targetKey) return settings;

  const map = { ...(settings.characterDefaults ?? {}) };
  const existing = resolveCharacterDefaultsEntry(settings, identity);
  const nextEntry = updater({ ...existing });

  if (Object.keys(nextEntry).length === 0) {
    delete map[targetKey];
    if (avatarKey && nameKey && nameKey !== targetKey) {
      delete map[nameKey];
    }
  } else {
    map[targetKey] = nextEntry;
    if (avatarKey && nameKey && nameKey !== targetKey) {
      delete map[nameKey];
    }
  }

  return { ...settings, characterDefaults: map };
}
