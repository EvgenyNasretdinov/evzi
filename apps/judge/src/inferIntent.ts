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
button, a body-text excerpt from the same region, and a partial decoded
action from the calldata when available.

Your job: produce ONE sentence describing what the user is trying to do in
the most concrete terms the evidence supports. Pick a kind from:
"swap" | "approve" | "deposit" | "mint" | "bridge" | "transfer" | "sign" | "other".

Output JSON only with shape: { kind, summary, confidence }.

# Summary writing rules

Aim for 60-110 characters. Always be as specific as the evidence allows:

- If amounts and token symbols are visible (in inputs OR in nearbyText), include
  them. "Swap 0.1 ETH for OP on Uniswap" beats "Swap on Uniswap".
- If only one side's amount is visible (e.g., the input but not the output),
  include the input and use a verb like "for".
- Always name the protocol/dapp when it's identifiable from origin / ogSiteName
  / decoded.protocol.
- For approves: include the token symbol AND the spender protocol when known.
  "Approve unlimited USDC to Uniswap Permit2" beats "Approve token".
- For mints: include the collection name if visible. "Mint Base Genesis NFT
  for 0.01 ETH" beats "Mint NFT".
- For bridges: include source/dest chain. "Bridge 100 USDC from Ethereum to Base".

Never default to a generic placeholder when the evidence is rich — if you have
amounts visible in nearbyText, USE them.

# Confidence

- 0.9+ : strong button text + form values matching + decoded action consistent.
- 0.6-0.8 : button text matches but only some amounts visible.
- 0.3-0.5 : page title only, no click/form context.
- < 0.3 : kind is genuinely ambiguous.

# Hierarchy of trust

Click context > decoded.kind/protocol > nearbyText > og:title > page title.

For unclear cases, prefer "other" with low confidence over a guess.`;

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
  // gpt-5.1 produces noticeably more specific, well-formed summaries than
  // gpt-5-mini for this task — small per-call cost is worth it for the
  // headline UX. Override via OPENAI_INFER_MODEL.
  model: string = "gpt-5.1",
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
