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

/** Parse "2026-08-07", "8/4", "6/26", or "Fri 6/26" into a Date (current year for M/D). */
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

/** TASKS.md: open items with DUE: dates that have passed. */
function parseOverdue(tasksMd, today) {
  if (!tasksMd) return [];
  const overdue = [];
  const re = /^\s*-\s*\[ \]\s*(.+?)\s*—\s*DUE:\s*(.+?)\s*$/gm;
  let match;
  while ((match = re.exec(tasksMd)) !== null) {
    const text = match[1].replace(/\*\*/g, "").trim();
    const dueText = match[2].trim();
    const due = parseDate(dueText, today);
    if (due && due < today) {
      overdue.push({ text, due: dueText });
    }
  }
  return overdue;
}

/** CLAUDE.md Cadence Tracker section. */
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
    return m ? m[1].trim() : null;
  };
  cadence.lastLinkedIn =
    grab(/Last LinkedIn outreach:\s*(.+)/i) || cadence.lastLinkedIn;
  cadence.lastEmailPhone =
    grab(/Last (?:email\/phone|email or phone) outreach:\s*(.+)/i) ||
    cadence.lastEmailPhone;
  cadence.lastPipelineReview =
    grab(/Last pipeline review:\s*(.+)/i) || cadence.lastPipelineReview;
  const touches = grab(/Outreach touches this week:\s*\[?(\d+)\]?/i);
  if (touches) cadence.touchesThisWeek = parseInt(touches, 10);
  return cadence;
}

/**
 * CLAUDE.md pipeline table: flag rows whose most recent date is past the
 * follow-up window (7 days). Rows marked dormant / check-in-later are skipped.
 */
function parsePipelineFlags(claudeMd, today) {
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
    if (!inPipeline) continue;
    if (!line.trim().startsWith("|")) continue;
    if (/^\|[\s\-|:]+\|?$/.test(line.trim())) continue; // separator row
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*\*/g, "");
    if (/^(name|opportunity|prospect|company)$/i.test(name)) continue; // header
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

const BUCKET_KEYWORDS = [
  { key: /personal|faith|family/i, name: "Personal / Faith / Family" },
  { key: /money|admin/i, name: "Money / Admin" },
  { key: /medzero|med zero/i, name: "medZERO Work" },
  { key: /humboldt|consulting|advisory/i, name: "Humboldt (Consulting / Advisory)" },
];

/** Latest day plan: checkbox items grouped under the four bucket headings. */
function parseBuckets(planMd) {
  const buckets = BUCKET_KEYWORDS.map((b) => ({ name: b.name, items: [] }));
  if (!planMd) return buckets;
  let current = null;
  for (const line of planMd.split("\n")) {
    const heading = line.match(/^(?:#{1,4}|\*\*)\s*(.+?)\s*(?:\*\*)?$/);
    if (heading && !/^\s*-/.test(line)) {
      const idx = BUCKET_KEYWORDS.findIndex((b) => b.key.test(heading[1]));
      current = idx >= 0 ? buckets[idx] : null;
      continue;
    }
    const item = line.match(/^\s*-\s*\[( |x|X)\]\s*(.+)$/);
    if (item && current) {
      current.items.push({
        text: item[2].replace(/\*\*/g, "").trim(),
        done: item[1].toLowerCase() === "x",
      });
    }
  }
  return buckets;
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

  return {
    updatedAt: new Date().toISOString(),
    focus: WEEKDAY_FOCUS[weekdayNum] || "Weekend — family first",
    buckets: parseBuckets(planMd),
    overdue: parseOverdue(tasksMd, today),
    pipeline: parsePipelineFlags(claudeMd, today),
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
