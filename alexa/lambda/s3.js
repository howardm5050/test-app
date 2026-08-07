"use strict";

// The AWS SDK v3 is bundled in the Node.js 18/20 Lambda runtimes.
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({});

const CACHE_MS = 2 * 60 * 1000;
const cache = new Map(); // key -> { body, fetchedAt }

/**
 * Fetch an S3 object as a string, cached for 2 minutes across warm
 * invocations. Returns { body, fresh } or null if unavailable and never
 * previously fetched. On fetch failure, falls back to the last cached copy.
 */
async function getS3Text(bucket, key) {
  const cacheKey = `${bucket}/${key}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return { body: cached.body, fresh: true };
  }
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await res.Body.transformToString();
    cache.set(cacheKey, { body, fetchedAt: Date.now() });
    return { body, fresh: true };
  } catch (err) {
    console.error(`S3 fetch failed for ${cacheKey}:`, err.message);
    if (cached) {
      return { body: cached.body, fresh: false };
    }
    return null;
  }
}

module.exports = { getS3Text };
