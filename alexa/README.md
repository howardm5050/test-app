# Winston on the Echo Show 11

An Alexa custom skill that puts **Winston** — Howard's executive assistant, powered by Claude — on the Echo Show 11's display. You talk to it by voice; Winston answers out loud and renders the response on screen in a dark, glanceable layout sized for the 11" landscape display.

```
"Alexa, open winston assistant"        → opens the control center
"show my control center"               → re-renders the board any time
"ask what should I focus on today"     → talk to Winston (Claude)
"tell me how to structure my morning"
```

## How it works

```
Echo Show 11 ──▶ Alexa Skill (voice model) ──▶ AWS Lambda (lambda/)
                                                   │
                                                   ▼
                                        Anthropic API (claude-opus-5)
                                        Winston persona system prompt
```

- `skill-package/` — the skill manifest and the en-US voice interaction model (invocation name **"winston assistant"**, one catch-all `AskWinstonIntent` with an `AMAZON.SearchQuery` slot).
- `lambda/` — Node.js backend. `winston.js` calls Claude with a Winston system prompt; `index.js` wires the Alexa handlers; `apl/winston-display.json` is the Echo Show display template.
- Conversation history is kept in Alexa **session attributes**, so Winston remembers context for the duration of a session (it resets when the session closes).

## Setup — easiest path (Alexa-hosted skill)

1. Go to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) → **Create Skill** → Custom → **Alexa-hosted (Node.js)**.
2. Name it "Winston Assistant". After it provisions:
   - **Build tab** → JSON Editor → paste `skill-package/interactionModels/custom/en-US.json` → Save & Build.
   - **Build tab** → Interfaces → enable **Alexa Presentation Language (APL)**.
   - **Code tab** → replace the generated files with everything under `lambda/` (`index.js`, `winston.js`, `package.json`, and the `apl/` folder) → Deploy.
3. Add your Anthropic API key. Alexa-hosted skills don't expose env vars in the console, so either:
   - hardcode-free option: store the key in AWS Secrets Manager / SSM and read it at cold start, **or**
   - use the self-hosted path below, where `ANTHROPIC_API_KEY` is a normal Lambda environment variable (recommended).
4. **Test tab** → enable testing in Development → say *"open winston assistant"*. It will also appear on your own Echo Show 11 automatically (same Amazon account).

## Setup — one command with SAM (recommended)

`template.yaml` stands up everything on the AWS side: the Lambda (Node 20, 10s timeout), the private S3 state bucket with public access blocked, the `s3:GetObject` policy, env vars, and the Alexa trigger permission. Needs the [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and your AWS credentials:

```bash
cd alexa
sam build
sam deploy --guided          # prompts for AnthropicApiKey (hidden) and bucket name
```

Then:

1. Take the **LambdaArn** output → Alexa developer console → Create Custom skill → paste the interaction model, enable APL, set the endpoint to that ARN.
2. Redeploy once with the skill ID to lock the trigger: `sam deploy --parameter-overrides AlexaSkillId=amzn1.ask.skill.xxxx`
3. Publish your state: `cd publisher && npm install && node publish-winston.js --dir ~/your-winston-folder --bucket <StateBucket output>`

## Setup — self-hosted Lambda (manual)

1. Create a Node.js 20 Lambda in AWS. Upload the `lambda/` folder (run `npm install` inside it first, zip it, upload).
2. Set the environment variable `ANTHROPIC_API_KEY`.
3. Set Lambda timeout to **8 seconds or more** (Alexa gives ~8s total).
4. Add the **Alexa Skills Kit** trigger to the Lambda, restricted to your Skill ID.
5. In the developer console, create a Custom skill, paste the interaction model, enable APL, and point the endpoint at your Lambda ARN (or update `skill-package/skill.json` and deploy with the [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html): `ask deploy`).

## Talking to Winston

Alexa requires a short carrier word before free-form speech, so phrase requests as:

- "**ask** what's the highest leverage thing I can do this afternoon"
- "**tell me** how to think about the Series A timeline"
- "**question** should I take this meeting"
- "**help me with** planning my four buckets"

The session stays open after each answer, so you can keep going without re-invoking.

## Latency notes

Alexa cuts the connection at ~8 seconds. The Lambda is tuned for that: `claude-opus-5` at `effort: "low"`, capped output, and a system prompt that keeps spoken answers to 1–3 sentences. If you see timeouts, the next step is Alexa **progressive responses** (a "one moment" filler while Claude thinks) — not yet wired in.

## The control center

Opening the skill (or saying "show my control center") renders a full-screen board on the Show 11:

- **Left (56%)** — the four buckets, in Winston's canonical order, with ✓/○ item states
- **Right (44%)** — **OVERDUE** (red), **PIPELINE — NEEDS ATTENTION** (amber, with the recommended action), and the **CADENCE** tracker
- **Header** — today's focus line; **footer** — feed freshness

Winston also speaks a short summary: overdue count first, then pipeline flags, then today's focus.

### Feeding it live data — the S3 publish pipeline

```
Winston folder (CLAUDE.md, TASKS.md, plans/, memory/)
        │  publisher/publish-winston.js
        ▼
s3://<bucket>/dashboard.json   ──▶  control center board
s3://<bucket>/context.md       ──▶  Winston's brain (live memory in the prompt)
```

The `publisher/` script parses your real Winston files — no hand-maintained JSON:

- **`dashboard.json`** — four buckets from the latest `plans/*-day-plan.md`, overdue items from `TASKS.md` `DUE:` dates (LA timezone), pipeline flags from the CLAUDE.md pipeline table (>7 days since last touch = "Send nudge", ≥21 days = "3-week rule — consider Check In Later"; dormant/check-in-later rows skipped), and the Cadence Tracker.
- **`context.md`** — a memory bundle (CLAUDE.md + TASKS.md + latest plan + latest wrap, capped per file) that the Lambda injects into Winston's prompt, so voice answers use your real tasks, names, and dates.

**One-time setup:**

```bash
# 1. Private bucket (keep public access blocked — this is pipeline data)
aws s3 mb s3://winston-echo-state
aws s3api put-public-access-block --bucket winston-echo-state \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2. Let the skill's Lambda read it — add to the Lambda execution role:
#    { "Effect": "Allow", "Action": "s3:GetObject",
#      "Resource": "arn:aws:s3:::winston-echo-state/*" }

# 3. Lambda env vars:
#    WINSTON_S3_BUCKET=winston-echo-state
#    (optional) WINSTON_DASHBOARD_KEY=dashboard.json  WINSTON_CONTEXT_KEY=context.md
```

**Publishing (from your machine, using your local AWS credentials):**

```bash
cd alexa/publisher && npm install   # first time only
node publish-winston.js --dir ~/path/to/winston --bucket winston-echo-state
node publish-winston.js --dir ~/path/to/winston --dry-run   # build only, inspect publisher/out/
```

Add that publish command to the end of Winston's day-plan and day-wrap routines (or a cron/launchd job) and the Echo stays current — the Lambda caches S3 reads for 2 minutes and falls back to the last known state, then sample data. A plain HTTPS feed via `WINSTON_DASHBOARD_URL` still works if you'd rather not use S3, but the S3 path is preferred: the bucket stays private and the Lambda reads with its IAM role.

## What this Winston knows

With the S3 pipeline configured, Echo Winston knows your live state: the published `context.md` (working memory, task board, latest plan and wrap) is injected into every Claude call, after the cached persona block so the prompt cache stays warm. Without it, Winston falls back to persona-only and says so when asked about live data. It still can't see your calendar or inbox — it will tell you that plainly rather than guess.
