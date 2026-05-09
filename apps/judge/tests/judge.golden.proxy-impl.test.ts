import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict, ContractMeta } from "@intent-check/types";

const proxyMeta: ContractMeta = {
  address: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
  chainId: 1,
  verified: true,
  isProxy: true,
  proxyType: "EIP1967Proxy",
  implementation: {
    address: "0x751d7c0cf91a9b7704541b44e5ff7bec3d2caa6f",
    chainId: 1,
    verified: false,                       // the load-bearing fact
    isProxy: false,
  },
};

const input: JudgeInput = {
  intent: { kind: "approve", summary: "approve USDC for some app", confidence: 0.9 },
  decoded: {
    kind: "approve",
    token: { chainId: 1, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "max" },
    spender: proxyMeta.address,
    trusted: false,
  } as any,
  contract: proxyMeta,
  origin: { url: "https://example.com", origin: "https://example.com" },
  findings: [
    { code: "PROXY_IMPL_UNVERIFIED", severity: "warn", text: "EIP1967Proxy delegates calls to 0x751d7c0cf91a9b7704541b44e5ff7bec3d2caa6f, which is not verified on Sourcify" },
  ],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: proxyMeta.address }] },
};

describe("judge: proxy with unverified implementation", () => {
  it("escalates LLM SAFE → CAUTION via the safety floor (warn finding)", async () => {
    const app = new Hono();
    mountJudge(app, {
      apiKey: "k",
      llmOverride: async (): Promise<JudgeVerdict> => ({ tier: "SAFE", headline: "fine", reasons: [], confidence: 0.9 }),
    });
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(200);
    const verdict = (await res.json()) as JudgeVerdict;
    expect(verdict.tier).toBe("CAUTION");
  });
});
