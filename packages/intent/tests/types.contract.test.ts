import { describe, it, expect } from "vitest";
import type {
  AuthorizedIntent,
  IntentConstraints,
  OnchainContext,
  AgentPolicy,
  JudgeVerdict,
} from "@intent-check/types";

describe("intent — shared types", () => {
  it("builds a minimal AuthorizedIntent", () => {
    const constraints: IntentConstraints = {
      chainIds: [8453],
      maxSpend: [{ chainId: 8453, token: "0xaaa", amount: "500000000" }],
      allowedRecipients: [],
      allowUnlimitedApproval: false,
    };
    const intent: AuthorizedIntent = {
      id: "b1",
      raw: "swap at most 500 USDC to ETH on Base",
      goal: { kind: "swap", summary: "swap 500 USDC for ETH", confidence: 0.9 },
      constraints,
      createdAt: 1_757_500_000_000,
      hash: "deadbeef",
    };
    expect(intent.constraints.allowUnlimitedApproval).toBe(false);
    expect(intent.constraints.maxSlippageBps).toBeUndefined();
  });

  it("lets a verdict carry a policy without breaking verdicts that do not", () => {
    const withoutPolicy: JudgeVerdict = {
      tier: "SAFE",
      headline: "ok",
      reasons: [],
      confidence: 0.9,
    };
    const policy: AgentPolicy = "REQUIRE_APPROVAL";
    const withPolicy: JudgeVerdict = { ...withoutPolicy, policy };
    expect(withoutPolicy.policy).toBeUndefined();
    expect(withPolicy.policy).toBe("REQUIRE_APPROVAL");
  });

  it("marks a degraded on-chain context", () => {
    const ctx: OnchainContext = { degraded: true };
    expect(ctx.spender).toBeUndefined();
  });
});
