import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

const API_KEY = "test-key";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x1111111111111111111111111111111111111111";

const SAFE: JudgeVerdict = { tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 };

function baseInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    intent: { kind: "approve", summary: "approve USDC", confidence: 0.9 },
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
    request: { method: "eth_sendTransaction", params: [{ from: WALLET, to: USDC, data: "0x" }] },
    ...overrides,
  };
}

/** Capture what the LLM was handed, so we can assert the context reached it. */
function appWith(opts: { graphApiKey?: string; onSeen?: (i: JudgeInput) => void }) {
  const a = new Hono();
  mountJudge(a, () => ({
    apiKey: API_KEY,
    graphApiKey: opts.graphApiKey,
    llmOverride: async (input) => {
      opts.onSeen?.(input);
      return SAFE;
    },
    // The override stands in for a configured credential, so it is only wired
    // up when one is present — otherwise "no credential" cannot be tested.
    onchainOverride: opts.graphApiKey
      ? async () => ({
          token: { address: USDC, symbol: "USDC", holders: 12, canonical: false },
          degraded: false,
        })
      : undefined,
  }));
  return a;
}

async function judge(a: Hono, input: JudgeInput) {
  const res = await a.request("/judge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(input),
  });
  return (await res.json()) as JudgeVerdict;
}

describe("judge — on-chain enrichment", () => {
  it("adds a Graph finding the caller never sent", async () => {
    let seen: JudgeInput | undefined;
    const out = await judge(
      appWith({ graphApiKey: "k", onSeen: (i) => (seen = i) }),
      baseInput(),
    );
    expect(seen?.findings.map((f) => f.code)).toContain("GRAPH_TOKEN_IMPERSONATION");
    expect(out.tier).toBe("DANGER");
  });

  it("hands the on-chain context to the model, not just the findings", async () => {
    let seen: JudgeInput | undefined;
    await judge(appWith({ graphApiKey: "k", onSeen: (i) => (seen = i) }), baseInput());
    expect(seen?.onchain?.token?.holders).toBe(12);
  });

  it("does nothing when no Graph credential is configured", async () => {
    let seen: JudgeInput | undefined;
    const out = await judge(appWith({ onSeen: (i) => (seen = i) }), baseInput());
    expect(seen?.findings).toEqual([]);
    expect(seen?.onchain).toBeUndefined();
    expect(out.tier).toBe("SAFE");
  });

  it("keeps a context the caller already supplied rather than refetching", async () => {
    let seen: JudgeInput | undefined;
    await judge(
      appWith({ graphApiKey: "k", onSeen: (i) => (seen = i) }),
      baseInput({ onchain: { token: { address: USDC, canonical: true }, degraded: false } }),
    );
    expect(seen?.onchain?.token?.canonical).toBe(true);
    expect(seen?.findings.map((f) => f.code)).not.toContain("GRAPH_TOKEN_IMPERSONATION");
  });

  it("preserves findings the caller computed locally", async () => {
    let seen: JudgeInput | undefined;
    await judge(
      appWith({ graphApiKey: "k", onSeen: (i) => (seen = i) }),
      baseInput({
        findings: [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "local finding" }],
      }),
    );
    expect(seen?.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["UNLIMITED_APPROVAL", "GRAPH_TOKEN_IMPERSONATION"]),
    );
  });
});
