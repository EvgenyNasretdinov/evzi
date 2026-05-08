import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict, Finding } from "@intent-check/types";

function makeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  const base: JudgeInput = {
    intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
    decoded: { kind: "swap", tokenIn: { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" }, tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" }, minAmountOut: "28000000000000000", recipient: "0x0", router: "0x6fF5693b99212Da76ad316178A184AB56D299b43", protocol: "Uniswap" },
    contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false, contractName: "UniversalRouter" },
    origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
    findings: [],
    request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x6fF5693b99212Da76ad316178A184AB56D299b43" }] },
  };
  return { ...base, ...overrides } as JudgeInput;
}

describe("/judge golden scenarios", () => {
  function app(stub: JudgeVerdict) {
    const a = new Hono();
    mountJudge(a, { apiKey: "k", llmOverride: async () => stub });
    return a;
  }
  async function call(a: Hono, input: JudgeInput) {
    return a.request("/judge", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "k" }, body: JSON.stringify(input) });
  }

  it("matched-swap stays SAFE", async () => {
    const a = app({ tier: "SAFE", headline: "Looks safe — swap matches.", reasons: [], confidence: 0.9 });
    const r = await call(a, makeInput());
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("SAFE");
  });

  it("unverified contract upgrades to CAUTION via floor", async () => {
    const a = app({ tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 });
    const findings: Finding[] = [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "not verified" }];
    const r = await call(a, makeInput({ findings }));
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("CAUTION");
  });

  it("unlimited approval gets DANGER even if LLM says SAFE", async () => {
    const a = app({ tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 });
    const findings: Finding[] = [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "unlimited approval to 0xabc" }];
    const r = await call(a, makeInput({ findings }));
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("DANGER");
    expect(body.headline.toLowerCase()).toContain("stop");
  });
});
