"use strict";

const fs = require("fs");
const path = require("path");

const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sample-dashboard.json"), "utf8")
);

// Live dashboard state is published by Winston desktop sessions as a JSON
// file (see README). Cache briefly so repeat renders in one session are fast.
const CACHE_MS = 2 * 60 * 1000;
let cache = { data: null, fetchedAt: 0 };

/**
 * Load the dashboard state.
 * Returns { data, source } where source is "live" | "stale" | "sample".
 */
async function loadDashboard() {
  const url = process.env.WINSTON_DASHBOARD_URL;
  if (!url) {
    return { data: SAMPLE, source: "sample" };
  }
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { data: cache.data, source: "live" };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    cache = { data, fetchedAt: Date.now() };
    return { data, source: "live" };
  } catch (err) {
    console.error("Dashboard fetch failed:", err);
    if (cache.data) {
      return { data: cache.data, source: "stale" };
    }
    return { data: SAMPLE, source: "sample" };
  }
}

/** Short spoken summary of the board — overdue first, then pipeline, then focus. */
function dashboardSpeech(data, source) {
  const parts = ["Control center is up."];
  const overdue = data.overdue || [];
  const pipeline = data.pipeline || [];

  if (overdue.length > 0) {
    const noun = overdue.length === 1 ? "overdue item" : "overdue items";
    parts.push(`${overdue.length} ${noun} — lead with ${overdue[0].text}.`);
  } else {
    parts.push("Nothing overdue.");
  }

  if (pipeline.length > 0) {
    const noun = pipeline.length === 1 ? "pipeline flag" : "pipeline flags";
    parts.push(`${pipeline.length} ${noun}, starting with ${pipeline[0].name}.`);
  }

  if (data.focus) {
    parts.push(`Today's focus: ${data.focus}.`);
  }

  if (source === "sample") {
    parts.push("This is sample data until the live feed is wired up.");
  } else if (source === "stale") {
    parts.push("Heads up — I could not refresh the feed, this may be stale.");
  }

  return parts.join(" ");
}

module.exports = { loadDashboard, dashboardSpeech };
