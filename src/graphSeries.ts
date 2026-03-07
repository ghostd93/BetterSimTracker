import type { TrackerData } from "./types";

export function smoothSeries(values: number[], windowSize = 3): number[] {
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

function downsampleIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>([0, length - 1]);
  const step = (length - 1) / (target - 1);
  for (let i = 1; i < target - 1; i += 1) {
    out.add(Math.round(i * step));
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function downsampleTimeline(values: TrackerData[], target = 140): TrackerData[] {
  if (values.length <= target) return values;
  const indexes = downsampleIndices(values.length, target);
  return indexes.map(i => values[i]);
}

export function buildPolyline(values: number[], width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `${x},${y}`;
  }).join(" ");
}

export function buildPointCircles(values: number[], color: string, _stat: string, width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  return values.map((value, idx) => {
    const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
    const y = pad + ((100 - value) / 100) * drawableH;
    return `<circle cx="${x}" cy="${y}" r="2.7" fill="${color}" />`;
  }).join("");
}

export function buildLastPointCircle(values: number[], color: string, width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  const drawableW = Math.max(1, width - pad * 2);
  const drawableH = Math.max(1, height - pad * 2);
  const idx = values.length - 1;
  const x = pad + (values.length === 1 ? drawableW / 2 : (drawableW * idx) / (values.length - 1));
  const y = pad + ((100 - values[idx]) / 100) * drawableH;
  return `<circle cx="${x}" cy="${y}" r="4.2" fill="${color}" stroke="rgba(255,255,255,0.75)" stroke-width="1.2" />`;
}

export function graphSeriesDomId(key: string): string {
  return `series-${String(key ?? "").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
