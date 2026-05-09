/**
 * /chat — conversational layer the user can open from the popup ("Talk to Evzi").
 *
 * Two modes, distinguished by whether `context` is supplied:
 *
 *   1. Verdict-aware: opened from the verdict screen with the JudgeInput +
 *      verdict the user just saw. Replies cite specific findings, decoded
 *      action, simulation, contract trust info — Evzi as a personal Web3
 *      analyst for THIS transaction.
 *
 *   2. General: opened from the idle screen or confirm screen. Replies are
 *      teaching-mode, focused on Web3 safety patterns the user might be
 *      worrying about.
 *
 * Output is one-shot (not streamed) for simplicity. Reply token budget is
 * small (~400) — the chat is consumed inside a 420×640 popup, long replies
 * scroll badly.
 */

import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

export interface ChatMessageWire {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContextWire {
  judgeInput?: JudgeInput;
  verdict?: JudgeVerdict;
  origin?: string;
}

export interface ChatRequest {
  messages: ChatMessageWire[];
  context?: ChatContextWire;
}

export interface ChatReply {
  reply: string;
}

const SYSTEM_PROMPT_BASE = `You are Evzi, a Web3 safety guide who lives inside a browser extension.

Your job: help the user understand what's happening when they interact with
crypto wallets and dApps. Be concrete, calm, and unafraid to say "I don't know
for certain". Never instruct the user to sign or reject — that's their call.

Voice:
- Direct and warm. Short sentences. Plain English over jargon ("approving a
  spender" beats "granting an ERC-20 allowance"). Define jargon when used.
- Lead with the answer, then the reasoning. No throat-clearing.
- Limit to about 4-5 sentences unless the user asks for more detail.
- Use line breaks generously between distinct ideas.
- Don't moralize. The user knows scams are bad — help them spot them.

What you can do:
- Explain what specific calldata, signature, or contract semantics mean.
- Describe common phishing patterns (Permit2 drainers, fake mints, lookalike
  domains, unlimited approvals, account-abstraction quirks).
- Help the user reason about whether a transaction matches their intent.

What you should NOT do:
- Look up live on-chain data (you don't have tools).
- Make blanket "this is safe / unsafe" claims — frame them as risk patterns.
- Recommend a specific wallet, dApp, or chain.`;

const SYSTEM_PROMPT_VERDICT_ADDENDUM = `

# Context: the user just saw a verdict for a transaction

You are receiving the full \`JudgeInput\` and \`JudgeVerdict\` the popup just
showed. Reference it concretely when answering — name the protocol, the
verdict tier, the specific findings, the decoded action's kind. The user
opened the chat because something about THAT verdict needs more explanation.

Examples of good replies in this mode:
- "The 'Permit2 batch transfer' you saw means you'd be authorizing spender
  X to move 3 of your tokens via signature alone — no on-chain transaction.
  That's why we flagged it as DANGER even though no transaction would fire."
- "The 'Sourcify: not verified' row is amber, not red, because we recognize
  the address as a known Uniswap router from our registry. Sourcify just
  hasn't ingested its source yet. The trust signal is the address match."`;

function buildSystemPrompt(context?: ChatContextWire): string {
  if (context?.judgeInput || context?.verdict) {
    return SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_VERDICT_ADDENDUM;
  }
  return SYSTEM_PROMPT_BASE;
}

/**
 * Render the JudgeInput + verdict as a compact JSON block prepended to the
 * user's first message in the conversation. Same model+prompt path as the
 * verdict-aware addendum: the LLM treats this as ground truth for THIS user.
 *
 * We don't add it as a separate "system" turn because some providers cache
 * the system prompt; mixing per-conversation context into the cached system
 * defeats the cache.
 */
function contextBlock(context?: ChatContextWire): string {
  if (!context) return "";
  const compact: Record<string, unknown> = {};
  if (context.origin) compact.origin = context.origin;
  if (context.verdict) {
    compact.verdict = {
      tier: context.verdict.tier,
      headline: context.verdict.headline,
      reasons: context.verdict.reasons,
      confidence: context.verdict.confidence,
    };
  }
  if (context.judgeInput) {
    compact.judgeInput = {
      decoded: context.judgeInput.decoded,
      contract: context.judgeInput.contract,
      findings: context.judgeInput.findings,
      origin: context.judgeInput.origin,
      // Drop sim.assetChanges if they're huge; keep summary fields.
      sim: context.judgeInput.sim
        ? {
            success: context.judgeInput.sim.success,
            failureReason: context.judgeInput.sim.failureReason,
            assetChangesCount: context.judgeInput.sim.assetChanges.length,
            gasUsed: context.judgeInput.sim.gasUsed,
          }
        : undefined,
      netEffect: context.judgeInput.netEffect,
    };
  }
  return `\n\n[Verdict context]\n${JSON.stringify(compact, null, 2)}\n[/Verdict context]\n\n`;
}

export interface ChatProviderArgs {
  apiKey: string;
  model?: string;
}

/**
 * Call OpenAI Chat Completions for a one-shot reply. Same shape as the
 * judge's openai.ts but a different system prompt and a smaller token budget.
 */
export async function chatWithOpenAI(
  request: ChatRequest,
  args: ChatProviderArgs,
): Promise<ChatReply> {
  const system = buildSystemPrompt(request.context);
  const ctx = contextBlock(request.context);

  // Prepend context to the first user message rather than as a separate turn.
  const messagesForOpenAI: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
  ];
  let firstUserAttached = !ctx;
  for (const m of request.messages) {
    if (!firstUserAttached && m.role === "user") {
      messagesForOpenAI.push({ role: "user", content: ctx + m.content });
      firstUserAttached = true;
    } else {
      messagesForOpenAI.push({ role: m.role, content: m.content });
    }
  }
  // If for some reason no user message was provided, attach the context as a
  // bare user turn so the model has something to react to.
  if (!firstUserAttached) {
    messagesForOpenAI.push({ role: "user", content: ctx });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model ?? "gpt-5.4",
      messages: messagesForOpenAI,
      // gpt-5.x series can burn tokens on internal reasoning; budget enough
      // for a 4-5 sentence reply plus headroom.
      max_completion_tokens: 1200,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai chat ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const reply = body.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("openai chat: empty response");
  return { reply };
}

/**
 * Call Anthropic for a one-shot reply. Mirrors anthropic.ts pattern.
 */
export async function chatWithAnthropic(
  request: ChatRequest,
  args: ChatProviderArgs,
): Promise<ChatReply> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: args.apiKey });

  const system = buildSystemPrompt(request.context);
  const ctx = contextBlock(request.context);

  // Same first-user-context prefix strategy.
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let firstUserAttached = !ctx;
  for (const m of request.messages) {
    if (!firstUserAttached && m.role === "user") {
      messages.push({ role: "user", content: ctx + m.content });
      firstUserAttached = true;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  if (!firstUserAttached) messages.push({ role: "user", content: ctx });

  const res = await client.messages.create({
    model: args.model ?? "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } } as any],
    messages,
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) throw new Error("anthropic chat: empty response");
  return { reply: text };
}
