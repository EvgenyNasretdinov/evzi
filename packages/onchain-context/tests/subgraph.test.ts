import { describe, it, expect } from "vitest";
import { fetchTokenReputation, SUBGRAPH_SOURCES } from "../src/subgraph";

const USDC_MAINNET = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
}

/** Capture the outgoing request so we can assert which subgraph was queried. */
function spyFetch(body: unknown): { impl: typeof fetch; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("onchain-context — fetchTokenReputation, mainnet (Uniswap schema)", () => {
  it("reports a liquid, heavily used token as canonical", async () => {
    const f = fakeFetch({
      data: {
        token: {
          symbol: "USDC",
          name: "USD Coin",
          decimals: "6",
          txCount: "38557065",
          totalValueLockedUSD: "586157778.40",
          volumeUSD: "1027899123005.06",
        },
      },
    });
    const out = await fetchTokenReputation({
      chainId: 1,
      token: USDC_MAINNET,
      apiKey: "k",
      fetchImpl: f,
    });
    expect(out).toMatchObject({ symbol: "USDC", canonical: true });
    expect(out?.marketCapUsd).toBeGreaterThan(1_000_000);
  });

  it("reports a token the subgraph has never seen as non-canonical", async () => {
    const f = fakeFetch({ data: { token: null } });
    const out = await fetchTokenReputation({
      chainId: 1,
      token: "0xdead",
      apiKey: "k",
      fetchImpl: f,
    });
    expect(out).toMatchObject({ canonical: false });
    expect(out?.marketCapUsd).toBeUndefined();
  });

  it("treats a token with negligible liquidity as non-canonical", async () => {
    const f = fakeFetch({
      data: {
        token: {
          symbol: "USDC",
          name: "USD Coin",
          decimals: "6",
          txCount: "3",
          totalValueLockedUSD: "12.5",
          volumeUSD: "40",
        },
      },
    });
    const out = await fetchTokenReputation({
      chainId: 1,
      token: "0xfake",
      apiKey: "k",
      fetchImpl: f,
    });
    expect(out?.canonical).toBe(false);
  });
});

describe("onchain-context — fetchTokenReputation, Base (Messari schema)", () => {
  it("reads the underscore-prefixed TVL field the Base subgraph actually exposes", async () => {
    const f = fakeFetch({
      data: {
        token: {
          symbol: "USDC",
          name: "USD Coin",
          lastPriceUSD: "0.9992395775117275",
          _totalValueLockedUSD: "75634116.27969308",
          _totalSupply: "75691673930725",
        },
      },
    });
    const out = await fetchTokenReputation({
      chainId: 8453,
      token: USDC_BASE,
      apiKey: "k",
      fetchImpl: f,
    });
    expect(out).toMatchObject({ symbol: "USDC", canonical: true });
    expect(out?.marketCapUsd).toBeGreaterThan(70_000_000);
  });

  it("queries the Base deployment, not the mainnet one", async () => {
    const { impl, calls } = spyFetch({ data: { token: null } });
    await fetchTokenReputation({ chainId: 8453, token: USDC_BASE, apiKey: "k", fetchImpl: impl });
    expect(calls[0]?.url).toContain(SUBGRAPH_SOURCES[8453]!.id);
    expect(calls[0]?.url).not.toContain(SUBGRAPH_SOURCES[1]!.id);
  });

  it("sends the Messari field names to Base and the Uniswap ones to mainnet", async () => {
    const base = spyFetch({ data: { token: null } });
    await fetchTokenReputation({ chainId: 8453, token: USDC_BASE, apiKey: "k", fetchImpl: base.impl });
    expect(base.calls[0]?.body).toContain("_totalValueLockedUSD");
    expect(base.calls[0]?.body).not.toContain("txCount");

    const main = spyFetch({ data: { token: null } });
    await fetchTokenReputation({
      chainId: 1,
      token: USDC_MAINNET,
      apiKey: "k",
      fetchImpl: main.impl,
    });
    expect(main.calls[0]?.body).toContain("totalValueLockedUSD");
    expect(main.calls[0]?.body).toContain("txCount");
  });
});

describe("onchain-context — fetchTokenReputation, failure modes", () => {
  it("returns undefined rather than throwing when the gateway errors", async () => {
    const f = fakeFetch({ errors: [{ message: "boom" }] }, false);
    await expect(
      fetchTokenReputation({ chainId: 1, token: USDC_MAINNET, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the gateway answers 200 with GraphQL errors", async () => {
    const f = fakeFetch({ errors: [{ message: "subgraph not found" }] });
    await expect(
      fetchTokenReputation({ chainId: 1, token: USDC_MAINNET, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for a chain with no configured subgraph", async () => {
    const f = fakeFetch({ data: { token: null } });
    await expect(
      fetchTokenReputation({ chainId: 999999, token: USDC_MAINNET, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the network call throws outright", async () => {
    const f = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(
      fetchTokenReputation({ chainId: 1, token: USDC_MAINNET, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});
