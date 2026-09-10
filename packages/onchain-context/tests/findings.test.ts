import { describe, it, expect } from "vitest";
import { graphFindings } from "../src/findings";
import type { OnchainContext } from "@intent-check/types";

const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("onchain-context — graphFindings", () => {
  it("flags a token impersonating a blue chip with no market behind it", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "USDC", canonical: false },
    };
    const fs = graphFindings(ctx, { claimedSymbol: "USDC" });
    expect(codes(fs)).toContain("GRAPH_TOKEN_IMPERSONATION");
    expect(fs[0]?.severity).toBe("danger");
  });

  it("stays quiet for a canonical token", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xusdc", symbol: "USDC", canonical: true, marketCapUsd: 5e8 },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "USDC" }))).not.toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });

  it("does not accuse an obscure token that never claimed to be a blue chip", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xsmall", symbol: "MYCOIN", canonical: false },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "MYCOIN" }))).not.toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });

  it("matches the claimed symbol case-insensitively", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "usdc", canonical: false },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "usdc" }))).toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });

  it("flags the drainer funnel shape", () => {
    const ctx: OnchainContext = {
      degraded: false,
      spender: {
        address: "0xdrainer",
        distinctInboundSenders48h: 412,
        outboundConcentration: 0.98,
      },
    };
    const fs = graphFindings(ctx, {});
    expect(codes(fs)).toContain("GRAPH_SPENDER_FUNNEL");
    expect(fs[0]?.text).toMatch(/412/);
  });

  it("does not flag a busy address that spreads its outflow", () => {
    const ctx: OnchainContext = {
      degraded: false,
      spender: { address: "0xrouter", distinctInboundSenders48h: 900, outboundConcentration: 0.05 },
    };
    expect(codes(graphFindings(ctx, {}))).not.toContain("GRAPH_SPENDER_FUNNEL");
  });

  it("does not flag a concentrated address with only a couple of payers", () => {
    const ctx: OnchainContext = {
      degraded: false,
      spender: { address: "0xpersonal", distinctInboundSenders48h: 2, outboundConcentration: 1 },
    };
    expect(codes(graphFindings(ctx, {}))).not.toContain("GRAPH_SPENDER_FUNNEL");
  });

  it("puts a dollar figure on an unlimited approval", () => {
    const ctx: OnchainContext = {
      degraded: false,
      wallet: { address: "0xme", totalUsd: 12400, balances: [] },
    };
    const fs = graphFindings(ctx, { isUnlimitedApproval: true });
    expect(codes(fs)).toContain("GRAPH_EXPOSURE_USD");
    expect(fs[0]?.text).toMatch(/12,400/);
  });

  it("says nothing about exposure when the approval is bounded", () => {
    const ctx: OnchainContext = {
      degraded: false,
      wallet: { address: "0xme", totalUsd: 12400, balances: [] },
    };
    expect(codes(graphFindings(ctx, { isUnlimitedApproval: false }))).not.toContain(
      "GRAPH_EXPOSURE_USD",
    );
  });

  it("produces nothing at all from an empty degraded context", () => {
    expect(graphFindings({ degraded: true }, {})).toEqual([]);
  });
});
