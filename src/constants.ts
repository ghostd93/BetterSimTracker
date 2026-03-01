export const EXTENSION_KEY = "bettersimtracker";
export const ROOT_ID = "bst-root";
export const STYLE_ID = "bst-styles";
export const USER_TRACKER_KEY = "__bst_user__";
export const GLOBAL_TRACKER_KEY = "__bst_global__";

export const STAT_KEYS = [
  "affection",
  "trust",
  "desire",
  "connection",
  "mood",
  "lastThought"
] as const;

export const NUMERIC_STATS = ["affection", "trust", "desire", "connection"] as const;

export const TEXT_STATS = ["mood", "lastThought"] as const;

export const MAX_CUSTOM_STATS = 8;
export const CUSTOM_STAT_ID_REGEX = /^[a-z][a-z0-9_]{1,31}$/;
export const RESERVED_CUSTOM_STAT_IDS = new Set<string>([
  ...STAT_KEYS,
  "custom",
  "custom_stats",
  "customstatistics",
  "statistics",
  "settings",
  "defaults",
  "all",
  "none",
]);
