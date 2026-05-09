import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput } from "@intent-check/types";

function makeApp() {
  const app = new Hono();
  mountJudge(app, { stubVerdict: true, apiKey: "local-dev-key" });
  return app;
}

const baseInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
  decoded: {
    kind: "swap",
    tokenIn:  { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" },
    tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" },
    minAmountOut: "28000000000000000",
    recipient: "0x000000000000000000000000000000000000dEaD",
    router:    "0x6fF5693b99212Da76ad316178A184AB56D299b43",
    protocol:  "Uniswap",
  },
  contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false },
  origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
  findings: [],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x6fF5693b99212Da76ad316178A184AB56D299b43" }] },
};

describe("/judge stub", () => {
  it("returns SAFE for a recognized swap intent", async () => {
    const app = makeApp();
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "local-dev-key" },
      body: JSON.stringify(baseInput),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tier: string; headline: string };
    expect(body.tier).toBe("SAFE");
    expect(typeof body.headline).toBe("string");
  });

  it("rejects requests without an API key", async () => {
    const app = makeApp();
    const res = await app.request("/judge", { method: "POST", body: JSON.stringify(baseInput), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong API key", async () => {
    const app = makeApp();
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "wrong-key" },
      body: JSON.stringify(baseInput),
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON with 400", async () => {
    const app = makeApp();
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "local-dev-key" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("/judge/info", () => {
  it("reports stub provider when stubVerdict is on", async () => {
    const app = new Hono();
    mountJudge(app, { stubVerdict: true, apiKey: "k" });
    const res = await app.request("/judge/info");
    const body = (await res.json()) as { provider: string; model?: string };
    expect(body.provider).toBe("stub");
    expect(body.model).toBeUndefined();
  });

  it("reports openai with default model gpt-5.4", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k", openaiApiKey: "sk-fake" });
    const body = (await (await app.request("/judge/info")).json()) as { provider: string; model?: string };
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-5.4");
  });

  it("reports openai with custom model when overridden", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k", openaiApiKey: "sk-fake", openaiModel: "gpt-5.2" });
    const body = (await (await app.request("/judge/info")).json()) as { provider: string; model?: string };
    expect(body.model).toBe("gpt-5.2");
  });

  it("reports anthropic when only anthropic key is set", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k", anthropicApiKey: "sk-ant-fake" });
    const body = (await (await app.request("/judge/info")).json()) as { provider: string; model?: string };
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-sonnet-4-6");
  });

  it("reports none when no LLM key is set", async () => {
    const app = new Hono();
    mountJudge(app, { apiKey: "k" });
    const body = (await (await app.request("/judge/info")).json()) as { provider: string };
    expect(body.provider).toBe("none");
  });
});
