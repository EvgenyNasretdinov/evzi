import type { UserIntent } from "@intent-check/types";

/**
 * Prompt the LLM with rich page context (click target, section heading, visible
 * inputs, page title) and ask for a structured UserIntent. Used by /infer-intent
 * to replace the regex-only inference in the extension background.
 *
 * Model: gpt-5-mini by default — cheap, fast, plenty smart for one-shot
 * structured-output inference. Override via OPENAI_INFER_MODEL.
 */

export interface InferIntentInput {
  origin: string;
  pageTitle?: string;
  ogTitle?: string;
  ogSiteName?: string;
  clickContext?: {
    text: string;
    ariaLabel?: string;
    sectionHeading?: string;
  };
  actionContext?: {
    heading?: string;
    inputs: { label: string; value: string }[];
    nearbyText?: string;
  };
  decoded?: {
    kind: string;
    protocol?: string;
    commands?: string[];
  };
}

const SYSTEM_PROMPT = `You infer a Web3 user's intent from page context captured at the moment they triggered a wallet request.

You receive: dApp origin and page title, the button the user just clicked
(text + section heading), visible form inputs and their values around that
button, a short body-text excerpt from the same section, and a partial decoded
action from the calldata when available.

Your job: produce a one-sentence summary of what the user is trying to do, in
plain English a non-technical user would write. Pick a kind from:
"swap" | "approve" | "deposit" | "mint" | "bridge" | "transfer" | "sign" | "other".

Output JSON only with shape: { kind, summary, confidence }.

- kind: one of the values above.
- summary: under ~80 characters. Include amounts and token symbols when visible
  (e.g., "Swap 0.1 ETH for OP on Uniswap"). If amounts/tokens are visible in
  inputs, prefer them over generic "Swap on this dApp".
- confidence: 0..1 — how confident you are in the inferred kind, given the
  evidence. Strong button label + matching form inputs = high. Generic title
  with no click context = low.

Rules:
- Trust the click context over the page title.
- The decoded action's "kind" / "protocol" is a strong hint — use it.
- For ambiguous cases, prefer "other" with low confidence over a guess.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "summary", "confidence"],
  properties: {
    kind: { type: "string", enum: ["swap", "approve", "deposit", "mint", "bridge", "transfer", "sign", "other"] },
    summary: { type: "string" },
    confidence: { type: "number" },
  },
} as const;

export async function inferIntentLLM(
  input: InferIntentInput,
  apiKey: string,
  model: string = "gpt-5-mini",
): Promise<UserIntent> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "user_intent", strict: true, schema: SCHEMA },
      },
      // gpt-5-mini uses reasoning tokens internally; budget headroom so the
      // actual JSON output isn't truncated to empty.
      max_completion_tokens: 600,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`infer-intent ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("infer-intent: empty response");
  const parsed = JSON.parse(content) as UserIntent;
  return parsed;
}
