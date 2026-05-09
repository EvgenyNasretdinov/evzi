import { describe, it, expect } from "vitest";
import { formatTokenAmount, isNativeAddress, nativeMeta } from "../src/index";

describe("token-metadata — isNativeAddress", () => {
  it("recognizes the zero address", () => {
    expect(isNativeAddress("0x0000000000000000000000000000000000000000")).toBe(true);
  });
  it("recognizes the EEEE… sentinel", () => {
    expect(isNativeAddress("0xeeeeEEEEeeeeeeEEEEeeeeeeEeEeeeEEeEEEEeEE")).toBe(true);
  });
  it("recognizes 'ETH' literal", () => {
    expect(isNativeAddress("ETH")).toBe(true);
  });
  it("rejects normal token addresses", () => {
    expect(isNativeAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(false);
  });
});

describe("token-metadata — nativeMeta", () => {
  it("returns ETH 18 for Optimism", () => {
    const m = nativeMeta(10);
    expect(m.symbol).toBe("ETH");
    expect(m.decimals).toBe(18);
  });
  it("returns MATIC 18 for Polygon", () => {
    const m = nativeMeta(137);
    expect(m.symbol).toBe("MATIC");
  });
  it("falls back to ETH 18 on unknown chain", () => {
    const m = nativeMeta(99999999);
    expect(m.symbol).toBe("ETH");
    expect(m.decimals).toBe(18);
  });
});

describe("token-metadata — formatTokenAmount", () => {
  it("formats USDC (6 decimals)", () => {
    expect(formatTokenAmount("100000000", 6)).toBe("100");
    expect(formatTokenAmount("123456000", 6)).toBe("123.456");
  });

  it("formats ETH (18 decimals)", () => {
    expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
    expect(formatTokenAmount("700000000000000", 18, 6)).toBe("0.0007");
  });

  it("preserves the negative sign", () => {
    expect(formatTokenAmount("-700000000000000", 18, 6)).toBe("−0.0007");
  });

  it("returns '0' for zero amount", () => {
    expect(formatTokenAmount("0", 18)).toBe("0");
  });

  it("handles tiny fractions by trimming to displayDp", () => {
    // 1 wei → 1e-18 — at displayDp=6 this rounds to 0.000000.
    expect(formatTokenAmount("1", 18, 6)).toBe("0");
  });

  it("trims trailing zeros", () => {
    expect(formatTokenAmount("123000000", 6)).toBe("123");
    expect(formatTokenAmount("123100000", 6)).toBe("123.1");
  });

  it("falls back to raw for absurd decimals", () => {
    expect(formatTokenAmount("100", 100)).toBe("100");
  });
});
