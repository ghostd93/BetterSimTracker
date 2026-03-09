export function toOwnerCssSuffixFromIdentity(name: string, avatar?: string | null): string {
  const avatarRaw = String(avatar ?? "").trim();
  if (avatarRaw) {
    const withoutPersonaPrefix = avatarRaw.replace(/^persona:/i, "");
    const fileLike = withoutPersonaPrefix.split(/[\\/]/).pop() || withoutPersonaPrefix;
    const withoutExt = fileLike.replace(/\.[a-z0-9]{2,5}$/i, "");
    const normalized = withoutExt
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (normalized) return normalized;
  }
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function buildOwnerCssClasses(name: string, avatar?: string | null): string {
  const avatarFirst = `bst-owner-${toOwnerCssSuffixFromIdentity(name, avatar)}`;
  const legacyName = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!legacyName || avatarFirst === `bst-owner-${legacyName}`) {
    return avatarFirst;
  }
  return `${avatarFirst} bst-owner-name-${legacyName}`;
}
