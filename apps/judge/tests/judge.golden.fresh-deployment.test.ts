import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict, ContractMeta } from "@intent-check/types";

const newContract: ContractMeta = {
  address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  chainId: 1,
  verified: true,
  isProxy: false,
  deployment: { blockNumber: 19_000_000, ageDays: 0.5 },
};

const input: JudgeInput = {
  intent: { kind: "approve", summary: "approve token spend on a new app", confidence: 0.9 },
  decoded: { kind: "approve", spender: newContract.address, trusted: false } as any,
  contract: newContract,
  origin: { url: "https://looksrandom.example/", origin: "https://looksrandom.example" },
  findings: [
    { code: "BRAND_NEW_CONTRACT", severity: "danger", text: "Contract deployed <24h ago" },
  ],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: newContract.address }] },
};

describe("judge: brand-new contract", () => {
  it("escalates LLM SAFE → DANGER via the safety floor (danger finding)", async () => {
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
    const verdict = (await res.json()) as JudgeVerdict;
    expect(verdict.tier).toBe("DANGER");
  });
});
