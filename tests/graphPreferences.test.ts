import test from "node:test";
import assert from "node:assert/strict";

import {
  getGraphPreferences,
  getGraphSmoothingPreference,
  getGraphWindowPreference,
  setGraphSmoothingPreference,
  setGraphWindowPreference,
} from "../src/graphPreferences";

type FakeStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function withLocalStorage(storage: FakeStorage, fn: () => void): void {
  const previous = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  }
}

test("graph preference setters/readers persist and normalize values", () => {
  const bucket = new Map<string, string>();
  const storage: FakeStorage = {
    getItem: key => bucket.has(key) ? (bucket.get(key) as string) : null,
    setItem: (key, value) => {
      bucket.set(key, value);
    },
  };

  withLocalStorage(storage, () => {
    assert.equal(getGraphSmoothingPreference(), false);
    assert.equal(getGraphWindowPreference(), "all");

    setGraphSmoothingPreference(true);
    setGraphWindowPreference("60");

    assert.equal(getGraphSmoothingPreference(), true);
    assert.equal(getGraphWindowPreference(), "60");
    assert.deepEqual(getGraphPreferences(), { window: "60", smoothing: true });

    bucket.set("bst-graph-window", "invalid");
    assert.equal(getGraphWindowPreference(), "all");
  });
});

test("graph preference readers/writers fail safely when localStorage throws", () => {
  const storage: FakeStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  withLocalStorage(storage, () => {
    assert.equal(getGraphSmoothingPreference(), false);
    assert.equal(getGraphWindowPreference(), "all");
    setGraphSmoothingPreference(true);
    setGraphWindowPreference("120");
  });
});

