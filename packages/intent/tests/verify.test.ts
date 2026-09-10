import { describe, it, expect } from "vitest";
import { verifyAgainstIntent, type VerifyContext } from "../src/verify";
import { MAX_UINT256 } from "../src/spend";
import type { AuthorizedIntent, DecodedAction } from "@intent-check/types";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x1111111111111111111111111111111111111111";

const intent: AuthorizedIntent = {
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

const ctx: VerifyContext = { chainId: 8453, wallet: WALLET };
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("intent — verifyAgainstIntent", () => {
  it("passes a swap that stays inside every constraint", () => {
    const decoded: DecodedAction = {
      kind: "swap",
      tokenIn: { chainId: 8453, address: USDC, amount: "500000000" },
      tokenOut: { chainId: 8453, address: "ETH", amount: "0" },
      minAmountOut: "0",
      recipient: WALLET,
      router: "0xr",
      protocol: "Uniswap",
    };
    expect(verifyAgainstIntent(intent, decoded, ctx)).toEqual([]);
  });

  it("rejects an unlimited approval the human forbade", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: "0xdead",
      amount: MAX_UINT256,
      isUnlimited: true,
    };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_UNLIMITED_APPROVAL_FORBIDDEN");
    expect(findings.every((f) => f.severity === "danger")).toBe(true);
  });

  it("allows an unlimited approval when the human explicitly permitted it", () => {
    const permissive: AuthorizedIntent = {
      ...intent,
      constraints: { ...intent.constraints, allowUnlimitedApproval: true },
    };
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: WALLET,
      amount: MAX_UINT256,
      isUnlimited: true,
    };
    expect(codes(verifyAgainstIntent(permissive, decoded, ctx))).not.toContain(
      "INTENT_UNLIMITED_APPROVAL_FORBIDDEN",
    );
  });

  it("rejects a spend above the cap and names both numbers", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: WALLET,
      amount: "600000000",
      isUnlimited: false,
    };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_AMOUNT_EXCEEDED");
    expect(findings[0]?.text).toMatch(/600|500/);
  });

  it("accepts a spend exactly at the cap", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: WALLET,
      amount: "500000000",
      isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx))).not.toContain(
      "INTENT_AMOUNT_EXCEEDED",
    );
  });

  it("rejects a chain the authorization never mentioned", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: WALLET,
      amount: "1",
      isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, { ...ctx, chainId: 1 }))).toContain(
      "INTENT_CHAIN_MISMATCH",
    );
  });

  it("rejects a third-party recipient when only the user's wallet is allowed", () => {
    const decoded: DecodedAction = { kind: "transfer", token: USDC, to: "0xbob", amount: "1" };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx))).toContain(
      "INTENT_RECIPIENT_NOT_ALLOWED",
    );
  });

  it("accepts a recipient the human listed explicitly", () => {
    const withRecipient: AuthorizedIntent = {
      ...intent,
      constraints: { ...intent.constraints, allowedRecipients: ["0xBOB"] },
    };
    const decoded: DecodedAction = { kind: "transfer", token: USDC, to: "0xbob", amount: "1" };
    expect(codes(verifyAgainstIntent(withRecipient, decoded, ctx))).not.toContain(
      "INTENT_RECIPIENT_NOT_ALLOWED",
    );
  });

  it("rejects a token the authorization never named", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: "0xother",
      spender: WALLET,
      amount: "1",
      isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx))).toContain("INTENT_TOKEN_MISMATCH");
  });

  it("warns rather than rejects when the calldata could not be decoded", () => {
    const decoded: DecodedAction = { kind: "unknown", selector: "0x12345678" };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_UNVERIFIABLE");
    expect(findings[0]?.severity).toBe("warn");
  });

  it("reports every violation at once, not just the first", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: "0xother",
      spender: "0xdead",
      amount: MAX_UINT256,
      isUnlimited: true,
    };
    const found = codes(verifyAgainstIntent(intent, decoded, { ...ctx, chainId: 1 }));
    expect(found).toContain("INTENT_CHAIN_MISMATCH");
    expect(found).toContain("INTENT_UNLIMITED_APPROVAL_FORBIDDEN");
    expect(found).toContain("INTENT_TOKEN_MISMATCH");
  });
});
