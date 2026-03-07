import type { BetterSimTrackerSettings, TrackerData } from "./types";
import {
  buildStatSeries,
  ensureStyles,
  getNumericStatsForHistory,
  hasNumericSnapshot,
} from "./ui";
import {
  buildLastPointCircle,
  buildPointCircles,
  buildPolyline,
  downsampleTimeline,
  graphSeriesDomId,
  smoothSeries,
} from "./graphSeries";
import {
  getGraphSmoothingPreference,
  getGraphWindowPreference,
  setGraphSmoothingPreference,
  setGraphWindowPreference,
  type GraphWindow,
} from "./graphPreferences";
import { closeEditStatsModal } from "./editStatsModal";

export function openGraphModal(input: {
  character: string;
  history: TrackerData[];
  accentColor: string;
  settings: BetterSimTrackerSettings;
  debug?: boolean;
}): void {
  ensureStyles();
  closeEditStatsModal();
  closeGraphModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-graph-backdrop";
  backdrop.addEventListener("click", () => closeGraphModal());
  document.body.appendChild(backdrop);

  const modal = document.createElement("div");
  modal.className = "bst-graph-modal";

  const enabledNumeric = getNumericStatsForHistory(input.history, input.character, input.settings);
  const timeline = [...input.history]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter(item => hasNumericSnapshot(item, input.character, enabledNumeric));
  const rawSnapshotCount = timeline.length;
  const windowPreference = getGraphWindowPreference();
  const windowSize = windowPreference === "all" ? null : Number(windowPreference);
  const windowedTimeline = windowSize ? timeline.slice(-windowSize) : timeline;
  const renderedTimeline = downsampleTimeline(windowedTimeline, 140);
  const points: Record<string, number[]> = {};
  for (const def of enabledNumeric) {
    points[def.key] = buildStatSeries(renderedTimeline, input.character, def);
  }

  const width = 780;
  const height = 320;
  let smoothing = getGraphSmoothingPreference();
  const connectionColor = input.accentColor || "#9cff8f";
  const buildSeriesFrom = (seriesSource: Record<string, number[]>) => {
    const series: Record<string, number[]> = {};
    for (const def of enabledNumeric) {
      const values = seriesSource[def.key] ?? [];
      series[def.key] = smoothing ? smoothSeries(values, 3) : values;
    }
    return series;
  };
  const lineSeries = buildSeriesFrom(points);
  const lineMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    const line = buildPolyline(lineSeries[def.key] ?? [], width, height);
    return line ? `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5"></polyline>` : "";
  }).join("");
  const dotsMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    return buildPointCircles(points[def.key] ?? [], color, def.key, width, height);
  }).join("");
  const lastPointMarkup = enabledNumeric.map(def => {
    const color = def.key === "connection" ? connectionColor : def.color;
    return buildLastPointCircle(points[def.key] ?? [], color, width, height);
  }).join("");
  const latest: Record<string, number> = {};
  for (const def of enabledNumeric) {
    latest[def.key] = points[def.key]?.at(-1) ?? 0;
  }
  const snapshotCount = enabledNumeric.length ? (points[enabledNumeric[0].key]?.length ?? 0) : 0;

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
        <select class="bst-graph-window-select${windowPreference !== "all" ? " active" : ""}" data-action="window">
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
    <div class="bst-graph-canvas">
    <svg class="bst-graph-svg" viewBox="0 0 ${width} ${height}" width="100%" height="320">
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.25)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.25)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.5)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.5)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24 - ((height - 48) * 0.75)}" x2="${width - 24}" y2="${height - 24 - ((height - 48) * 0.75)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="24" y1="${height - 24}" x2="${width - 24}" y2="${height - 24}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
      <line x1="24" y1="24" x2="24" y2="${height - 24}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
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
      ${enabledNumeric.length ? lineMarkup : ""}
      ${enabledNumeric.length ? dotsMarkup : ""}
      ${enabledNumeric.length ? lastPointMarkup : ""}
      <g id="bst-graph-hover" opacity="0">
        <line id="bst-graph-hover-line" x1="0" y1="24" x2="0" y2="${height - 24}" stroke="rgba(255,255,255,0.25)" stroke-width="1"></line>
        ${enabledNumeric.map(def => {
          const color = def.key === "connection" ? connectionColor : def.color;
          return `<circle id="bst-graph-hover-${graphSeriesDomId(def.key)}" r="3.8" fill="${color}"></circle>`;
        }).join("")}
      </g>
      ${enabledNumeric.length === 0 && snapshotCount === 0
        ? `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="rgba(255,255,255,0.65)" font-size="13" text-anchor="middle">No numeric stats recorded</text>`
        : enabledNumeric.length > 0 && snapshotCount === 0
          ? `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="rgba(255,255,255,0.65)" font-size="13" text-anchor="middle">No tracker history yet</text>`
          : ""}
    </svg>
    <div class="bst-graph-tooltip" id="bst-graph-tooltip"></div>
    </div>
    <div class="bst-graph-legend">
      ${enabledNumeric.length
        ? enabledNumeric.map(def => {
            const color = def.key === "connection" ? connectionColor : def.color;
            const value = Math.round(latest[def.key] ?? 0);
            return `<span><i class="bst-legend-dot" style="background:${color};"></i>${def.label} ${value}</span>`;
          }).join("")
        : `<span class="bst-graph-legend-empty">No numeric stats recorded for this character.</span>`}
    </div>
  `;
  document.body.appendChild(modal);

  const svg = modal.querySelector(".bst-graph-svg") as SVGSVGElement | null;
  const hoverGroup = modal.querySelector("#bst-graph-hover") as SVGGElement | null;
  const hoverLine = modal.querySelector("#bst-graph-hover-line") as SVGLineElement | null;
  const hoverDots: Record<string, SVGCircleElement | null> = {};
  for (const def of enabledNumeric) {
    hoverDots[def.key] = modal.querySelector(`#bst-graph-hover-${graphSeriesDomId(def.key)}`) as SVGCircleElement | null;
  }
  const tooltip = modal.querySelector("#bst-graph-tooltip") as HTMLDivElement | null;
  const pointCount = enabledNumeric.length ? (points[enabledNumeric[0].key]?.length ?? 0) : 0;
  if (svg && hoverGroup && hoverLine && tooltip && pointCount > 0) {
    const pad = 24;
    const drawableW = Math.max(1, width - pad * 2);
    const drawableH = Math.max(1, height - pad * 2);
    const xFor = (idx: number): number =>
      pad + (pointCount === 1 ? drawableW / 2 : (drawableW * idx) / (pointCount - 1));
    const yFor = (value: number): number => pad + ((100 - value) / 100) * drawableH;
    const clampIndex = (idx: number): number => Math.max(0, Math.min(pointCount - 1, idx));
    const updateHover = (clientX: number, clientY: number): void => {
      const rect = svg.getBoundingClientRect();
      const relX = clientX - rect.left;
      const idx = clampIndex(Math.round(((relX - pad) / drawableW) * (pointCount - 1)));
      const cx = xFor(idx);

      hoverGroup.setAttribute("opacity", "1");
      hoverLine.setAttribute("x1", String(cx));
      hoverLine.setAttribute("x2", String(cx));
      for (const def of enabledNumeric) {
        const series = points[def.key] ?? [];
        const value = series[idx] ?? 0;
        hoverDots[def.key]?.setAttribute("cx", String(cx));
        hoverDots[def.key]?.setAttribute("cy", String(yFor(value)));
      }

      tooltip.classList.add("visible");
      tooltip.innerHTML = `
        <div><strong>Index:</strong> ${idx + 1}/${pointCount}</div>
        ${enabledNumeric.map(def => `<div>${def.label}: ${Math.round((points[def.key]?.[idx] ?? 0))}</div>`).join("")}
      `;
      const canvas = modal.querySelector(".bst-graph-canvas") as HTMLElement;
      const canvasRect = canvas.getBoundingClientRect();
      const localX = clientX - canvasRect.left;
      const localY = clientY - canvasRect.top;
      const tooltipWidth = tooltip.offsetWidth || 140;
      const tooltipHeight = tooltip.offsetHeight || 60;
      const left = Math.min(canvasRect.width - tooltipWidth - 8, Math.max(8, localX + 12));
      const top = Math.min(canvasRect.height - tooltipHeight - 8, Math.max(8, localY + 12));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    svg.addEventListener("mousemove", event => updateHover(event.clientX, event.clientY));
    svg.addEventListener("mouseleave", () => {
      hoverGroup.setAttribute("opacity", "0");
      tooltip.classList.remove("visible");
    });
  }

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => closeGraphModal());
  modal.querySelector('[data-action="toggle-smoothing"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLInputElement;
    setGraphSmoothingPreference(Boolean(target.checked));
    closeGraphModal();
    openGraphModal(input);
  });
  modal.querySelector('[data-action="window"]')?.addEventListener("change", event => {
    const target = event.currentTarget as HTMLSelectElement;
    const next: GraphWindow = target.value === "30" || target.value === "60" || target.value === "120" || target.value === "all"
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
