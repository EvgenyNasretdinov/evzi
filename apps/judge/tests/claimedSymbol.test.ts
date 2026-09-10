import { describe, it, expect } from "vitest";
import { claimedSymbolFor } from "../src/claimedSymbol";
import type { JudgeInput } from "@intent-check/types";

const FAKE = "0x000000000000000000000000000000000000dead";
const W = "0x1111111111111111111111111111111111111111";

const base = (o: Partial<JudgeInput> = {}): JudgeInput => ({
  intent: { kind: "approve", summary: "approve USDC for the swap", confidence: 0.9 },
  decoded: { kind: "approve", token: FAKE, spender: W, amount: "1", isUnlimited: false },
  contract: { address: FAKE, chainId: 1, verified: true, isProxy: false },
  origin: { url: "https://x.io", origin: "https://x.io" },
  findings: [],
  request: { method: "eth_sendTransaction", params: [{ from: W, to: FAKE, data: "0x" }] },
  ...o,
});

describe("judge — claimedSymbolFor", () => {
  it("prefers the token's own resolved metadata", () => {
    const input = base({
      netEffect: { wallet: W, deltas: [{ chainId: 1, token: FAKE, symbol: "USDC", amount: "-1" }] },
    });
    expect(claimedSymbolFor(input, FAKE)).toBe("USDC");
  });

  it("falls back to the symbol named in the intent's token list", () => {
    const input = base({
      intent: {
        kind: "approve",
        summary: "approve something",
        confidence: 0.9,
        tokensIn: [{ chainId: 1, address: FAKE, symbol: "USDT", amount: "1" }],
      },
    });
    expect(claimedSymbolFor(input, FAKE)).toBe("USDT");
  });

  it("falls back to a blue chip named in the summary the user read", () => {
    expect(claimedSymbolFor(base(), FAKE)).toBe("USDC");
  });

  it("returns nothing when no blue chip was claimed anywhere", () => {
    const input = base({ intent: { kind: "approve", summary: "approve MYCOIN", confidence: 0.9 } });
    expect(claimedSymbolFor(input, FAKE)).toBeUndefined();
  });

  it("returns nothing without a token", () => {
    expect(claimedSymbolFor(base(), undefined)).toBeUndefined();
  });

  it("matches the token address case-insensitively", () => {
    const input = base({
      netEffect: {
        wallet: W,
        deltas: [{ chainId: 1, token: FAKE.toUpperCase(), symbol: "WETH", amount: "-1" }],
      },
    });
    expect(claimedSymbolFor(input, FAKE)).toBe("WETH");
  });
});
