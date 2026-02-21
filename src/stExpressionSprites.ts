type SpriteEntry = { label?: string; path?: string };

function toSpriteList(data: unknown): SpriteEntry[] {
  if (Array.isArray(data)) return data as SpriteEntry[];
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.sprites)) return record.sprites as SpriteEntry[];
    if (Array.isArray(record.data)) return record.data as SpriteEntry[];
  }
  return [];
}

export async function fetchExpressionSpritePaths(characterName: string): Promise<string[]> {
  const trimmed = characterName.trim();
  if (!trimmed) return [];
  const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(trimmed)}`, { method: "GET" });
  if (!response.ok) return [];
  const data = await response.json();
  const sprites = toSpriteList(data);
  const paths = sprites
    .map(item => String(item.path ?? "").trim())
    .filter(path => Boolean(path));
  return Array.from(new Set(paths));
}

export async function fetchFirstExpressionSprite(characterName: string): Promise<string | null> {
  const paths = await fetchExpressionSpritePaths(characterName);
  return paths[0] ?? null;
}
