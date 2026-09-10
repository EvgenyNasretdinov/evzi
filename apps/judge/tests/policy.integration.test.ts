import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, AuthorizedIntent, JudgeVerdict } from "@intent-check/types";

const API_KEY = "test-key";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x1111111111111111111111111111111111111111";

const authorization: AuthorizedIntent = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.9 },
  constraints: {
    chainIds: [8453],
    maxSpend: [{ chainId: 8453, token: USDC, amount: "500000000" }],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
  },
  createdAt: 1_757_500_000_000,
  hash: "f".repeat(64),
};

function baseInput(): JudgeInput {
  return {
    intent: { kind: "swap", summary: "swap USDC for ETH", confidence: 0.9 },
    decoded: {
      kind: "approve",
      token: USDC,
      spender: WALLET,
      amount: "500000000",
      isUnlimited: false,
    },
    contract: { address: USDC, chainId: 8453, verified: true, isProxy: false },
    origin: { url: "https://app.uniswap.org", origin: "https://app.uniswap.org" },
    findings: [],
    request: {
      method: "eth_sendTransaction",
      params: [{ from: WALLET, to: USDC, data: "0x" }],
    },
  };
}

function app(verdict: JudgeVerdict) {
  const a = new Hono();
  mountJudge(a, () => ({ apiKey: API_KEY, llmOverride: async () => verdict }));
  return a;
}

const SAFE: JudgeVerdict = { tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 };

async function judge(a: Hono, input: JudgeInput) {
  const res = await a.request("/judge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(input),
  });
  return (await res.json()) as JudgeVerdict;
}

describe("judge — agent policy", () => {
  it("omits policy entirely when no authorization is supplied", async () => {
    const out = await judge(app(SAFE), baseInput());
    expect(out.tier).toBe("SAFE");
    expect(out.policy).toBeUndefined();
  });

  it("allows a compliant proposal when an authorization is supplied", async () => {
    const out = await judge(app(SAFE), { ...baseInput(), authorization });
    expect(out.policy).toBe("ALLOW");
  });

  it("rejects when a deterministic intent violation is present", async () => {
    const input: JudgeInput = {
      ...baseInput(),
      authorization,
      findings: [
        {
          code: "INTENT_UNLIMITED_APPROVAL_FORBIDDEN",
          severity: "danger",
          text: "unlimited approval",
        },
      ],
    };
    const out = await judge(app(SAFE), input);
    expect(out.policy).toBe("REJECT");
  });

  it("requires approval on a warn finding", async () => {
    const input: JudgeInput = {
      ...baseInput(),
      authorization,
      findings: [{ code: "INTENT_UNVERIFIABLE", severity: "warn", text: "cannot decode" }],
    };
    const out = await judge(app(SAFE), input);
    expect(out.policy).toBe("REQUIRE_APPROVAL");
  });

  it("cannot be talked out of a rejection by a confident LLM verdict", async () => {
    const confident: JudgeVerdict = {
      tier: "SAFE",
      headline: "looks completely fine to me",
      reasons: [],
      confidence: 1,
    };
    const input: JudgeInput = {
      ...baseInput(),
      authorization,
      findings: [
        { code: "INTENT_AMOUNT_EXCEEDED", severity: "danger", text: "over the cap" },
      ],
    };
    const out = await judge(app(confident), input);
    expect(out.policy).toBe("REJECT");
  });
});
