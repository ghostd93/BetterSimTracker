export const EXTENSION_KEY = "bettersimtracker";
export const ROOT_ID = "bst-root";
export const STYLE_ID = "bst-styles";

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
