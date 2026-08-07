"use strict";

const fs = require("fs");
const path = require("path");

const TZ = "America/Los_Angeles";

function todayInLA() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${parts}T00:00:00`);
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/** Parse "2026-08-07", "8/4", "6/26", "Fri 8/7", "TODAY 8/7" into a Date. */
function parseDate(text, today) {
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
  const md = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (md) {
    const month = String(md[1]).padStart(2, "0");
    const day = String(md[2]).padStart(2, "0");
    return new Date(`${today.getFullYear()}-${month}-${day}T00:00:00`);
  }
  return null;
}

function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}

/**
 * TASKS.md: open checkbox items with a DUE: marker anywhere in the line.
 * Red-panel rules match Winston's own "Overdue / Due Today" convention:
 * past dates, DUE: ASAP, and DUE: TODAY all qualify. Future dates don't.
 */
function parseOverdue(tasksMd, today) {
  if (!tasksMd) return [];
  const overdue = [];
  for (const line of tasksMd.split("\n")) {
    const m = line.match(/^\s*-\s*\[ \]\s*(.+)$/);
    if (!m || !/DUE:/i.test(m[1])) continue;
    const body = m[1];
    const dueMatch = body.match(/DUE:\s*(.*?)\s*$/i);
    const dueText = dueMatch
      ? dueMatch[1].replace(/\.+$/, "").trim()
      : "";

    const bold = body.match(/\*\*(.+?)\*\*/);
    let text = bold ? bold[1] : body.split(" — ")[0];
    text = truncate(text.replace(/\*\*/g, "").trim(), 80);

    const due = parseDate(dueText, today);
    const isAsap = /\basap\b/i.test(dueText);
    const isToday =
      /\btoday\b/i.test(dueText) ||
      (due && due.getTime() === today.getTime());
    const isPast = due ? due < today : false;

    if (isAsap || isToday || isPast) {
      overdue.push({ text, due: dueText || "ASAP" });
    }
  }
  return overdue;
}

/** CLAUDE.md Cadence Tracker section. Values truncated for the display. */
function parseCadence(claudeMd) {
  const cadence = {
    touchesThisWeek: 0,
    lastLinkedIn: "—",
    lastEmailPhone: "—",
    lastPipelineReview: "—",
  };
  if (!claudeMd) return cadence;
  const grab = (re) => {
    const m = claudeMd.match(re);
    return m ? truncate(m[1].trim(), 48) : null;
  };
  cadence.lastLinkedIn =
    grab(/Last LinkedIn outreach:\s*(.+)/i) || cadence.lastLinkedIn;
  cadence.lastEmailPhone =
    grab(/Last (?:email\/phone|email or phone) outreach:\s*(.+)/i) ||
    cadence.lastEmailPhone;
  cadence.lastPipelineReview =
    grab(/Last pipeline review:\s*(.+)/i) || cadence.lastPipelineReview;
  const touches = claudeMd.match(/Outreach touches this week:\s*\[?(\d+)\]?/i);
  if (touches) cadence.touchesThisWeek = parseInt(touches[1], 10);
  return cadence;
}

/**
 * Fallback pipeline source: a markdown table under a "Pipeline" heading in
 * CLAUDE.md, flagging rows past the 7-day window. Used only when the day
 * plan has no Pipeline Alerts section.
 */
function parsePipelineTable(claudeMd, today) {
  if (!claudeMd) return [];
  const flags = [];
  const lines = claudeMd.split("\n");
  let inPipeline = false;
  for (const line of lines) {
    if (/^#{1,3}\s.*pipeline/i.test(line)) {
      inPipeline = true;
      continue;
    }
    if (inPipeline && /^#{1,3}\s/.test(line)) {
      inPipeline = false;
    }
    if (!inPipeline || !line.trim().startsWith("|")) continue;
    if (/^\|[\s\-|:]+\|?$/.test(line.trim())) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, "");
    if (/^(name|opportunity|prospect|company)$/i.test(name)) continue;
    if (/check in later|dormant|dead|closed/i.test(line)) continue;
    const dates = [];
    for (const cell of cells) {
      const d = parseDate(cell, today);
      if (d) dates.push(d);
    }
    if (dates.length === 0) continue;
    const last = new Date(Math.max(...dates));
    const days = daysBetween(last, today);
    if (days > 7) {
      flags.push({
        name,
        status: `${days} days since last touch`,
        action: days >= 21 ? "3-week rule — consider Check In Later" : "Send nudge",
      });
    }
  }
  return flags;
}

/** "FCS / Dan+Keith — 8 days silent. Push toward signature." → panel entry. */
function parseAlertLine(raw) {
  const clean = raw.replace(/\*\*/g, "").trim();
  const dashIdx = clean.indexOf(" — ");
  let name = dashIdx > 0 ? clean.slice(0, dashIdx) : clean;
  let rest = dashIdx > 0 ? clean.slice(dashIdx + 3) : "";
  let status = rest;
  let action = "";
  const sentences = rest.split(/(?<=\.)\s+/).filter(Boolean);
  if (sentences.length > 1) {
    action = sentences.pop().replace(/\.+$/, "");
    status = sentences.join(" ").replace(/\.+$/, "");
  } else {
    status = rest.replace(/\.+$/, "");
  }
  return {
    name: truncate(name.trim(), 40),
    status: truncate(status.trim(), 80),
    action: truncate(action.trim(), 80),
  };
}

const BUCKET_KEYWORDS = [
  { key: /personal|faith|family/i, name: "Personal / Faith / Family" },
  { key: /money|admin/i, name: "Money / Admin" },
  { key: /medzero|med zero/i, name: "medZERO Work" },
  { key: /humboldt|consulting|advisory/i, name: "Humboldt (Consulting / Advisory)" },
];

// Day-plan sections that are NOT buckets. Checked before bucket keywords so
// "Pipeline Alerts (Humboldt)" routes to the pipeline panel, not the bucket.
const NON_BUCKET_HEADING = /pipeline|overdue|due today|cadence|gap check|strava|read memory/i;

/**
 * Parse the latest day plan into { buckets, pipelineAlerts }.
 * Bucket items come from checkbox lines under the four bucket headings;
 * pipeline alerts come from any "Pipeline" section (checkboxes or bullets).
 */
function parsePlan(planMd) {
  const buckets = BUCKET_KEYWORDS.map((b) => ({ name: b.name, items: [] }));
  const pipelineAlerts = [];
  if (!planMd) return { buckets, pipelineAlerts };

  let current = null;
  let pipelineMode = false;
  const seen = new Set();

  for (const line of planMd.split("\n")) {
    const heading = line.match(/^(?:#{1,4}|\*\*)\s*(.+?)\s*(?:\*\*)?$/);
    if (heading && !/^\s*-/.test(line)) {
      const title = heading[1];
      if (NON_BUCKET_HEADING.test(title)) {
        pipelineMode = /pipeline/i.test(title);
        current = null;
      } else {
        pipelineMode = false;
        const idx = BUCKET_KEYWORDS.findIndex((b) => b.key.test(title));
        current = idx >= 0 ? buckets[idx] : null;
      }
      continue;
    }

    const bullet = line.match(/^\s*-\s*(?:\[( |x|X)\]\s*)?(.+)$/);
    if (!bullet) continue;
    const done = (bullet[1] || " ").toLowerCase() === "x";
    const text = bullet[2].replace(/\*\*/g, "").trim();

    if (pipelineMode) {
      pipelineAlerts.push(parseAlertLine(text));
    } else if (current) {
      const key = text.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      current.items.push({ text: truncate(text, 110), done });
    }
  }
  return { buckets, pipelineAlerts };
}

const WEEKDAY_FOCUS = {
  1: "Monday — medZERO weekly sales call + pipeline",
  2: "Tuesday — LinkedIn outreach (Humboldt)",
  3: "Wednesday — medZERO execution day",
  4: "Thursday — email and phone outreach (Humboldt)",
  5: "Friday — pipeline review + follow-ups (Humboldt)",
};

function latestFile(dir, suffix) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(suffix))
      .sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

/** Build the dashboard JSON from a Winston working directory. */
function buildDashboard(winstonDir) {
  const today = todayInLA();
  const claudeMd = readIfExists(path.join(winstonDir, "CLAUDE.md"));
  const tasksMd = readIfExists(path.join(winstonDir, "TASKS.md"));
  const planPath = latestFile(path.join(winstonDir, "plans"), "-day-plan.md");
  const planMd = planPath ? readIfExists(planPath) : null;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(new Date());
  const weekdayNum = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
    weekday
  ];

  const { buckets, pipelineAlerts } = parsePlan(planMd);

  return {
    updatedAt: new Date().toISOString(),
    focus: WEEKDAY_FOCUS[weekdayNum] || "Weekend — family first",
    buckets,
    overdue: parseOverdue(tasksMd, today),
    pipeline: pipelineAlerts.length
      ? pipelineAlerts
      : parsePipelineTable(claudeMd, today),
    cadence: parseCadence(claudeMd),
  };
}

const CONTEXT_FILE_CAP = 8000;

/** Bundle Winston's working files into one context document for the Lambda. */
function buildContext(winstonDir) {
  const parts = [];
  const add = (label, filePath) => {
    const content = filePath ? readIfExists(filePath) : null;
    if (!content) return;
    const body =
      content.length > CONTEXT_FILE_CAP
        ? content.slice(0, CONTEXT_FILE_CAP) + "\n[...truncated]"
        : content;
    parts.push(`## FILE: ${label}\n\n${body}`);
  };

  add("CLAUDE.md (working memory)", path.join(winstonDir, "CLAUDE.md"));
  add("TASKS.md (task board)", path.join(winstonDir, "TASKS.md"));
  add(
    "Latest day plan",
    latestFile(path.join(winstonDir, "plans"), "-day-plan.md")
  );
  add("Latest day wrap", latestFile(path.join(winstonDir, "memory"), ".md"));

  if (parts.length === 0) return null;
  return (
    `# Winston live context — published ${new Date().toISOString()}\n\n` +
    parts.join("\n\n---\n\n")
  );
}

module.exports = { buildDashboard, buildContext };
