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

## Setup — self-hosted Lambda (recommended for the API key)

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

### Feeding it live data

The board reads a single JSON file. Set the Lambda env var `WINSTON_DASHBOARD_URL` to any HTTPS URL that returns it (an S3 object with a bucket policy or CloudFront in front works well). Without the env var it shows bundled sample data and says so.

Schema (see `lambda/sample-dashboard.json` for a full example):

```json
{
  "updatedAt": "2026-08-07T14:00:00Z",
  "focus": "Thursday — email and phone outreach (Humboldt)",
  "buckets": [{ "name": "medZERO Work", "items": [{ "text": "...", "done": false }] }],
  "overdue": [{ "text": "Ping Elizabeth Kim", "due": "Tue 8/4" }],
  "pipeline": [{ "name": "Berman", "status": "3 touches, no response", "action": "Move to Check In Later" }],
  "cadence": { "touchesThisWeek": 4, "lastLinkedIn": "Tue 8/4", "lastEmailPhone": "Thu 7/31", "lastPipelineReview": "Fri 8/1" }
}
```

The natural publisher is a Winston desktop session: whenever it saves the day plan or wrap, it also writes this JSON and uploads it (e.g. `aws s3 cp dashboard.json s3://.../winston-dashboard.json`). The Lambda caches the feed for 2 minutes and falls back to the last known state if the fetch fails.

## What this Winston knows

This is a standalone Winston: it carries the persona (direct, four-bucket day structure, medZERO revenue test, Humboldt channel rules, protected evening time) but **not** your local files (CLAUDE.md, TASKS.md, plans). It will say so when asked about live data. Wiring it to real task/pipeline state would mean giving the Lambda a data source (e.g., an S3-synced copy of the Winston files) — a good phase two.
