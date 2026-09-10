import { describe, it, expect } from "vitest";
import { freezeIntent, checkIntegrity, type IntentDraft } from "../src/freeze";

const draft: IntentDraft = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, max 1% slippage, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.92 },
  constraints: {
    chainIds: [8453],
    maxSpend: [
      { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "500000000" },
    ],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
    maxSlippageBps: 100,
  },
  createdAt: 1_757_500_000_000,
};

describe("intent — freezeIntent", () => {
  it("produces a 64-char hex hash", async () => {
    const frozen = await freezeIntent(draft);
    expect(frozen.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same content", async () => {
    expect((await freezeIntent(draft)).hash).toBe((await freezeIntent(draft)).hash);
  });

  it("ignores key order in the draft", async () => {
    const reordered: IntentDraft = {
      createdAt: draft.createdAt,
      goal: draft.goal,
      raw: draft.raw,
      id: draft.id,
      constraints: draft.constraints,
    };
    expect((await freezeIntent(reordered)).hash).toBe((await freezeIntent(draft)).hash);
  });

  it("changes when a constraint changes", async () => {
    const loosened: IntentDraft = {
      ...draft,
      constraints: { ...draft.constraints, allowUnlimitedApproval: true },
    };
    expect((await freezeIntent(loosened)).hash).not.toBe((await freezeIntent(draft)).hash);
  });
});

describe("intent — checkIntegrity", () => {
  it("passes an untouched authorization", async () => {
    const frozen = await freezeIntent(draft);
    expect(await checkIntegrity(frozen, draft.createdAt + 1000)).toEqual([]);
  });

  it("flags INTENT_TAMPERED when a constraint was loosened after freezing", async () => {
    const frozen = await freezeIntent(draft);
    const tampered = {
      ...frozen,
      constraints: { ...frozen.constraints, allowUnlimitedApproval: true },
    };
    const findings = await checkIntegrity(tampered, draft.createdAt + 1000);
    expect(findings.map((f) => f.code)).toContain("INTENT_TAMPERED");
    expect(findings[0]?.severity).toBe("danger");
  });

  it("flags INTENT_EXPIRED past the deadline", async () => {
    const frozen = await freezeIntent({
      ...draft,
      constraints: { ...draft.constraints, expiresAt: draft.createdAt + 60_000 },
    });
    const findings = await checkIntegrity(frozen, draft.createdAt + 61_000);
    expect(findings.map((f) => f.code)).toContain("INTENT_EXPIRED");
  });

  it("does not flag expiry before the deadline", async () => {
    const frozen = await freezeIntent({
      ...draft,
      constraints: { ...draft.constraints, expiresAt: draft.createdAt + 60_000 },
    });
    expect(await checkIntegrity(frozen, draft.createdAt + 59_000)).toEqual([]);
  });
});
