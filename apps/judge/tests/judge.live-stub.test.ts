import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

const baseInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
  decoded: { kind: "swap", tokenIn: { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" }, tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" }, minAmountOut: "28000000000000000", recipient: "0x0", router: "0x6fF5693b99212Da76ad316178A184AB56D299b43", protocol: "Uniswap" },
  contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false },
  origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
  findings: [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "contract is not verified" }],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x0" }] },
};

describe("/judge with llmOverride applies safety floor", () => {
  it("upgrades SAFE LLM verdict to CAUTION because of warn finding", async () => {
    const app = new Hono();
    mountJudge(app, {
      apiKey: "k",
      llmOverride: async (): Promise<JudgeVerdict> => ({ tier: "SAFE", headline: "fine", reasons: [], confidence: 0.9 }),
    });
    const res = await app.request("/judge", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify(baseInput),
    });
    const body = (await res.json()) as JudgeVerdict;
    expect(body.tier).toBe("CAUTION");
  });
});
