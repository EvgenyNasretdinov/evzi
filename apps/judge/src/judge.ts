import type { Hono, Context } from "hono";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { applySafetyFloor } from "./safetyFloor";
import { llmJudge } from "./anthropic";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  apiKey?: string;
  llmOverride?: (input: JudgeInput) => Promise<JudgeVerdict>; // for tests
}

export type JudgeOptionsLike = JudgeOptions | ((c: Context<any>) => JudgeOptions);

function resolveOpts(c: Context<any>, optsLike: JudgeOptionsLike): JudgeOptions {
  return typeof optsLike === "function" ? optsLike(c) : optsLike;
}

export function mountJudge(app: Hono<any>, optsLike: JudgeOptionsLike) {
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

    if (!opts.anthropicApiKey && !opts.llmOverride) return c.json({ error: "ANTHROPIC_API_KEY missing" }, 500);

    try {
      const llm = opts.llmOverride
        ? await opts.llmOverride(input)
        : await llmJudge(input, opts.anthropicApiKey!);
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
