import { describe, it, expect } from "vitest";
import { fetchTokenStats, fetchWalletBalances } from "../src/tokenApi";

const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("onchain-context — fetchTokenStats", () => {
  it("treats a token with millions of holders as canonical", async () => {
    const f = json({ data: [{ contract: "0xusdc", symbol: "USDC", decimals: 6, holders: 8787430, total_transfers: 360149422 }] });
    const out = await fetchTokenStats({ chainId: 1, address: "0xUSDC", jwt: "j", fetchImpl: f });
    expect(out).toMatchObject({ symbol: "USDC", canonical: true, holders: 8787430 });
    expect(out?.address).toBe("0xusdc");
  });

  it("treats a token with a handful of holders as non-canonical", async () => {
    const f = json({ data: [{ contract: "0xfake", symbol: "USDC", holders: 12 }] });
    const out = await fetchTokenStats({ chainId: 1, address: "0xfake", jwt: "j", fetchImpl: f });
    expect(out).toMatchObject({ canonical: false, holders: 12 });
  });

  it("returns canonical:false for a token the API has never indexed", async () => {
    const f = json({ data: [] });
    const out = await fetchTokenStats({ chainId: 1, address: "0xdead", jwt: "j", fetchImpl: f });
    expect(out).toEqual({ address: "0xdead", canonical: false });
  });

  it("returns undefined when the upstream is failing", async () => {
    const f = json({ error: { status: 500, code: "bad_gateway" } }, 500);
    await expect(
      fetchTokenStats({ chainId: 1, address: "0xusdc", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for an unsupported chain", async () => {
    const f = json({ data: [] });
    await expect(
      fetchTokenStats({ chainId: 999999, address: "0xusdc", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the network call throws", async () => {
    const f = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(
      fetchTokenStats({ chainId: 1, address: "0xusdc", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});

describe("onchain-context — fetchWalletBalances", () => {
  it("maps the API's value field to a token quantity, not dollars", async () => {
    const f = json({ data: [
      { contract: "0xUSDC", symbol: "USDC", decimals: 6, amount: "12400000000", value: 12400 },
    ] });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.balances[0]).toEqual({
      token: "0xusdc", symbol: "USDC", amount: "12400000000", quantity: 12400,
    });
  });

  it("tolerates rows with no quantity", async () => {
    const f = json({ data: [{ contract: "0xx", symbol: "X", amount: "1" }] });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.balances[0]?.quantity).toBeUndefined();
  });

  it("returns undefined when the upstream is failing", async () => {
    const f = json({ error: { status: 500 } }, 500);
    await expect(
      fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});
