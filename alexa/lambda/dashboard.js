"use strict";

const fs = require("fs");
const path = require("path");
const { getS3Text } = require("./s3");

const SAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "sample-dashboard.json"), "utf8")
);

// Live dashboard state is published by the publisher script (see
// alexa/publisher/). Preferred source is a private S3 bucket read with the
// Lambda's IAM role; an HTTPS URL is supported as a fallback.
const CACHE_MS = 2 * 60 * 1000;
let urlCache = { data: null, fetchedAt: 0 };

/**
 * Load the dashboard state.
 * Returns { data, source } where source is "live" | "stale" | "sample".
 */
async function loadDashboard() {
  const bucket = process.env.WINSTON_S3_BUCKET;
  if (bucket) {
    const key = process.env.WINSTON_DASHBOARD_KEY || "dashboard.json";
    const result = await getS3Text(bucket, key);
    if (result) {
      try {
        return {
          data: JSON.parse(result.body),
          source: result.fresh ? "live" : "stale",
        };
      } catch (err) {
        console.error("Dashboard JSON parse failed:", err.message);
      }
    }
    return { data: SAMPLE, source: "sample" };
  }

  const url = process.env.WINSTON_DASHBOARD_URL;
  if (!url) {
    return { data: SAMPLE, source: "sample" };
  }
  if (urlCache.data && Date.now() - urlCache.fetchedAt < CACHE_MS) {
    return { data: urlCache.data, source: "live" };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    urlCache = { data, fetchedAt: Date.now() };
    return { data, source: "live" };
  } catch (err) {
    console.error("Dashboard fetch failed:", err);
    if (urlCache.data) {
      return { data: urlCache.data, source: "stale" };
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
