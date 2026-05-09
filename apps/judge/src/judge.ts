import type { Hono, Context } from "hono";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { applySafetyFloor } from "./safetyFloor";
import { llmJudge } from "./anthropic";
import { llmJudgeOpenAI } from "./openai";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  apiKey?: string;
  llmOverride?: (input: JudgeInput) => Promise<JudgeVerdict>; // for tests
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
    else if (opts.openaiApiKey) { provider = "openai"; model = opts.openaiModel ?? "gpt-5.2"; }
    else if (opts.anthropicApiKey) { provider = "anthropic"; model = "claude-sonnet-4-6"; }
    else { provider = "none"; model = undefined; }
    return c.json({ provider, model });
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
      return c.json(applySafetyFloor(v, input.findings));
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
      return c.json(applySafetyFloor(llm, input.findings));
    } catch (e) {
      return c.json({ error: "llm_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") return `Looks fine — ${input.intent.summary}`;
  return `Verdict for ${input.decoded.kind}`;
}
