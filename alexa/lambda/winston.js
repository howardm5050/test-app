"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// Reads ANTHROPIC_API_KEY from the Lambda environment.
const client = new Anthropic();

const MODEL = "claude-opus-5";

// Alexa closes the request after ~8 seconds, so responses must be short and
// fast: low effort, capped output. max_tokens covers thinking + text on this
// model, so leave headroom above the spoken-answer budget.
const MAX_TOKENS = 2048;

const WINSTON_SYSTEM = `You are Winston, Howard Michalski's personal executive assistant, speaking through an Amazon Echo Show. Howard is founder/President of medZERO (fintech for employer-sponsored healthcare financing) and runs Humboldt Group (M&A and strategic advisory for IMB CEOs and PE-backed mortgage platforms).

Who you are:
- Professional, direct, minimal fluff. Call him Howard.
- Proactive accountability partner: protect his time, flag drift toward low-ROI work, push for real next actions with dates.
- His day plans use exactly four buckets, in order: Personal/Faith/Family, Money/Admin, medZERO Work, Humboldt (Consulting/Advisory).
- medZERO test: "Does this close revenue or advance Series A?" If no, push back.
- Humboldt channels are LinkedIn and warm intros; cold email converts at zero.
- Never schedule over Meredith's protected evening time.

Voice rules (this is a spoken conversation):
- Answer in 1-3 short sentences unless Howard asks for a full plan or list.
- Plain spoken prose only: no markdown, no bullets, no headers, no emoji, no URLs.
- If asked for a day plan, walk the four buckets briefly, one line each.
- If a question needs data you don't have (his files, calendar, inbox), say so plainly and give your best general answer.
- End with the answer, not with offers of more help.`;

/**
 * Send a user utterance to Winston and return { speech, history }.
 * `history` is the prior conversation as Anthropic message params
 * (stored in Alexa session attributes between turns).
 */
async function askWinston(utterance, history = []) {
  const messages = [...history, { role: "user", content: utterance }];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: WINSTON_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { effort: "low" },
    messages,
  });

  if (response.stop_reason === "refusal") {
    return {
      speech: "I can't help with that one, Howard. What else do you need?",
      history,
    };
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .trim();

  const speech = text || "I didn't get an answer together. Try me again.";

  // Keep the last 12 turns so session attributes stay small and the
  // prompt stays fast.
  const newHistory = [
    ...messages,
    { role: "assistant", content: speech },
  ].slice(-12);

  return { speech, history: newHistory };
}

/** Escape characters that break SSML. */
function toSsmlSafe(text) {
  return text
    .replace(/&/g, "and")
    .replace(/</g, " ")
    .replace(/>/g, " ");
}

module.exports = { askWinston, toSsmlSafe };
