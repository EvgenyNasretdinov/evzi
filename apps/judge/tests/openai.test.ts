import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmJudgeOpenAI } from "../src/openai";
import type { JudgeInput } from "@intent-check/types";

const baseInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH", confidence: 0.9 },
  decoded: { kind: "unknown", selector: "0x" },
  contract: { address: "0x0", chainId: 8453, verified: false, isProxy: false },
  origin: { url: "x", origin: "x" },
  findings: [],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x0" }] },
};

describe("openai client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // Sanity check on request shape.
      expect(body.model).toBe("gpt-5.4");
      expect(body.response_format.type).toBe("json_schema");
      const verdict = { tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 };
      const choice = { message: { content: JSON.stringify(verdict) } };
      return new Response(JSON.stringify({ choices: [choice] }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls openai and returns the parsed verdict", async () => {
    const r = await llmJudgeOpenAI(baseInput, "sk-fake");
    expect(r.tier).toBe("SAFE");
    expect(r.headline).toBe("ok");
  });

  it("uses the override model when provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("gpt-5.5");
      const verdict = { tier: "CAUTION", headline: "x", reasons: [], confidence: 0.5 };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
    }));
    const r = await llmJudgeOpenAI(baseInput, "sk-fake", "gpt-5.5");
    expect(r.tier).toBe("CAUTION");
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(llmJudgeOpenAI(baseInput, "sk-fake")).rejects.toThrow(/openai 429/);
  });

  it("throws on invalid tier in response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"tier":"BAD","headline":"x","reasons":[],"confidence":0}' } }] }), { status: 200 })
    ));
    await expect(llmJudgeOpenAI(baseInput, "sk-fake")).rejects.toThrow(/invalid tier/);
  });
});
