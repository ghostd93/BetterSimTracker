export type GraphWindow = "30" | "60" | "120" | "all";

const GRAPH_SMOOTH_KEY = "bst-graph-smoothing";
const GRAPH_WINDOW_KEY = "bst-graph-window";

export function getGraphSmoothingPreference(): boolean {
  try {
    return localStorage.getItem(GRAPH_SMOOTH_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGraphSmoothingPreference(enabled: boolean): void {
  try {
    localStorage.setItem(GRAPH_SMOOTH_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function getGraphWindowPreference(): GraphWindow {
  try {
    const raw = String(localStorage.getItem(GRAPH_WINDOW_KEY) ?? "all");
    if (raw === "30" || raw === "60" || raw === "120" || raw === "all") return raw;
  } catch {
    // ignore
  }
  return "all";
}

export function setGraphWindowPreference(windowSize: GraphWindow): void {
  try {
    localStorage.setItem(GRAPH_WINDOW_KEY, windowSize);
  } catch {
    // ignore
  }
}

export function getGraphPreferences(): { window: GraphWindow; smoothing: boolean } {
  return {
    window: getGraphWindowPreference(),
    smoothing: getGraphSmoothingPreference(),
  };
}

