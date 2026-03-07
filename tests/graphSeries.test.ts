import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLastPointCircle,
  buildPointCircles,
  buildPolyline,
  downsampleTimeline,
  graphSeriesDomId,
  smoothSeries,
} from "../src/graphSeries";
import type { TrackerData } from "../src/types";

function makeTracker(timestamp: number): TrackerData {
  return {
    timestamp,
    activeCharacters: ["Seraphina"],
    statistics: {
      affection: {},
      trust: {},
      desire: {},
      connection: {},
      mood: {},
      lastThought: {},
    },
    customStatistics: {},
    customNonNumericStatistics: {},
  };
}

test("smoothSeries preserves size and smooths center points", () => {
  const values = [0, 100, 0, 100, 0];
  const smoothed = smoothSeries(values, 3);
  assert.equal(smoothed.length, values.length);
  assert.equal(smoothed[0], 50);
  assert.equal(smoothed[2], 200 / 3);
});

test("downsampleTimeline keeps first/last and target length", () => {
  const timeline = Array.from({ length: 200 }, (_, i) => makeTracker(i + 1));
  const sampled = downsampleTimeline(timeline, 50);
  assert.equal(sampled.length, 50);
  assert.equal(sampled[0].timestamp, 1);
  assert.equal(sampled[sampled.length - 1].timestamp, 200);
});

test("graph SVG helpers return expected shapes", () => {
  const points = [20, 40, 60];
  const polyline = buildPolyline(points, 300, 200);
  assert.ok(polyline.includes(","));

  const circles = buildPointCircles(points, "#fff", "affection", 300, 200);
  assert.ok(circles.includes("<circle"));

  const last = buildLastPointCircle(points, "#fff", 300, 200);
  assert.ok(last.includes("stroke="));

  assert.equal(graphSeriesDomId("a/b c"), "series-a-b-c");
});

