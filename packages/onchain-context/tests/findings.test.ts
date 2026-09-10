import { describe, it, expect } from "vitest";
import { graphFindings } from "../src/findings";
import type { OnchainContext } from "@intent-check/types";

const codes = (fs: { code: string }[]) => fs.map((f) => f.code);
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("onchain-context — token impersonation", () => {
  it("flags a counterfeit blue chip and cites the holder count", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "USDC", holders: 12, canonical: false },
    };
    const fs = graphFindings(ctx, { claimedSymbol: "USDC" });
    expect(codes(fs)).toContain("GRAPH_TOKEN_IMPERSONATION");
    expect(fs[0]?.severity).toBe("danger");
    expect(fs[0]?.text).toMatch(/12 holders/);
  });

  it("words it differently when nobody holds it at all", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "USDC", holders: 0, canonical: false },
    };
    expect(graphFindings(ctx, { claimedSymbol: "USDC" })[0]?.text).toMatch(/never seen anyone hold/);
  });

  it("falls back to a market phrasing when holder data is absent", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "USDC", canonical: false },
    };
    expect(graphFindings(ctx, { claimedSymbol: "USDC" })[0]?.text).toMatch(/no real market/);
  });

  it("stays quiet for a canonical token", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: USDC, symbol: "USDC", holders: 8_787_430, canonical: true },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "USDC" }))).not.toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });

  it("does not accuse an obscure token that never claimed to be a blue chip", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xsmall", symbol: "MYCOIN", holders: 3, canonical: false },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "MYCOIN" }))).toEqual([]);
  });

  it("matches the claimed symbol case-insensitively", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "usdc", holders: 1, canonical: false },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "usdc" }))).toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });
});

describe("onchain-context — approval exposure", () => {
  const ctx: OnchainContext = {
    degraded: false,
    wallet: {
      address: "0xme",
      balances: [{ token: USDC, symbol: "USDC", amount: "12400000000", quantity: 12400 }],
    },
  };

  it("names the whole balance an unlimited approval would expose", () => {
    const fs = graphFindings(ctx, { isUnlimitedApproval: true, approvedToken: USDC });
    expect(codes(fs)).toContain("GRAPH_EXPOSURE");
    expect(fs[0]?.text).toMatch(/12,400 USDC/);
    expect(fs[0]?.severity).toBe("warn");
  });

  it("says nothing when the approval is bounded", () => {
    expect(codes(graphFindings(ctx, { isUnlimitedApproval: false, approvedToken: USDC }))).toEqual(
      [],
    );
  });

  it("says nothing about a token the wallet does not hold", () => {
    expect(
      codes(graphFindings(ctx, { isUnlimitedApproval: true, approvedToken: "0xother" })),
    ).toEqual([]);
  });

  it("matches the approved token case-insensitively", () => {
    const fs = graphFindings(ctx, {
      isUnlimitedApproval: true,
      approvedToken: USDC.toUpperCase(),
    });
    expect(codes(fs)).toContain("GRAPH_EXPOSURE");
  });

  it("produces nothing at all from an empty degraded context", () => {
    expect(graphFindings({ degraded: true }, { isUnlimitedApproval: true })).toEqual([]);
  });
});
