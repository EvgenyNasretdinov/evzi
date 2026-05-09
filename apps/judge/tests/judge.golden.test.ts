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

  // ---- M3a signature drainer scenarios ----

  it("legitimate Permit2 to a known router stays SAFE", async () => {
    const a = app({ tier: "SAFE", headline: "Authorize Uniswap to swap your USDC.", reasons: [], confidence: 0.9 });
    const input: JudgeInput = {
      intent: { kind: "approve", summary: "Approve USDC for Uniswap swap", confidence: 0.9 },
      decoded: {
        kind: "permit2Transfer",
        permitted: [{ chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" }],
        spender: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
        deadline: "1800000000",
      },
      contract: {
        address: "0x000000000022d473030f116ddee9f6b43ac78ba3",
        chainId: 8453, verified: true, isProxy: false,
        knownProtocol: { protocol: "Permit2", name: "Permit2", kind: "permit2" },
      },
      origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
      findings: [],
      request: { method: "eth_signTypedData_v4", params: ["0xfrom", "{}"] },
    };
    const r = await call(a, input);
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("SAFE");
  });

  it("Permit2 batch transfer to unknown spender → DANGER (drainer scene)", async () => {
    const a = app({ tier: "SAFE", headline: "Looks like a token approval.", reasons: [], confidence: 0.5 });
    const findings: Finding[] = [{
      code: "PERMIT2_SPENDER_UNKNOWN",
      severity: "danger",
      text: "Permit2 signature authorizes 0xdEaD to move 3 tokens — spender is not a recognized protocol.",
    }];
    const input: JudgeInput = {
      intent: { kind: "approve", summary: "Claim airdrop", confidence: 0.6 },
      decoded: {
        kind: "permit2Transfer",
        permitted: [
          { chainId: 1, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "999999999" },
          { chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", amount: "999999999" },
          { chainId: 1, address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", amount: "999999999" },
        ],
        spender: "0x000000000000000000000000000000000000dEaD",
        deadline: "1800000000",
      },
      contract: {
        address: "0x000000000022d473030f116ddee9f6b43ac78ba3",
        chainId: 1, verified: true, isProxy: false,
        knownProtocol: { protocol: "Permit2", name: "Permit2", kind: "permit2" },
      },
      origin: { url: "https://airdrop.demo/", origin: "https://airdrop.demo" },
      findings,
      request: { method: "eth_signTypedData_v4", params: ["0xfrom", "{}"] },
    };
    const r = await call(a, input);
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("DANGER");
    expect(body.headline.toLowerCase()).toContain("stop");
  });

  it("Seaport zero-price offer → DANGER", async () => {
    const a = app({ tier: "SAFE", headline: "Sign listing", reasons: [], confidence: 0.5 });
    const findings: Finding[] = [{
      code: "SEAPORT_ZERO_PRICE_OFFER",
      severity: "danger",
      text: "Seaport order offers your assets for zero consideration — equivalent to giving them away.",
    }];
    const input: JudgeInput = {
      intent: { kind: "sign", summary: "Sign Seaport order", confidence: 0.4 },
      decoded: {
        kind: "seaportOrder",
        offerer: "0xfrom",
        offer: [{ chainId: 1, address: "0x1111111111111111111111111111111111111111", amount: "1" }],
        consideration: [{ chainId: 1, address: "0x0000000000000000000000000000000000000000", amount: "0" }],
      },
      contract: {
        address: "0x0000000000000068F116a894984e2DB1123eB395",
        chainId: 1, verified: true, isProxy: false,
        knownProtocol: { protocol: "Seaport", name: "Seaport 1.6", kind: "marketplace" },
      },
      origin: { url: "https://opensea.demo/", origin: "https://opensea.demo" },
      findings,
      request: { method: "eth_signTypedData_v4", params: ["0xfrom", "{}"] },
    };
    const r = await call(a, input);
    const body = (await r.json()) as JudgeVerdict;
    expect(body.tier).toBe("DANGER");
  });
});
