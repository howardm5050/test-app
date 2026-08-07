#!/usr/bin/env node
"use strict";

/**
 * Publish Winston's current state to S3 for the Echo Show control center.
 *
 * Builds dashboard.json (the board) and context.md (memory bundle for the
 * voice assistant) from a Winston working directory, then uploads both to a
 * private S3 bucket.
 *
 * Usage:
 *   node publish-winston.js [--dir <winston folder>] [--bucket <name>] [--dry-run]
 *
 * Env fallbacks: WINSTON_DIR, WINSTON_S3_BUCKET, AWS_REGION.
 * Uses your local AWS credentials (aws configure / SSO / env vars).
 */

const fs = require("fs");
const path = require("path");
const { buildDashboard, buildContext } = require("./build-dashboard");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const winstonDir = getArg("--dir") || process.env.WINSTON_DIR || process.cwd();
  const bucket = getArg("--bucket") || process.env.WINSTON_S3_BUCKET;
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Winston dir: ${winstonDir}`);
  const dashboard = buildDashboard(winstonDir);
  const context = buildContext(winstonDir);

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const dashboardJson = JSON.stringify(dashboard, null, 2);
  fs.writeFileSync(path.join(outDir, "dashboard.json"), dashboardJson);
  if (context) {
    fs.writeFileSync(path.join(outDir, "context.md"), context);
  }

  const overdueCount = dashboard.overdue.length;
  const pipelineCount = dashboard.pipeline.length;
  const itemCount = dashboard.buckets.reduce((n, b) => n + b.items.length, 0);
  console.log(
    `Built dashboard: ${itemCount} plan items, ${overdueCount} overdue, ` +
      `${pipelineCount} pipeline flags. Context: ${
        context ? `${context.length} chars` : "none (no files found)"
      }.`
  );

  if (dryRun) {
    console.log(`Dry run — wrote files to ${outDir}, skipping upload.`);
    return;
  }

  if (!bucket) {
    console.error(
      "No bucket. Pass --bucket <name> or set WINSTON_S3_BUCKET. " +
        "(Use --dry-run to just build the files.)"
    );
    process.exit(1);
  }

  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  // Fall back to us-east-1 (where the SAM stack deploys) when the local AWS
  // config has no default region set.
  const s3 = new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "dashboard.json",
      Body: dashboardJson,
      ContentType: "application/json",
    })
  );
  console.log(`Uploaded s3://${bucket}/dashboard.json`);

  if (context) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "context.md",
        Body: context,
        ContentType: "text/markdown",
      })
    );
    console.log(`Uploaded s3://${bucket}/context.md`);
  }

  console.log("Done. The Echo Show picks this up within 2 minutes.");
}

main().catch((err) => {
  console.error("Publish failed:", err.message);
  process.exit(1);
});
