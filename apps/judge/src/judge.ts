import type { Hono, Context } from "hono";
import type { Finding, JudgeInput, JudgeVerdict, OnchainContext, UserIntent } from "@intent-check/types";
import { applySafetyFloor } from "./safetyFloor";
import { derivePolicy, extractSpend } from "@intent-check/intent";
import { fetchOnchainContext, graphFindings, type DurableStore } from "@intent-check/onchain-context";
import { claimedSymbolFor } from "./claimedSymbol";
import { llmJudge } from "./anthropic";
import { llmJudgeOpenAI } from "./openai";
import { inferIntentLLM, type InferIntentInput } from "./inferIntent";
import { chatWithAnthropic, chatWithOpenAI, type ChatRequest, type ChatReply } from "./chat";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiInferModel?: string;  // small/cheap model for /infer-intent
  /** Force a specific provider regardless of which keys are set. */
  preferredProvider?: "openai" | "anthropic";
  apiKey?: string;
  llmOverride?: (input: JudgeInput) => Promise<JudgeVerdict>; // for tests
  inferIntentOverride?: (input: InferIntentInput) => Promise<UserIntent>; // for tests
  chatOverride?: (request: ChatRequest) => Promise<ChatReply>; // for tests
  /** Graph Network gateway key — enables on-chain enrichment. */
  graphApiKey?: string;
  /** thegraph.market JWT for the Token API. */
  tokenApiJwt?: string;
  store?: DurableStore;
  onchainOverride?: (a: { chainId: number; token?: string; wallet?: string }) => Promise<OnchainContext>; // for tests
}

/**
 * Pick which LLM path to use given the configured options. Honors an explicit
 * preferredProvider when its key is present; otherwise OpenAI wins if both
 * keys are set (backwards-compatible default), then Anthropic, then "none".
 */
function pickProvider(opts: JudgeOptions): "openai" | "anthropic" | "none" {
  if (opts.preferredProvider === "anthropic" && opts.anthropicApiKey) return "anthropic";
  if (opts.preferredProvider === "openai" && opts.openaiApiKey) return "openai";
  if (opts.openaiApiKey) return "openai";
  if (opts.anthropicApiKey) return "anthropic";
  return "none";
}

export type JudgeOptionsLike = JudgeOptions | ((c: Context<any>) => JudgeOptions);

function resolveOpts(c: Context<any>, optsLike: JudgeOptionsLike): JudgeOptions {
  return typeof optsLike === "function" ? optsLike(c) : optsLike;
}

/**
 * Attach live on-chain context and the findings derived from it.
 *
 * Done here rather than in the extension so the Graph credentials never leave
 * the server. A caller that already did this work keeps its own context; a
 * caller with no credentials configured is left exactly as it was, which is why
 * every pre-existing golden fixture still holds.
 */
async function enrichWithOnchain(
  input: JudgeInput,
  opts: JudgeOptions,
  keepAlive?: (p: Promise<unknown>) => void,
): Promise<JudgeInput> {
  if (input.onchain) return input;
  if (!opts.graphApiKey && !opts.tokenApiJwt && !opts.onchainOverride) return input;

  const chainId = input.contract.chainId;
  const { movements } = extractSpend(input.decoded, chainId);
  const primary = movements[0];
  const wallet = input.request.method === "eth_sendTransaction"
    ? input.request.params[0]?.from
    : undefined;

  const onchain = opts.onchainOverride
    ? await opts.onchainOverride({ chainId, token: primary?.token, wallet })
    : await fetchOnchainContext({
        chainId,
        token: primary?.token,
        wallet,
        graphApiKey: opts.graphApiKey,
        tokenApiJwt: opts.tokenApiJwt,
        keepAlive,
        store: opts.store,
      });

  const extra: Finding[] = graphFindings(onchain, {
    claimedSymbol: claimedSymbolFor(input, primary?.token) ?? onchain.token?.symbol,
    isUnlimitedApproval: primary?.isUnlimited,
    approvedToken: primary?.token,
  });

  return { ...input, onchain, findings: [...input.findings, ...extra] };
}

/**
 * Apply the safety floor, then attach the agent policy.
 *
 * The policy is derived from the deterministic findings and the floored tier,
 * never from the model's own judgment, and is attached only when an
 * authorization was supplied — the human flow stays byte-identical.
 */
function finalize(verdict: JudgeVerdict, input: JudgeInput): JudgeVerdict {
  const floored = applySafetyFloor(verdict, input);
  if (!input.authorization) return floored;
  return {
    ...floored,
    policy: derivePolicy(input.findings, floored.tier, { onchain: input.onchain }),
  };
}

export function mountJudge(app: Hono<any>, optsLike: JudgeOptionsLike) {
  // Public, unauthenticated info endpoint — lets the extension display which
  // model is currently active without exposing any secrets.
  app.get("/judge/info", (c) => {
    const opts = resolveOpts(c, optsLike);
    if (opts.stubVerdict) return c.json({ provider: "stub" });
    const p = pickProvider(opts);
    if (p === "openai")    return c.json({ provider: "openai", model: opts.openaiModel ?? "gpt-5.4" });
    if (p === "anthropic") return c.json({ provider: "anthropic", model: opts.anthropicModel ?? "claude-sonnet-4-6" });
    return c.json({ provider: "none" });
  });

  app.post("/infer-intent", async (c) => {
    const opts = resolveOpts(c, optsLike);
    const apiKey = opts.apiKey;
    if (!apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);

    let input: InferIntentInput;
    try { input = (await c.req.json()) as InferIntentInput; }
    catch { return c.json({ error: "invalid_json" }, 400); }

    if (opts.inferIntentOverride) {
      try { return c.json(await opts.inferIntentOverride(input)); }
      catch (e) { return c.json({ error: "infer_failed", message: String((e as Error).message ?? e) }, 502); }
    }
    if (!opts.openaiApiKey) {
      return c.json({ error: "infer_unavailable", message: "/infer-intent requires OPENAI_API_KEY" }, 501);
    }
    try {
      const intent = await inferIntentLLM(input, opts.openaiApiKey, opts.openaiInferModel);
      return c.json(intent);
    } catch (e) {
      return c.json({ error: "infer_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });

  app.post("/chat", async (c) => {
    const opts = resolveOpts(c, optsLike);
    const apiKey = opts.apiKey;
    if (!apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);

    let request: ChatRequest;
    try { request = (await c.req.json()) as ChatRequest; }
    catch { return c.json({ error: "invalid_json" }, 400); }

    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      return c.json({ error: "no_messages", message: "messages must be a non-empty array" }, 400);
    }

    if (opts.chatOverride) {
      try { return c.json(await opts.chatOverride(request)); }
      catch (e) { return c.json({ error: "chat_failed", message: String((e as Error).message ?? e) }, 502); }
    }

    try {
      const provider = pickProvider(opts);
      if (provider === "none") {
        return c.json({ error: "no_llm_key", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }, 500);
      }
      const reply = provider === "openai"
        ? await chatWithOpenAI(request, { apiKey: opts.openaiApiKey!, model: opts.openaiModel })
        : await chatWithAnthropic(request, { apiKey: opts.anthropicApiKey!, model: opts.anthropicModel });
      return c.json(reply);
    } catch (e) {
      return c.json({ error: "chat_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });

  app.post("/judge", async (c) => {
    const opts = resolveOpts(c, optsLike);
    const apiKey = opts.apiKey;
    if (!apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);

    let input: JudgeInput;
    try { input = (await c.req.json()) as JudgeInput; }
    catch { return c.json({ error: "invalid_json" }, 400); }

    input = await enrichWithOnchain(input, opts, (p) => c.executionCtx?.waitUntil?.(p));

    if (opts.stubVerdict) {
      const v: JudgeVerdict = { tier: "SAFE", headline: stubHeadline(input), reasons: [{ severity: "info", text: "Stubbed verdict." }], confidence: 0.5 };
      return c.json(finalize(v, input));
    }

    if (!opts.anthropicApiKey && !opts.openaiApiKey && !opts.llmOverride) {
      return c.json({ error: "no_llm_key", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }, 500);
    }

    try {
      let llm: JudgeVerdict;
      if (opts.llmOverride) {
        llm = await opts.llmOverride(input);
      } else {
        const provider = pickProvider(opts);
        if (provider === "openai")    llm = await llmJudgeOpenAI(input, opts.openaiApiKey!, opts.openaiModel);
        else if (provider === "anthropic") llm = await llmJudge(input, opts.anthropicApiKey!, opts.anthropicModel);
        else throw new Error("no LLM provider configured");
      }
      return c.json(finalize(llm, input));
    } catch (e) {
      return c.json({ error: "llm_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") return `Looks fine — ${input.intent.summary}`;
  return `Verdict for ${input.decoded.kind}`;
}
