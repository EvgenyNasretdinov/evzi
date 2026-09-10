import { describe, it, expect, beforeEach } from "vitest";
import { fetchOnchainContext } from "../src/context";
import { clearCache, drainInflight } from "../src/cache";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("onchain-context — fetchOnchainContext", () => {
  beforeEach(() => clearCache());

  it("merges liquidity and holder evidence into one token verdict", async () => {
    const args = {
      chainId: 1,
      token: USDC,
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: USDC, canonical: true, marketCapUsd: 5e8 }),
        tokenStats: async () => ({ address: USDC, canonical: true, symbol: "USDC", holders: 8_787_430 }),
      },
    };
    // First call warms the slow source; the second reads it from cache.
    await fetchOnchainContext(args);
    await drainInflight();
    const ctx = await fetchOnchainContext(args);
    expect(ctx.token).toMatchObject({
      symbol: "USDC",
      holders: 8_787_430,
      marketCapUsd: 5e8,
      canonical: true,
    });
    expect(ctx.degraded).toBe(false);
  });

  it("still vouches for a token when only one product can see it", async () => {
    const args = {
      chainId: 1,
      token: USDC,
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: USDC, canonical: false }),
        tokenStats: async () => ({ address: USDC, canonical: true, holders: 8_787_430 }),
      },
    };
    await fetchOnchainContext(args);
    await drainInflight();
    expect((await fetchOnchainContext(args)).token?.canonical).toBe(true);
  });

  it("does not wait for the slow source on a cold cache", async () => {
    let resolved = false;
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: USDC,
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: USDC, canonical: true }),
        tokenStats: () =>
          new Promise((r) =>
            setTimeout(() => {
              resolved = true;
              r({ address: USDC, canonical: true, holders: 1 });
            }, 50),
          ),
      },
    });
    // The verdict is already formed while the Token API call is still running.
    expect(resolved).toBe(false);
    expect(ctx.token?.canonical).toBe(true);
    expect(ctx.token?.holders).toBeUndefined();
    await drainInflight();
  });

  it("condemns a token only when both products decline to vouch", async () => {
    const args = {
      chainId: 1,
      token: "0xfake",
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: "0xfake", canonical: false }),
        tokenStats: async () => ({ address: "0xfake", canonical: false, holders: 12 }),
      },
    };
    await fetchOnchainContext(args);
    await drainInflight();
    const ctx = await fetchOnchainContext(args);
    expect(ctx.token?.canonical).toBe(false);
    expect(ctx.token?.holders).toBe(12);
  });

  it("marks degraded when a requested source returns nothing", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: USDC,
      graphApiKey: "k",
      deps: { tokenReputation: async () => undefined },
    });
    expect(ctx.degraded).toBe(true);
    expect(ctx.token).toBeUndefined();
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
      token: USDC,
      graphApiKey: "k",
      timeoutMs: 10,
      deps: {
        tokenReputation: () =>
          new Promise((r) => setTimeout(() => r({ address: USDC, canonical: true }), 200)),
      },
    });
    expect(ctx.degraded).toBe(true);
  });

  it("keeps the source that succeeded when another fails", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1,
      token: USDC,
      wallet: "0xme",
      graphApiKey: "k",
      tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: USDC, canonical: true }),
        tokenStats: async () => undefined,
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
      token: USDC,
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
