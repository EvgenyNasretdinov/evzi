import { describe, it, expect } from "vitest";
import { authorizationMessage, freezeIntent, checkIntegrity, type IntentDraft } from "../src/freeze";
import type { AuthorizedIntent } from "@intent-check/types";

const WALLET = "0xd55deD742Af04444846cc3B52C6d56abe2F954f3";

const draft: IntentDraft = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.9 },
  constraints: {
    chainIds: [8453],
    maxSpend: [{ chainId: 8453, token: "0xusdc", amount: "500000000" }],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
  },
  createdAt: 1_757_500_000_000,
};

/** Stands in for a wallet: returns the address it was told to return. */
const recoverAs = (addr: string) => async () => addr;

describe("intent — authorizationMessage", () => {
  it("is human-readable, so a wallet can show what is being signed", async () => {
    const frozen = await freezeIntent(draft);
    const msg = authorizationMessage(frozen);
    expect(msg).toContain("Evzi authorization");
    expect(msg).toContain(draft.raw);
    expect(msg).toContain("unlimited approvals: forbidden");
  });

  it("binds the hash, so the signature covers every constraint", async () => {
    const frozen = await freezeIntent(draft);
    expect(authorizationMessage(frozen)).toContain(frozen.hash);
  });

  it("changes when a constraint changes", async () => {
    const a = await freezeIntent(draft);
    const b = await freezeIntent({
      ...draft,
      constraints: { ...draft.constraints, allowUnlimitedApproval: true },
    });
    expect(authorizationMessage(a)).not.toBe(authorizationMessage(b));
  });
});

describe("intent — signature checking", () => {
  const signed = async (over: Partial<AuthorizedIntent> = {}): Promise<AuthorizedIntent> => ({
    ...(await freezeIntent(draft)),
    signer: WALLET,
    signature: "0xdeadbeef",
    ...over,
  });

  it("accepts a signature that recovers to the declared signer", async () => {
    const findings = await checkIntegrity(await signed(), {
      recoverSigner: recoverAs(WALLET),
    });
    expect(findings).toEqual([]);
  });

  it("is case-insensitive about the recovered address", async () => {
    const findings = await checkIntegrity(await signed(), {
      recoverSigner: recoverAs(WALLET.toLowerCase()),
    });
    expect(findings).toEqual([]);
  });

  it("flags a signature that recovers to someone else", async () => {
    const findings = await checkIntegrity(await signed(), {
      recoverSigner: recoverAs("0x1111111111111111111111111111111111111111"),
    });
    expect(findings.map((f) => f.code)).toContain("INTENT_SIGNATURE_INVALID");
    expect(findings[0]?.severity).toBe("danger");
  });

  it("flags a signature that cannot be recovered at all", async () => {
    const findings = await checkIntegrity(await signed(), {
      recoverSigner: async () => {
        throw new Error("malformed signature");
      },
    });
    expect(findings.map((f) => f.code)).toContain("INTENT_SIGNATURE_INVALID");
  });

  it("warns when an authorization carries no signature", async () => {
    const findings = await checkIntegrity(await freezeIntent(draft), {
      recoverSigner: recoverAs(WALLET),
    });
    expect(findings.map((f) => f.code)).toContain("INTENT_UNSIGNED");
    expect(findings[0]?.severity).toBe("warn");
  });

  it("says nothing about signatures when no recovery is available", async () => {
    expect(await checkIntegrity(await freezeIntent(draft))).toEqual([]);
  });

  it("still catches tampering even when the signature checks out", async () => {
    const s = await signed();
    const tampered = {
      ...s,
      constraints: { ...s.constraints, allowUnlimitedApproval: true },
    };
    const findings = await checkIntegrity(tampered, { recoverSigner: recoverAs(WALLET) });
    expect(findings.map((f) => f.code)).toContain("INTENT_TAMPERED");
  });
});
