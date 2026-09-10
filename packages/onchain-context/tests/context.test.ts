import { describe, it, expect } from "vitest";
import { fetchOnchainContext } from "../src/context";

describe("onchain-context — fetchOnchainContext", () => {
  it("marks degraded when a requested source returns nothing", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: "0xusdc",
      graphApiKey: "k",
      deps: { tokenReputation: async () => undefined },
    });
    expect(ctx.degraded).toBe(true);
    expect(ctx.token).toBeUndefined();
  });

  it("is not degraded when every requested source answers", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: "0xusdc",
      graphApiKey: "k",
      deps: {
        tokenReputation: async () => ({ address: "0xusdc", canonical: true, symbol: "USDC" }),
      },
    });
    expect(ctx.degraded).toBe(false);
    expect(ctx.token?.canonical).toBe(true);
  });

  it("does not mark degraded for sources that were never requested", async () => {
    const ctx = await fetchOnchainContext({ chainId: 1 });
    expect(ctx.degraded).toBe(false);
  });

  it("skips a source when its credential is missing", async () => {
    let called = false;
    const ctx = await fetchOnchainContext({
      chainId: 1,
      wallet: "0xme",
      deps: {
        walletBalances: async () => {
          called = true;
          return undefined;
        },
      },
    });
    expect(called).toBe(false);
    expect(ctx.degraded).toBe(false);
  });

  it("degrades rather than hanging when a source exceeds the timeout", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: "0xusdc",
      graphApiKey: "k",
      timeoutMs: 10,
      deps: {
        tokenReputation: () =>
          new Promise((r) => setTimeout(() => r({ address: "0xusdc", canonical: true }), 200)),
      },
    });
    expect(ctx.degraded).toBe(true);
    expect(ctx.token).toBeUndefined();
  });

  it("degrades when one source fails but keeps the one that succeeded", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: "0xusdc",
      wallet: "0xme",
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: "0xusdc", canonical: true }),
        walletBalances: async () => undefined,
      },
    });
    expect(ctx.token?.canonical).toBe(true);
    expect(ctx.wallet).toBeUndefined();
    expect(ctx.degraded).toBe(true);
  });

  it("never rejects, even when a provider throws", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: "0xusdc",
      graphApiKey: "k",
      deps: {
        tokenReputation: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(ctx.degraded).toBe(true);
  });
});
