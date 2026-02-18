import { STYLE_ID } from "./constants";
import type { BetterSimTrackerSettings, ConnectionProfileOption, DeltaDebugRecord, StatValue, TrackerData } from "./types";

const statLabels: Array<{ key: "affection" | "trust" | "desire" | "connection"; label: string }> = [
  { key: "affection", label: "Affection" },
  { key: "trust", label: "Trust" },
  { key: "desire", label: "Desire" },
  { key: "connection", label: "Connection" }
];

function numericFallbackForStat(
  key: "affection" | "trust" | "desire" | "connection",
  settings: BetterSimTrackerSettings,
): number {
  if (key === "affection") return settings.defaultAffection;
  if (key === "trust") return settings.defaultTrust;
  if (key === "desire") return settings.defaultDesire;
  return settings.defaultConnection;
}

export type TrackerUiState = {
  phase: "idle" | "generating" | "extracting";
  done: number;
  total: number;
  messageIndex: number | null;
};

type RenderEntry = {
  messageIndex: number;
  data: TrackerData | null;
};

const ROOT_CLASS = "bst-root";
const collapsedTrackerMessages = new Set<number>();

function toPercent(value: StatValue): number {
  if (typeof value === "number") return Math.max(0, Math.min(100, value));
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function moodToEmojiEntity(moodRaw: string): string {
  const mood = moodRaw.toLowerCase();
  if (mood.includes("happy") || mood.includes("excited")) return "&#x1F604;";
  if (mood.includes("content")) return "&#x1F642;";
  if (mood.includes("hopeful")) return "&#x1F91E;";
  if (mood.includes("playful")) return "&#x1F60F;";
  if (mood.includes("serious")) return "&#x1F610;";
  if (mood.includes("shy")) return "&#x1F60A;";
  if (mood.includes("in love")) return "&#x1F60D;";
  if (mood.includes("anxious")) return "&#x1F61F;";
  if (mood.includes("confused")) return "&#x1F615;";
  if (mood.includes("angry")) return "&#x1F620;";
  if (mood.includes("frustrated")) return "&#x1F624;";
  if (mood.includes("sad") || mood.includes("lonely")) return "&#x1F614;";
  return "&#x1F636;";
}

function moodBadgeColor(moodRaw: string): string {
  const mood = moodRaw.toLowerCase();
  if (mood.includes("happy") || mood.includes("excited") || mood.includes("in love")) return "rgba(87, 214, 138, 0.25)";
  if (mood.includes("content") || mood.includes("hopeful") || mood.includes("playful")) return "rgba(89, 185, 255, 0.24)";
  if (mood.includes("frustrated") || mood.includes("angry") || mood.includes("sad") || mood.includes("lonely")) return "rgba(255, 120, 136, 0.25)";
  return "rgba(255,255,255,0.12)";
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
}

function colorFromName(name: string): string {
  let hash = 0;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const sat = 46 + (hash % 22); // 46..67
  const light = 24 + ((hash >> 5) % 10); // 24..33
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function hslFromName(name: string): { h: number; s: number; l: number } {
  let hash = 0;
  const text = name.trim().toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return {
    h: hash % 360,
    s: 46 + (hash % 22),
    l: 24 + ((hash >> 5) % 10),
  };
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function allocateCharacterColors(names: string[]): Record<string, string> {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (!unique.length) return {};
  const sorted = [...unique].sort((a, b) => a.localeCompare(b));
  const step = Math.max(22, Math.floor(360 / Math.max(1, sorted.length)));
  const takenHues: number[] = [];
  const out: Record<string, string> = {};

  for (const name of sorted) {
    const seed = hslFromName(name);
    let bestHue = seed.h;
    let bestScore = -1;
    for (let i = 0; i < 16; i += 1) {
      const candidate = (seed.h + i * step) % 360;
      const minDist = takenHues.length
        ? Math.min(...takenHues.map(h => hueDistance(h, candidate)))
        : 360;
      if (minDist > bestScore) {
        bestScore = minDist;
        bestHue = candidate;
      }
    }
    takenHues.push(bestHue);
    out[name] = `hsl(${bestHue} ${seed.s}% ${seed.l}%)`;
  }
  return out;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.${ROOT_CLASS} {
  margin-top: 10px;
  display: grid;
  gap: 8px;
  pointer-events: auto;
}
.bst-loading {
  border: 1px solid rgba(255,255,255,0.16);
  background: linear-gradient(180deg, rgba(23, 27, 38, 0.95), rgba(15, 18, 26, 0.95));
  border-radius: 12px;
  color: #f3f5f9;
  padding: 10px;
}
.bst-loading-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}
.bst-loading-sub {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.82;
}
.bst-loading-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  overflow: hidden;
}
.bst-loading-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--bst-accent), #ffd38f);
  transition: width 0.25s ease;
}
.bst-loading-track-indeterminate .bst-loading-fill {
  width: 42%;
  animation: bst-indeterminate-slide 1.1s ease-in-out infinite;
}
@keyframes bst-indeterminate-slide {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(30%); }
  100% { transform: translateX(230%); }
}
.bst-root-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-bottom: 2px;
}
.bst-card {
  position: relative;
  overflow: hidden;
  background: linear-gradient(165deg, color-mix(in srgb, var(--bst-card-local, var(--bst-card)) 88%, #ffffff 12%), color-mix(in srgb, var(--bst-card-local, var(--bst-card)) 72%, #000 28%));
  border: 1px solid color-mix(in srgb, var(--bst-card-local, var(--bst-accent)) 46%, #ffffff 54%);
  border-radius: var(--bst-radius);
  color: #fff;
  box-shadow: 0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.06) inset;
  padding: 11px 12px;
}
.bst-card-inactive {
  border-color: rgba(255,255,255,0.12);
  box-shadow: 0 4px 12px rgba(0,0,0,0.30), 0 0 0 1px rgba(255,255,255,0.03) inset;
}
.bst-card-inactive::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(5, 7, 12, 0.43);
  pointer-events: none;
}
.bst-card-inactive .bst-state {
  background: rgba(0,0,0,0.45);
}
.bst-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 7px;
}
.bst-name {
  font-weight: 700;
  letter-spacing: 0.2px;
}
.bst-state {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
}
.bst-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.bst-mini-btn {
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 7px;
  padding: 2px 6px;
  background: rgba(16,21,32,0.8);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, transform .1s ease;
}
.bst-mini-btn:hover {
  border-color: rgba(255,255,255,0.42);
  background: rgba(22,28,42,0.92);
}
.bst-mini-btn:active {
  transform: translateY(1px);
}
.bst-mini-btn-icon {
  width: 24px;
  min-width: 24px;
  height: 24px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  text-align: center;
}
.bst-mini-btn-accent {
  border-color: color-mix(in srgb, var(--bst-accent) 55%, #ffffff 45%);
  background: color-mix(in srgb, var(--bst-accent) 22%, #131a28 78%);
}
.bst-mini-btn-accent:hover {
  border-color: color-mix(in srgb, var(--bst-accent) 78%, #ffffff 22%);
  background: color-mix(in srgb, var(--bst-accent) 33%, #131a28 67%);
}
.bst-row { margin: 7px 0; }
.bst-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 3px;
  opacity: 0.93;
}
.bst-track {
  background: rgba(255,255,255,0.14);
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
}
.bst-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--bst-accent), color-mix(in srgb, var(--bst-accent) 65%, #ffd38f 35%));
  box-shadow: 0 0 10px color-mix(in srgb, var(--bst-accent) 70%, #ffffff 30%);
  transition: width 0.5s ease;
}
.bst-mood { margin-top: 7px; }
.bst-mood-emoji { font-size: 18px; line-height: 1; }
.bst-mood-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bst-mood-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.10);
}
.bst-delta {
  font-size: 10px;
  margin-left: 6px;
  opacity: 0.9;
}
.bst-delta-up { color: #94f7a8; }
.bst-delta-down { color: #ff9ea8; }
.bst-delta-flat { color: #d4d9e8; }
.bst-thought {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.35;
  padding: 8px;
  border-radius: 10px;
  background: rgba(0,0,0,0.18);
  font-style: italic;
}
.bst-root-collapsed .bst-body {
  display: none;
}
.bst-collapsed-summary {
  display: none;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.92;
  align-items: center;
  gap: 8px;
}
.bst-root-collapsed .bst-collapsed-summary {
  display: flex;
}
.bst-collapsed-mood {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  font-size: 14px;
}
.bst-settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.46);
  z-index: 2147483000;
  pointer-events: auto;
}
.bst-settings {
  position: fixed;
  z-index: 2147483001;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(760px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  background:
    radial-gradient(1200px 400px at 0% 0%, rgba(255, 98, 123, 0.14), transparent 60%),
    radial-gradient(900px 300px at 100% 0%, rgba(86, 189, 255, 0.12), transparent 55%),
    #121621;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  color: #fff;
  padding: 16px;
  pointer-events: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-family: "Segoe UI", "Trebuchet MS", sans-serif;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.bst-settings h3 { margin: 0 0 4px 0; font-size: 20px; letter-spacing: 0.2px; }
.bst-settings-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.bst-settings-subtitle { margin: 0 0 12px 0; opacity: 0.78; font-size: 12px; }
.bst-settings-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bst-settings label { font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.bst-check { flex-direction: row !important; align-items: center; gap: 8px !important; }
.bst-check input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--bst-accent); }
.bst-settings input, .bst-settings select {
  background: #0d1220 !important;
  color: #f3f5f9 !important;
  border: 1px solid rgba(255,255,255,0.20) !important;
  border-radius: 8px;
  padding: 7px;
}
.bst-settings input::placeholder { color: rgba(243,245,249,0.6); }
.bst-settings-section {
  margin: 12px 0;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(9, 12, 20, 0.45);
}
.bst-settings-section h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  opacity: 0.9;
}
.bst-help-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  opacity: 0.92;
}
.bst-help-line {
  font-size: 12px;
  opacity: 0.9;
}
.bst-btn {
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 7px 10px;
  color: #fff;
  background: #23293a;
  cursor: pointer;
}
.bst-close-btn {
  min-width: 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
}
.bst-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  min-width: 34px;
  height: 34px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
}
.bst-btn-soft {
  border-color: color-mix(in srgb, var(--bst-accent) 45%, #ffffff 55%);
  background: color-mix(in srgb, var(--bst-accent) 16%, #1e2738 84%);
}
.bst-btn-danger {
  border-color: #d06a6a;
  color: #ffd2d2;
  background: #3a2020;
}
.bst-debug-actions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.bst-debug-box {
  margin-top: 8px;
  background: #0b1020;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  font-family: Consolas, "Courier New", monospace;
  font-size: 11px;
  white-space: pre-wrap;
}
.bst-graph-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2147483010;
}
.bst-graph-modal {
  position: fixed;
  z-index: 2147483011;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(860px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  overflow: auto;
  background: #121621;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 16px;
  padding: 14px;
  color: #fff;
}
.bst-graph-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.bst-graph-title {
  font-size: 15px;
  font-weight: 700;
}
.bst-graph-controls {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 8px;
}
.bst-graph-window-select {
  background: #0d1220;
  color: #f3f5f9;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 8px;
  padding: 4px 6px;
}
.bst-graph-svg {
  width: 100%;
  height: 320px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  background: #0d1220;
}
.bst-graph-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.92;
  user-select: none;
}
.bst-graph-toggle input {
  display: none;
}
.bst-graph-toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.32);
  transition: background .18s ease, border-color .18s ease;
}
.bst-graph-toggle-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  transition: transform .18s ease;
}
.bst-graph-toggle input:checked + .bst-graph-toggle-switch {
  background: color-mix(in srgb, var(--bst-accent) 60%, #22314d 40%);
  border-color: color-mix(in srgb, var(--bst-accent) 72%, #ffffff 28%);
}
.bst-graph-toggle input:checked + .bst-graph-toggle-switch::after {
  transform: translateX(16px);
}
.bst-graph-legend {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  font-size: 11px;
  flex-wrap: wrap;
}
.bst-graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.bst-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  display: inline-block;
}
@media (max-width: 820px) {
  .bst-mini-btn {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 12px;
  }
  .bst-settings {
    left: 0;
    top: 0;
    transform: none;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 12px 10px 18px;
  }
  .bst-settings h3 {
    font-size: 18px;
  }
  .bst-close-btn {
    min-width: 40px;
    width: 40px;
    height: 40px;
    font-size: 20px;
  }
  .bst-settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .bst-settings label {
    font-size: 13px;
  }
  .bst-help-list,
  .bst-help-line {
    font-size: 13px;
  }
  .bst-settings input,
  .bst-settings select {
    font-size: 16px;
    padding: 9px 10px;
  }
  .bst-btn {
    min-height: 40px;
    font-size: 13px;
  }
  .bst-btn-icon {
    min-height: 40px;
    width: 40px;
    min-width: 40px;
  }
  .bst-debug-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .bst-graph-modal {
    left: 0;
    top: 0;
    transform: none;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 10px;
  }
  .bst-graph-top {
    align-items: center;
    gap: 8px;
  }
  .bst-graph-title {
    font-size: 14px;
  }
  .bst-graph-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .bst-graph-window-select {
    font-size: 16px;
    padding: 6px 8px;
  }
  .bst-graph-svg {
    height: 250px;
  }
}
`;
  document.head.appendChild(style);
}

function findMessageContainer(messageIndex: number | null): HTMLElement | null {
  if (messageIndex == null) return null;
  const selectors = [
    `.mes[mesid="${messageIndex}"]`,
    `.mes[data-mesid="${messageIndex}"]`,
    `[mesid="${messageIndex}"]`,
    `[data-mesid="${messageIndex}"]`
  ];
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found instanceof HTMLElement) return found;
  }
  return null;
}

function getRoot(messageIndex: number | null): HTMLDivElement | null {
  const anchor = findMessageContainer(messageIndex);
  if (!anchor) return null;

  const indexKey = String(messageIndex);
  let root = document.querySelector(`.${ROOT_CLASS}[data-message-index="${indexKey}"]`) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement("div");
    root.className = ROOT_CLASS;
    root.dataset.messageIndex = indexKey;
  }

  const preferredMount =
    (anchor.querySelector(".mes_block") as HTMLElement | null) ??
    (anchor.querySelector(".mes_text") as HTMLElement | null) ??
    anchor;

  if (root.parentElement !== preferredMount) {
    preferredMount.appendChild(root);
  }
  return root;
}

export function renderTracker(
  entries: RenderEntry[],
  settings: BetterSimTrackerSettings,
  allCharacters: string[],
  isGroupChat: boolean,
  uiState: TrackerUiState,
  latestAiIndex: number | null,
  onOpenGraph?: (characterName: string) => void,
  onRetrackMessage?: (messageIndex: number) => void,
): void {
  ensureStyles();
  const palette = allocateCharacterColors(allCharacters);
  const sortedEntries = [...entries].sort((a, b) => a.messageIndex - b.messageIndex);
  const findPreviousData = (messageIndex: number): TrackerData | null => {
    for (let i = sortedEntries.length - 1; i >= 0; i -= 1) {
      const candidate = sortedEntries[i];
      if (candidate.messageIndex >= messageIndex) continue;
      if (candidate.data) return candidate.data;
    }
    return null;
  };
  const wanted = new Set(entries.map(entry => String(entry.messageIndex)));

  document.querySelectorAll(`.${ROOT_CLASS}`).forEach(node => {
    const el = node as HTMLElement;
    const idx = String(el.dataset.messageIndex ?? "");
    if (!wanted.has(idx)) {
      el.remove();
    }
  });

  if (!settings.enabled) {
    return;
  }

  for (const entry of entries) {
    const root = getRoot(entry.messageIndex);
    if (!root) continue;

    root.style.setProperty("--bst-card", "#1f2028");
    root.style.setProperty("--bst-accent", settings.accentColor);
    root.style.setProperty("--bst-radius", `${settings.borderRadius}px`);
    root.style.opacity = `${settings.cardOpacity}`;
    root.style.fontSize = `${settings.fontSize}px`;
    root.style.display = "grid";
    root.innerHTML = "";

    if (!root.dataset.bstBound) {
      root.dataset.bstBound = "1";
      root.addEventListener("click", event => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('[data-bst-action="graph"]') as HTMLElement | null;
        if (button) {
          const name = String(button.getAttribute("data-character") ?? "").trim();
          if (!name) return;
          onOpenGraph?.(name);
          return;
        }
        const retrack = target?.closest('[data-bst-action="retrack"]') as HTMLElement | null;
        if (retrack) {
          const idx = Number(root.dataset.messageIndex);
          if (!Number.isNaN(idx)) {
            onRetrackMessage?.(idx);
          }
          return;
        }
        const collapse = target?.closest('[data-bst-action="toggle-all-collapse"]') as HTMLElement | null;
        if (collapse) {
          const idx = Number(root.dataset.messageIndex);
          if (Number.isNaN(idx)) return;
          const nextCollapsed = !root.classList.contains("bst-root-collapsed");
          root.classList.toggle("bst-root-collapsed", nextCollapsed);
          if (nextCollapsed) {
            collapsedTrackerMessages.add(idx);
          } else {
            collapsedTrackerMessages.delete(idx);
          }
          collapse.setAttribute("aria-expanded", String(!nextCollapsed));
          collapse.setAttribute("title", nextCollapsed ? "Expand all trackers" : "Collapse all trackers");
          collapse.innerHTML = nextCollapsed ? "&#9656; Expand all" : "&#9662; Collapse all";
          return;
        }
      });
    }
    root.classList.toggle("bst-root-collapsed", collapsedTrackerMessages.has(entry.messageIndex));

    if (uiState.phase === "generating" && uiState.messageIndex === entry.messageIndex) {
      const loadingBox = document.createElement("div");
      loadingBox.className = "bst-loading";
      loadingBox.innerHTML = `
        <div class="bst-loading-row">
          <span>AI message is generating</span>
          <span>running</span>
        </div>
        <div class="bst-loading-track bst-loading-track-indeterminate"><div class="bst-loading-fill"></div></div>
        <div class="bst-loading-sub">Tracker will run after generation finishes.</div>
      `;
      root.appendChild(loadingBox);
      continue;
    }

    if (uiState.phase === "extracting" && uiState.messageIndex === entry.messageIndex) {
      const total = Math.max(1, uiState.total);
      const done = Math.max(0, Math.min(total, uiState.done));
      const ratio = Math.max(0, Math.min(1, done / total));
      const percent = Math.round(ratio * 100);
      const left = `stage ${Math.min(done + 1, total)}/${total}`;
      let title = "Preparing tracker context";
      let subtitle = "Collecting recent messages and active characters.";
      if (done === 1) {
        title = "Requesting relationship analysis";
        subtitle = "Sending extraction prompt to backend/profile.";
      } else if (done >= 2) {
        title = "Parsing and applying tracker update";
        subtitle = "Validating AI delta output and updating relationship state.";
      }
      const loadingBox = document.createElement("div");
      loadingBox.className = "bst-loading";
      loadingBox.innerHTML = `
        <div class="bst-loading-row">
          <span>${title}</span>
          <span>${left} (${percent}%)</span>
        </div>
        <div class="bst-loading-track"><div class="bst-loading-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
        <div class="bst-loading-sub">${subtitle}</div>
      `;
      root.appendChild(loadingBox);
      continue;
    }

    const data = entry.data;
    if (!data) {
      root.style.display = "none";
      continue;
    }

    const showRetrack = latestAiIndex != null && entry.messageIndex === latestAiIndex;
    {
      const collapsed = root.classList.contains("bst-root-collapsed");
      const actions = document.createElement("div");
      actions.className = "bst-root-actions";
      actions.innerHTML = `
        <button class="bst-mini-btn" data-bst-action="toggle-all-collapse" title="${collapsed ? "Expand all trackers" : "Collapse all trackers"}" aria-expanded="${String(!collapsed)}">${collapsed ? "&#9656; Expand all" : "&#9662; Collapse all"}</button>
        ${showRetrack ? `<button class="bst-mini-btn bst-mini-btn-icon bst-mini-btn-accent" data-bst-action="retrack" title="Retrack latest AI message" aria-label="Retrack latest AI message">&#x21BB;</button>` : ""}
      `;
      root.appendChild(actions);
    }

    const activeSet = new Set(data.activeCharacters.map(normalizeName));
    const hasAnyStatFor = (name: string): boolean =>
      data.statistics.affection?.[name] !== undefined ||
      data.statistics.trust?.[name] !== undefined ||
      data.statistics.desire?.[name] !== undefined ||
      data.statistics.connection?.[name] !== undefined ||
      data.statistics.mood?.[name] !== undefined ||
      data.statistics.lastThought?.[name] !== undefined;
    const forceAllInGroup = isGroupChat;
    const displayPool =
      (forceAllInGroup || settings.showInactive) && allCharacters.length > 0
        ? allCharacters
        : data.activeCharacters;
    const targets = displayPool.filter(name => hasAnyStatFor(name) || activeSet.has(normalizeName(name)));

    for (const name of targets) {
      const isActive = activeSet.has(normalizeName(name));
      if (!isActive && !settings.showInactive) continue;

      const previousData = findPreviousData(entry.messageIndex);
      const moodText = String(data.statistics.mood?.[name] ?? "Neutral");
      const prevMood = String(previousData?.statistics.mood?.[name] ?? moodText);
      const moodTrend = prevMood === moodText ? "stable" : "shifted";
      const card = document.createElement("div");
      card.className = `bst-card${isActive ? "" : " bst-card-inactive"}`;
      card.style.setProperty("--bst-card-local", palette[name] ?? colorFromName(name));
      const affectionShort = toPercent(data.statistics.affection?.[name] ?? numericFallbackForStat("affection", settings));
      const trustShort = toPercent(data.statistics.trust?.[name] ?? numericFallbackForStat("trust", settings));
      const desireShort = toPercent(data.statistics.desire?.[name] ?? numericFallbackForStat("desire", settings));
      const connectionShort = toPercent(data.statistics.connection?.[name] ?? numericFallbackForStat("connection", settings));
      card.innerHTML = `
        <div class="bst-head">
          <div class="bst-name">${name}</div>
          <div class="bst-actions">
            <button class="bst-mini-btn" data-bst-action="graph" data-character="${name}" title="Open relationship graph"><span aria-hidden="true">&#128200;</span> Graph</button>
            <div class="bst-state">${isActive ? "Active" : settings.inactiveLabel}</div>
          </div>
        </div>
        <div class="bst-collapsed-summary" title="Affection / Trust / Desire / Connection">
          <span>A ${affectionShort}%</span>
          <span>T ${trustShort}%</span>
          <span>D ${desireShort}%</span>
          <span>C ${connectionShort}%</span>
          <span class="bst-collapsed-mood" title="${moodText}">${moodToEmojiEntity(moodText)}</span>
        </div>
        <div class="bst-body">
        ${statLabels.map(({ key, label }) => {
          const value = toPercent(data.statistics[key]?.[name] ?? numericFallbackForStat(key, settings));
          const prevValue = toPercent(previousData?.statistics[key]?.[name] ?? value);
          const delta = Math.round(value - prevValue);
          const deltaClass = delta > 0 ? "bst-delta bst-delta-up" : delta < 0 ? "bst-delta bst-delta-down" : "bst-delta bst-delta-flat";
          const showDelta = latestAiIndex != null && entry.messageIndex === latestAiIndex;
          return `
            <div class="bst-row">
              <div class="bst-label"><span>${label}</span><span>${value}%${showDelta ? `<span class="${deltaClass}">${formatDelta(delta)}</span>` : ""}</span></div>
              <div class="bst-track"><div class="bst-fill" style="width:${value}%"></div></div>
            </div>
          `;
        }).join("")}
        <div class="bst-mood" title="${moodText} (${moodTrend})">
          <div class="bst-mood-wrap">
            <span class="bst-mood-emoji">${moodToEmojiEntity(moodText)}</span>
            <span class="bst-mood-badge" style="background:${moodBadgeColor(moodText)};">${moodText} (${moodTrend})</span>
          </div>
        </div>
        ${settings.showLastThought ? `<div class="bst-thought">${String(data.statistics.lastThought?.[name] ?? "")}</div>` : ""}
        </div>
      `;
      root.appendChild(card);
    }
  }
}

export function removeTrackerUI(): void {
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach(el => el.remove());
  document.getElementById(STYLE_ID)?.remove();
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
  closeGraphModal();
}

function statValue(entry: TrackerData, stat: "affection" | "trust" | "desire" | "connection", character: string): number {
  const raw = Number(entry.statistics[stat]?.[character] ?? 0);
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

function hasCharacterSnapshot(entry: TrackerData, character: string): boolean {
  return (
    entry.statistics.affection?.[character] !== undefined ||
    entry.statistics.trust?.[character] !== undefined ||
    entry.statistics.desire?.[character] !== undefined ||
    entry.statistics.connection?.[character] !== undefined ||
    entry.statistics.mood?.[character] !== undefined ||
    entry.statistics.lastThought?.[character] !== undefined
  );
}

function buildStatSeries(
  timeline: TrackerData[],
  character: string,
  stat: "affection" | "trust" | "desire" | "connection",
): number[] {
  let carry = 50;
  return timeline.map(item => {
    const raw = item.statistics[stat]?.[character];
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        carry = Math.max(0, Math.min(100, n));
      }
    }
    return carry;
  });
}

function smoothSeries(values: number[], windowSize = 3): number[] {
  if (values.length <= 2 || windowSize <= 1) return values;
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j];
      count += 1;
    }
    if (count === 0) return values[i];
    return sum / count;
  });
}

const GRAPH_SMOOTH_KEY = "bst-graph-smoothing";
const GRAPH_WINDOW_KEY = "bst-graph-window";
type GraphWindow = "30" | "60" | "120" | "all";

function getGraphSmoothingPreference(): boolean {
  try {
    return localStorage.getItem(GRAPH_SMOOTH_KEY) === "1";
  } catch {
    return false;
  }
}

function setGraphSmoothingPreference(enabled: boolean): void {
  try {
    localStorage.setItem(GRAPH_SMOOTH_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

function getGraphWindowPreference(): GraphWindow {
  try {
    const raw = String(localStorage.getItem(GRAPH_WINDOW_KEY) ?? "all");
    if (raw === "30" || raw === "60" || raw === "120" || raw === "all") return raw;
  } catch {
    // ignore
  }
  return "all";
}

function setGraphWindowPreference(windowSize: GraphWindow): void {
  try {
    localStorage.setItem(GRAPH_WINDOW_KEY, windowSize);
  } catch {
    // ignore
  }
}

export function getGraphPreferences(): { window: GraphWindow; smoothing: boolean } {
  return {
    window: getGraphWindowPreference(),
    smoothing: getGraphSmoothingPreference()
  };
}

function downsampleIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>([0, length - 1]);
  const step = (length - 1) / (target - 1);
  for (let i = 1; i < target - 1; i += 1) {
    out.add(Math.round(i * step));
  }
  return Array.from(out).sort((a, b) => a - b);
}

function downsampleTimeline(values: TrackerData[], target = 140): TrackerData[] {
  if (values.length <= target) return values;
  const indexes = downsampleIndices(values.length, target);
  return indexes.map(i => values[i]);
}

function buildPolyline(values: number[], width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `${x},${y}`;
  }).join(" ");
}

function buildPointCircles(values: number[], color: string, _stat: string, width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `<circle cx="${x}" cy="${y}" r="2.7" fill="${color}" />`;
  }).join("");
}

export function openGraphModal(input: {
  character: string;
  history: TrackerData[];
  accentColor: string;
  debug?: boolean;
}): void {
  ensureStyles();
  closeGraphModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-graph-backdrop";
  backdrop.addEventListener("click", () => closeGraphModal());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = "bst-graph-modal";

  const timeline = [...input.history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item => hasCharacterSnapshot(item, input.character));
  const rawSnapshotCount = timeline.length;
  const windowPreference = getGraphWindowPreference();
  const windowSize = windowPreference === "all" ? null : Number(windowPreference);
  const windowedTimeline = windowSize ? timeline.slice(-windowSize) : timeline;
  const renderedTimeline = downsampleTimeline(windowedTimeline, 140);
  const points = {
    affection: buildStatSeries(renderedTimeline, input.character, "affection"),
    trust: buildStatSeries(renderedTimeline, input.character, "trust"),
    desire: buildStatSeries(renderedTimeline, input.character, "desire"),
    connection: buildStatSeries(renderedTimeline, input.character, "connection"),
  };

  const width = 780;
  const height = 320;
  let smoothing = getGraphSmoothingPreference();
  const lineSeries = {
    affection: smoothing ? smoothSeries(points.affection, 3) : points.affection,
    trust: smoothing ? smoothSeries(points.trust, 3) : points.trust,
    desire: smoothing ? smoothSeries(points.desire, 3) : points.desire,
    connection: smoothing ? smoothSeries(points.connection, 3) : points.connection,
  };
  const affectionLine = buildPolyline(lineSeries.affection, width, height);
  const trustLine = buildPolyline(lineSeries.trust, width, height);
  const desireLine = buildPolyline(lineSeries.desire, width, height);
  const connectionLine = buildPolyline(lineSeries.connection, width, height);
  const affectionDots = buildPointCircles(points.affection, "#ff6b81", "affection", width, height);
  const trustDots = buildPointCircles(points.trust, "#55d5ff", "trust", width, height);
  const desireDots = buildPointCircles(points.desire, "#ffb347", "desire", width, height);
  const connectionColor = input.accentColor || "#9cff8f";
  const connectionDots = buildPointCircles(points.connection, connectionColor, "connection", width, height);
  const latest = {
    affection: points.affection.at(-1) ?? 0,
    trust: points.trust.at(-1) ?? 0,
    desire: points.desire.at(-1) ?? 0,
    connection: points.connection.at(-1) ?? 0,
  };
  const snapshotCount = renderedTimeline.length;

  if (input.debug) {
    console.log("[BetterSimTracker] graph-open", {
      character: input.character,
      snapshotCount,
      rawSnapshotCount,
      windowPreference,
      latest
    });
  }

  modal.innerHTML = `
    <div class="bst-graph-top">
      <div class="bst-graph-title">${input.character} Relationship Trend</div>
      <button class="bst-btn bst-close-btn" data-action="close" title="Close graph" aria-label="Close graph">&times;</button>
    </div>
    <div class="bst-graph-controls">
      <label class="bst-graph-toggle" title="Display history range">
        <span>History</span>
        <select class="bst-graph-window-select" data-action="window">
          <option value="30" ${windowPreference === "30" ? "selected" : ""}>30</option>
          <option value="60" ${windowPreference === "60" ? "selected" : ""}>60</option>
          <option value="120" ${windowPreference === "120" ? "selected" : ""}>120</option>
          <option value="all" ${windowPreference === "all" ? "selected" : ""}>All</option>
        </select>
      </label>
      <label class="bst-graph-toggle" title="Toggle smoothed graph lines">
        <input type="checkbox" data-action="toggle-smoothing" ${smoothing ? "checked" : ""}>
        <span class="bst-graph-toggle-switch"></span>
        <span>Smoothed</span>
      </label>
    </div>
    <svg class="bst-graph-svg" viewBox="0 0 ${width} ${height}" width="100%" height="320">
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.25)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.25)}" stroke="rgba(255,255,255,0.11)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.5)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.5)}" stroke="rgba(255,255,255,0.11)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.75)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.75)}" stroke="rgba(255,255,255,0.11)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24}" x2="${width - 24}" y2="${height - 24}" stroke="rgba(255,255,255,0.25)" stroke-width="1"></line>
      <line x1="24" y1="24" x2="24" y2="${height - 24}" stroke="rgba(255,255,255,0.25)" stroke-width="1"></line>
      <text x="8" y="${height - 24}" fill="rgba(255,255,255,0.75)" font-size="10">0</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.25)}" fill="rgba(255,255,255,0.75)" font-size="10">25</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.5)}" fill="rgba(255,255,255,0.75)" font-size="10">50</text>
      <text x="4" y="${height - 24 - ((height - 48) * 0.75)}" fill="rgba(255,255,255,0.75)" font-size="10">75</text>
      <text x="2" y="28" fill="rgba(255,255,255,0.75)" font-size="10">100</text>
      <text x="${width - 24}" y="14" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">Y: Relationship %</text>
      <text x="24" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10">1</text>
      <text x="${Math.round(width / 2)}" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="middle">${Math.max(1, Math.ceil(snapshotCount / 2))}</text>
      <text x="${width - 24}" y="${height - 8}" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">${Math.max(1, snapshotCount)}</text>
      <text x="${width - 24}" y="26" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="end">X: Chat Timeline</text>
      <polyline points="${affectionLine}" fill="none" stroke="#ff6b81" stroke-width="2.5"></polyline>
      <polyline points="${trustLine}" fill="none" stroke="#55d5ff" stroke-width="2.5"></polyline>
      <polyline points="${desireLine}" fill="none" stroke="#ffb347" stroke-width="2.5"></polyline>
      <polyline points="${connectionLine}" fill="none" stroke="${connectionColor}" stroke-width="2.5"></polyline>
      ${affectionDots}
      ${trustDots}
      ${desireDots}
      ${connectionDots}
      ${snapshotCount === 0 ? `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="rgba(255,255,255,0.65)" font-size="13" text-anchor="middle">No tracker history yet</text>` : ""}
    </svg>
    <div class="bst-graph-legend">
      <span><i class="bst-legend-dot" style="background:#ff6b81;"></i>Affection ${Math.round(latest.affection)}</span>
      <span><i class="bst-legend-dot" style="background:#55d5ff;"></i>Trust ${Math.round(latest.trust)}</span>
      <span><i class="bst-legend-dot" style="background:#ffb347;"></i>Desire ${Math.round(latest.desire)}</span>
      <span><i class="bst-legend-dot" style="background:${connectionColor};"></i>Connection ${Math.round(latest.connection)}</span>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => closeGraphModal());
  modal.querySelector('[data-action="toggle-smoothing"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLInputElement;
    setGraphSmoothingPreference(Boolean(target.checked));
    closeGraphModal();
    openGraphModal(input);
  });
  modal.querySelector('[data-action="window"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLSelectElement;
    const next = target.value === "30" || target.value === "60" || target.value === "120" || target.value === "all"
      ? target.value
      : "all";
    setGraphWindowPreference(next);
    closeGraphModal();
    openGraphModal(input);
  });
}

export function closeGraphModal(): void {
  document.querySelector(".bst-graph-backdrop")?.remove();
  document.querySelector(".bst-graph-modal")?.remove();
}

export function openSettingsModal(input: {
  settings: BetterSimTrackerSettings;
  profileOptions: ConnectionProfileOption[];
  debugRecord?: DeltaDebugRecord | null;
  injectedPrompt?: string;
  onSave: (next: BetterSimTrackerSettings) => void;
  onRetrack?: () => void;
  onClearCurrentChat?: () => void;
  onDumpDiagnostics?: () => void;
  onClearDiagnostics?: () => void;
}): void {
  ensureStyles();
  closeSettingsModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-settings-backdrop";
  backdrop.addEventListener("click", () => closeSettingsModal());
  document.body.appendChild(backdrop);

  const profileMap = new Map<string, string>();
  for (const option of input.profileOptions) {
    profileMap.set(option.id, option.label);
  }
  if (input.settings.connectionProfile && !profileMap.has(input.settings.connectionProfile)) {
    profileMap.set(input.settings.connectionProfile, `${input.settings.connectionProfile} (current)`);
  }

  const profileOptionsHtml = [
    `<option value="">Use active connection</option>`,
    ...Array.from(profileMap.entries()).map(([id, label]) => `<option value="${id}">${label}</option>`)
  ].join("");

  const modal = document.createElement("div");
  modal.className = "bst-settings";
  modal.innerHTML = `
    <div class="bst-settings-top">
      <div>
        <h3>BetterSimTracker Settings</h3>
        <p class="bst-settings-subtitle">Changes are saved automatically.</p>
      </div>
      <button class="bst-btn bst-close-btn" data-action="close" title="Close settings" aria-label="Close settings">&times;</button>
    </div>
    <div class="bst-settings-section">
      <h4>Quick Help</h4>
      <div class="bst-help-line"><strong>Extraction mode:</strong> Unified = faster single request. Sequential = one request per stat (more robust, slower).</div>
      <ul class="bst-help-list">
        <li><strong>Affection:</strong> emotional warmth and care</li>
        <li><strong>Trust:</strong> safety and willingness to be vulnerable</li>
        <li><strong>Desire:</strong> attraction/flirt tension</li>
        <li><strong>Connection:</strong> bond depth and emotional attunement</li>
      </ul>
      <div class="bst-help-line"><strong>Mood</strong> is short-term tone. <strong>Last Thought</strong> is one brief internal line for continuity.</div>
    </div>
    <div class="bst-settings-section">
      <h4>Extraction</h4>
      <div class="bst-settings-grid">
        <label>Connection Profile <select data-k="connectionProfile">${profileOptionsHtml}</select></label>
        <label class="bst-check"><input data-k="sequentialExtraction" type="checkbox">Sequential Extraction (per stat)</label>
        <label data-bst-row="maxConcurrentCalls">Max Concurrent Requests <input data-k="maxConcurrentCalls" type="number" min="1" max="8"></label>
        <label class="bst-check"><input data-k="strictJsonRepair" type="checkbox">Strict JSON Repair</label>
        <label data-bst-row="maxRetriesPerStat">Max Retries Per Stat <input data-k="maxRetriesPerStat" type="number" min="0" max="4"></label>
        <label>Context Messages <input data-k="contextMessages" type="number" min="1" max="40"></label>
        <label>Max Delta Per Turn <input data-k="maxDeltaPerTurn" type="number" min="1" max="30"></label>
        <label>Confidence Dampening <input data-k="confidenceDampening" type="number" min="0" max="1" step="0.05"></label>
        <label>Mood Stickiness <input data-k="moodStickiness" type="number" min="0" max="1" step="0.05"></label>
        <label class="bst-check"><input data-k="injectTrackerIntoPrompt" type="checkbox">Inject Tracker Into Prompt</label>
        <label class="bst-check"><input data-k="autoDetectActive" type="checkbox">Auto Detect Active</label>
        <label data-bst-row="activityLookback">Activity Lookback <input data-k="activityLookback" type="number" min="1" max="25"></label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4>Tracked Stats</h4>
      <div class="bst-settings-grid">
        <label class="bst-check"><input data-k="trackAffection" type="checkbox">Track Affection</label>
        <label class="bst-check"><input data-k="trackTrust" type="checkbox">Track Trust</label>
        <label class="bst-check"><input data-k="trackDesire" type="checkbox">Track Desire</label>
        <label class="bst-check"><input data-k="trackConnection" type="checkbox">Track Connection</label>
        <label class="bst-check"><input data-k="trackMood" type="checkbox">Track Mood</label>
        <label class="bst-check"><input data-k="trackLastThought" type="checkbox">Track Last Thought</label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4>Display</h4>
      <div class="bst-settings-grid">
        <label class="bst-check"><input data-k="showInactive" type="checkbox">Show Inactive</label>
        <label data-bst-row="inactiveLabel">Inactive Label <input data-k="inactiveLabel" type="text"></label>
        <label class="bst-check"><input data-k="showLastThought" type="checkbox">Show Last Thought</label>
        <label>Accent Color <input data-k="accentColor" type="text"></label>
        <label>Card Opacity <input data-k="cardOpacity" type="number" min="0.1" max="1" step="0.01"></label>
        <label>Border Radius <input data-k="borderRadius" type="number" min="0" max="32"></label>
        <label>Font Size <input data-k="fontSize" type="number" min="10" max="22"></label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4>Debug</h4>
      <div class="bst-settings-grid">
        <label class="bst-check"><input data-k="debug" type="checkbox">Debug</label>
      </div>
      <div data-bst-row="debugBody">
        <div class="bst-settings-grid">
        <label class="bst-check" data-bst-row="includeContextInDiagnostics"><input data-k="includeContextInDiagnostics" type="checkbox">Include Context In Diagnostics</label>
        <label class="bst-check" data-bst-row="includeGraphInDiagnostics"><input data-k="includeGraphInDiagnostics" type="checkbox">Include Graph Data In Diagnostics</label>
        </div>
        <div class="bst-debug-actions">
          <button class="bst-btn bst-btn-soft bst-btn-icon" data-action="retrack" title="Retrack Last AI Message" aria-label="Retrack Last AI Message"><span aria-hidden="true">&#x21BB;</span></button>
          <button class="bst-btn bst-btn-danger" data-action="clear-chat" title="Delete all tracker data for the currently open chat only.">Delete Tracker Data (Current Chat)</button>
          <button class="bst-btn" data-action="dump-diagnostics" title="Collect and copy current diagnostics report to clipboard.">Dump Diagnostics</button>
          <button class="bst-btn bst-btn-danger" data-action="clear-diagnostics" title="Clear stored diagnostics traces and last debug record for this chat scope.">Clear Diagnostics</button>
        </div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Extraction Debug Record</div>
        <div class="bst-debug-box">${input.debugRecord ? JSON.stringify(input.debugRecord, null, 2) : "No debug record yet."}</div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Injected Prompt Block</div>
        <div class="bst-debug-box">${input.injectedPrompt?.trim() ? input.injectedPrompt : "No injected prompt currently active."}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const set = (key: keyof BetterSimTrackerSettings, value: string): void => {
    const node = modal.querySelector(`[data-k="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!node) return;
    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      node.checked = value === "true";
      return;
    }
    node.value = value;
  };

  set("connectionProfile", input.settings.connectionProfile);
  set("sequentialExtraction", String(input.settings.sequentialExtraction));
  set("maxConcurrentCalls", String(input.settings.maxConcurrentCalls));
  set("strictJsonRepair", String(input.settings.strictJsonRepair));
  set("maxRetriesPerStat", String(input.settings.maxRetriesPerStat));
  set("contextMessages", String(input.settings.contextMessages));
  set("maxDeltaPerTurn", String(input.settings.maxDeltaPerTurn));
  set("confidenceDampening", String(input.settings.confidenceDampening));
  set("moodStickiness", String(input.settings.moodStickiness));
  set("injectTrackerIntoPrompt", String(input.settings.injectTrackerIntoPrompt));
  set("autoDetectActive", String(input.settings.autoDetectActive));
  set("activityLookback", String(input.settings.activityLookback));
  set("showInactive", String(input.settings.showInactive));
  set("inactiveLabel", input.settings.inactiveLabel);
  set("showLastThought", String(input.settings.showLastThought));
  set("trackAffection", String(input.settings.trackAffection));
  set("trackTrust", String(input.settings.trackTrust));
  set("trackDesire", String(input.settings.trackDesire));
  set("trackConnection", String(input.settings.trackConnection));
  set("trackMood", String(input.settings.trackMood));
  set("trackLastThought", String(input.settings.trackLastThought));
  set("accentColor", input.settings.accentColor);
  set("cardOpacity", String(input.settings.cardOpacity));
  set("borderRadius", String(input.settings.borderRadius));
  set("fontSize", String(input.settings.fontSize));
  set("debug", String(input.settings.debug));
  set("includeContextInDiagnostics", String(input.settings.includeContextInDiagnostics));
  set("includeGraphInDiagnostics", String(input.settings.includeGraphInDiagnostics));

  const collectSettings = (): BetterSimTrackerSettings => {
    const read = (k: keyof BetterSimTrackerSettings): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readBool = (k: keyof BetterSimTrackerSettings): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      return read(k) === "true";
    };
    const readNumber = (k: keyof BetterSimTrackerSettings, fallback: number, min?: number, max?: number): number => {
      const n = Number(read(k));
      if (Number.isNaN(n)) return fallback;
      let v = n;
      if (typeof min === "number") v = Math.max(min, v);
      if (typeof max === "number") v = Math.min(max, v);
      return v;
    };

    return {
      ...input.settings,
      connectionProfile: read("connectionProfile"),
      sequentialExtraction: readBool("sequentialExtraction"),
      maxConcurrentCalls: readNumber("maxConcurrentCalls", input.settings.maxConcurrentCalls, 1, 8),
      strictJsonRepair: readBool("strictJsonRepair"),
      maxRetriesPerStat: readNumber("maxRetriesPerStat", input.settings.maxRetriesPerStat, 0, 4),
      contextMessages: readNumber("contextMessages", input.settings.contextMessages, 1, 40),
      maxDeltaPerTurn: readNumber("maxDeltaPerTurn", input.settings.maxDeltaPerTurn, 1, 30),
      confidenceDampening: readNumber("confidenceDampening", input.settings.confidenceDampening, 0, 1),
      moodStickiness: readNumber("moodStickiness", input.settings.moodStickiness, 0, 1),
      injectTrackerIntoPrompt: readBool("injectTrackerIntoPrompt"),
      autoDetectActive: readBool("autoDetectActive"),
      activityLookback: readNumber("activityLookback", input.settings.activityLookback, 1, 25),
      showInactive: readBool("showInactive"),
      inactiveLabel: read("inactiveLabel") || input.settings.inactiveLabel,
      showLastThought: readBool("showLastThought"),
      trackAffection: readBool("trackAffection"),
      trackTrust: readBool("trackTrust"),
      trackDesire: readBool("trackDesire"),
      trackConnection: readBool("trackConnection"),
      trackMood: readBool("trackMood"),
      trackLastThought: readBool("trackLastThought"),
      accentColor: read("accentColor") || input.settings.accentColor,
      cardOpacity: readNumber("cardOpacity", input.settings.cardOpacity, 0.1, 1),
      borderRadius: readNumber("borderRadius", input.settings.borderRadius, 0, 32),
      fontSize: readNumber("fontSize", input.settings.fontSize, 10, 22),
      debug: readBool("debug"),
      includeContextInDiagnostics: readBool("includeContextInDiagnostics"),
      includeGraphInDiagnostics: readBool("includeGraphInDiagnostics")
    };
  };

  const syncExtractionVisibility = (): void => {
    const maxConcurrentRow = modal.querySelector('[data-bst-row="maxConcurrentCalls"]') as HTMLElement | null;
    const maxRetriesRow = modal.querySelector('[data-bst-row="maxRetriesPerStat"]') as HTMLElement | null;
    const lookbackRow = modal.querySelector('[data-bst-row="activityLookback"]') as HTMLElement | null;
    const inactiveLabelRow = modal.querySelector('[data-bst-row="inactiveLabel"]') as HTMLElement | null;
    const debugBodyRow = modal.querySelector('[data-bst-row="debugBody"]') as HTMLElement | null;
    const contextDiagRow = modal.querySelector('[data-bst-row="includeContextInDiagnostics"]') as HTMLElement | null;
    const graphDiagRow = modal.querySelector('[data-bst-row="includeGraphInDiagnostics"]') as HTMLElement | null;
    const current = collectSettings();
    if (maxConcurrentRow) {
      maxConcurrentRow.style.display = current.sequentialExtraction ? "flex" : "none";
      maxConcurrentRow.style.flexDirection = "column";
      maxConcurrentRow.style.gap = "4px";
    }
    if (maxRetriesRow) {
      maxRetriesRow.style.display = current.strictJsonRepair ? "flex" : "none";
      maxRetriesRow.style.flexDirection = "column";
      maxRetriesRow.style.gap = "4px";
    }
    if (lookbackRow) {
      lookbackRow.style.display = current.autoDetectActive ? "flex" : "none";
      lookbackRow.style.flexDirection = "column";
      lookbackRow.style.gap = "4px";
    }
    if (inactiveLabelRow) {
      inactiveLabelRow.style.display = current.showInactive ? "flex" : "none";
      inactiveLabelRow.style.flexDirection = "column";
      inactiveLabelRow.style.gap = "4px";
    }
    if (debugBodyRow) {
      debugBodyRow.style.display = current.debug ? "block" : "none";
    }
    if (contextDiagRow) {
      contextDiagRow.style.display = current.debug ? "flex" : "none";
    }
    if (graphDiagRow) {
      graphDiagRow.style.display = current.debug ? "flex" : "none";
    }
  };

  const persistLive = (): void => {
    const next = collectSettings();
    input.settings = next;
    input.onSave(next);
    syncExtractionVisibility();
  };

  modal.querySelectorAll("input, select").forEach(node => {
    node.addEventListener("change", persistLive);
    if (node instanceof HTMLInputElement && node.type === "number") {
      node.addEventListener("input", persistLive);
    }
  });
  syncExtractionVisibility();
  const tooltips: Partial<Record<keyof BetterSimTrackerSettings, string>> = {
    connectionProfile: "Choose a specific SillyTavern connection profile for tracker extraction calls.",
    sequentialExtraction: "Run one extraction prompt per stat instead of one unified prompt. More robust but slower.",
    maxConcurrentCalls: "When sequential mode is enabled, number of stat requests sent in parallel.",
    strictJsonRepair: "Enable strict retry prompts when model output is not valid or missing required fields.",
    maxRetriesPerStat: "Maximum repair retries for each stat extraction stage.",
    contextMessages: "How many recent chat messages are included in tracker extraction context.",
    maxDeltaPerTurn: "Hard cap for stat change magnitude in one tracker update before confidence scaling.",
    confidenceDampening: "How strongly model confidence scales stat deltas (0 = ignore confidence, 1 = full effect).",
    moodStickiness: "Higher values keep previous mood unless confidence is strong.",
    injectTrackerIntoPrompt: "Inject current relationship state into generation prompt for behavioral coherence.",
    autoDetectActive: "Automatically decide which group characters are active in current scene.",
    activityLookback: "How many recent messages are scanned for active-speaker detection.",
    trackAffection: "Enable Affection stat extraction and updates.",
    trackTrust: "Enable Trust stat extraction and updates.",
    trackDesire: "Enable Desire stat extraction and updates.",
    trackConnection: "Enable Connection stat extraction and updates.",
    trackMood: "Enable mood extraction and mood display updates.",
    trackLastThought: "Enable hidden short internal thought extraction.",
    showInactive: "Show tracker cards for inactive/off-screen characters.",
    inactiveLabel: "Text label shown on cards for inactive characters.",
    showLastThought: "Show extracted last thought text inside tracker cards.",
    accentColor: "Accent color for fills, highlights, and action emphasis.",
    cardOpacity: "Overall tracker container opacity.",
    borderRadius: "Corner roundness for tracker cards and controls.",
    fontSize: "Base font size used inside tracker cards.",
    debug: "Enable verbose diagnostics logging for troubleshooting.",
    includeContextInDiagnostics: "Include extraction prompt/context text in diagnostics dumps (larger logs).",
    includeGraphInDiagnostics: "Include graph-open series payloads in diagnostics trace output."
  };
  for (const [key, tooltip] of Object.entries(tooltips) as Array<[keyof BetterSimTrackerSettings, string]>) {
    const inputNode = modal.querySelector(`[data-k="${key}"]`) as HTMLElement | null;
    if (!inputNode) continue;
    inputNode.setAttribute("title", tooltip);
    const labelNode = inputNode.closest("label");
    labelNode?.setAttribute("title", tooltip);
  }

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    persistLive();
    closeSettingsModal();
  });

  modal.querySelector('[data-action="retrack"]')?.addEventListener("click", () => {
    persistLive();
    input.onRetrack?.();
  });

  modal.querySelector('[data-action="clear-chat"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearCurrentChat?.();
  });

  modal.querySelector('[data-action="dump-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onDumpDiagnostics?.();
  });

  modal.querySelector('[data-action="clear-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearDiagnostics?.();
  });
}

export function closeSettingsModal(): void {
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
}
