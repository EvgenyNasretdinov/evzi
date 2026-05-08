import type { Context, Hono } from "hono";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  apiKey?: string;
}

// Either a static set of options (used by tests) or a function that derives
// options from the request Context (used by the Worker entrypoint, which only
// gets access to `c.env` per request).
export type JudgeOptionsLike =
  | JudgeOptions
  | ((c: Context<any>) => JudgeOptions);

// Accept any Hono variant (with or without Bindings) so the same helper
// can be mounted both from the Worker entrypoint and from tests.
export function mountJudge(app: Hono<any>, optsLike: JudgeOptionsLike) {
  app.post("/judge", async (c) => {
    const opts =
      typeof optsLike === "function" ? optsLike(c) : optsLike;
    const apiKey = opts.apiKey;
    if (!apiKey) {
      return c.json({ error: "judge_api_key_unconfigured" }, 500);
    }
    if (c.req.header("x-api-key") !== apiKey) {
      return c.json({ error: "unauthorized" }, 401);
    }

    let input: JudgeInput;
    try {
      input = (await c.req.json()) as JudgeInput;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (opts.stubVerdict) {
      const verdict: JudgeVerdict = {
        tier: "SAFE",
        headline: stubHeadline(input),
        reasons: [{ severity: "info", text: "Stubbed verdict (M1)." }],
        confidence: 0.5,
      };
      return c.json(verdict);
    }

    // M2 path will replace this branch.
    return c.json({ error: "llm path not implemented" }, 501);
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") {
    return `Looks fine — ${input.intent.summary}`;
  }
  return `Verdict for ${input.decoded.kind}`;
}
