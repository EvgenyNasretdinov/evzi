import type { Hono, Context } from "hono";
import type { JudgeInput, JudgeVerdict, UserIntent } from "@intent-check/types";
import { applySafetyFloor } from "./safetyFloor";
import { llmJudge } from "./anthropic";
import { llmJudgeOpenAI } from "./openai";
import { inferIntentLLM, type InferIntentInput } from "./inferIntent";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiInferModel?: string;  // small/cheap model for /infer-intent
  apiKey?: string;
  llmOverride?: (input: JudgeInput) => Promise<JudgeVerdict>; // for tests
  inferIntentOverride?: (input: InferIntentInput) => Promise<UserIntent>; // for tests
}

export type JudgeOptionsLike = JudgeOptions | ((c: Context<any>) => JudgeOptions);

function resolveOpts(c: Context<any>, optsLike: JudgeOptionsLike): JudgeOptions {
  return typeof optsLike === "function" ? optsLike(c) : optsLike;
}

export function mountJudge(app: Hono<any>, optsLike: JudgeOptionsLike) {
  // Public, unauthenticated info endpoint — lets the extension display which
  // model is currently active without exposing any secrets.
  app.get("/judge/info", (c) => {
    const opts = resolveOpts(c, optsLike);
    let provider: "stub" | "openai" | "anthropic" | "none";
    let model: string | undefined;
    if (opts.stubVerdict) { provider = "stub"; model = undefined; }
    else if (opts.openaiApiKey) { provider = "openai"; model = opts.openaiModel ?? "gpt-5.5"; }
    else if (opts.anthropicApiKey) { provider = "anthropic"; model = "claude-sonnet-4-6"; }
    else { provider = "none"; model = undefined; }
    return c.json({ provider, model });
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

  app.post("/judge", async (c) => {
    const opts = resolveOpts(c, optsLike);
    const apiKey = opts.apiKey;
    if (!apiKey) return c.json({ error: "judge_api_key_unconfigured" }, 500);
    if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);

    let input: JudgeInput;
    try { input = (await c.req.json()) as JudgeInput; }
    catch { return c.json({ error: "invalid_json" }, 400); }

    if (opts.stubVerdict) {
      const v: JudgeVerdict = { tier: "SAFE", headline: stubHeadline(input), reasons: [{ severity: "info", text: "Stubbed verdict." }], confidence: 0.5 };
      return c.json(applySafetyFloor(v, input));
    }

    if (!opts.anthropicApiKey && !opts.openaiApiKey && !opts.llmOverride) {
      return c.json({ error: "no_llm_key", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY." }, 500);
    }

    try {
      let llm: JudgeVerdict;
      if (opts.llmOverride) {
        llm = await opts.llmOverride(input);
      } else if (opts.openaiApiKey) {
        llm = await llmJudgeOpenAI(input, opts.openaiApiKey, opts.openaiModel);
      } else {
        llm = await llmJudge(input, opts.anthropicApiKey!);
      }
      return c.json(applySafetyFloor(llm, input));
    } catch (e) {
      return c.json({ error: "llm_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") return `Looks fine — ${input.intent.summary}`;
  return `Verdict for ${input.decoded.kind}`;
}
