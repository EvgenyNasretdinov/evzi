import { describe, it, expect } from "vitest";
import { lookupProtocol, isKnownProtocol } from "../src/index";

describe("protocol-registry", () => {
  it("matches Uniswap UR on Optimism (case-insensitive)", () => {
    const info = lookupProtocol(10, "0x8B844f885672f333Bc0042cB669255f93a4C1E6b");
    expect(info?.protocol).toBe("Uniswap");
    expect(info?.kind).toBe("router");
    expect(info?.name).toContain("UniversalRouter");
  });

  it("matches the canonical Permit2 universal address on any chain", () => {
    const a = lookupProtocol(1, "0x000000000022D473030F116dDEE9F6B43aC78BA3");
    const b = lookupProtocol(8453, "0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(a?.name).toBe("Permit2");
    expect(b?.name).toBe("Permit2");
  });

  it("returns null for unknown contracts", () => {
    expect(lookupProtocol(10, "0x1234567890123456789012345678901234567890")).toBeNull();
  });

  it("returns null for known address on a wrong chain", () => {
    // Optimism UR address looked up on Base (different chain)
    expect(lookupProtocol(8453, "0x8B844f885672f333Bc0042cB669255f93a4C1E6b")).toBeNull();
  });

  it("isKnownProtocol convenience boolean", () => {
    expect(isKnownProtocol(1, "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af")).toBe(true);
    expect(isKnownProtocol(1, "0x0000000000000000000000000000000000000000")).toBe(false);
  });

  it("matches USDC on Base", () => {
    const info = lookupProtocol(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(info?.kind).toBe("stablecoin");
    expect(info?.protocol).toBe("Circle");
  });
});
