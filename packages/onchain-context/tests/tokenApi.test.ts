import { describe, it, expect } from "vitest";
import { fetchSpenderProfile, fetchWalletBalances } from "../src/tokenApi";

const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("onchain-context — fetchSpenderProfile", () => {
  it("counts distinct senders and measures outbound concentration", async () => {
    const f = json({
      data: [
        { from: "0xa", to: "0xspender", value: "1" },
        { from: "0xb", to: "0xspender", value: "1" },
        { from: "0xa", to: "0xspender", value: "1" },
        { from: "0xspender", to: "0xsink", value: "3" },
      ],
    });
    const out = await fetchSpenderProfile({
      chainId: 1,
      address: "0xSpender",
      jwt: "j",
      fetchImpl: f,
    });
    expect(out?.distinctInboundSenders48h).toBe(2);
    expect(out?.outboundConcentration).toBe(1);
  });

  it("splits concentration across several destinations", async () => {
    const f = json({
      data: [
        { from: "0xspender", to: "0xone", value: "50" },
        { from: "0xspender", to: "0xtwo", value: "50" },
      ],
    });
    const out = await fetchSpenderProfile({
      chainId: 1,
      address: "0xspender",
      jwt: "j",
      fetchImpl: f,
    });
    expect(out?.outboundConcentration).toBe(0.5);
  });

  it("reports zero concentration when nothing left the address", async () => {
    const f = json({ data: [{ from: "0xa", to: "0xspender", value: "1" }] });
    const out = await fetchSpenderProfile({
      chainId: 1,
      address: "0xspender",
      jwt: "j",
      fetchImpl: f,
    });
    expect(out?.outboundConcentration).toBe(0);
  });

  it("does not count the address itself as one of its own senders", async () => {
    const f = json({
      data: [
        { from: "0xspender", to: "0xspender", value: "1" },
        { from: "0xa", to: "0xspender", value: "1" },
      ],
    });
    const out = await fetchSpenderProfile({
      chainId: 1,
      address: "0xspender",
      jwt: "j",
      fetchImpl: f,
    });
    expect(out?.distinctInboundSenders48h).toBe(1);
  });

  it("survives malformed value fields rather than throwing", async () => {
    const f = json({
      data: [
        { from: "0xspender", to: "0xsink", value: "not-a-number" },
        { from: "0xspender", to: "0xsink", value: "10" },
      ],
    });
    const out = await fetchSpenderProfile({
      chainId: 1,
      address: "0xspender",
      jwt: "j",
      fetchImpl: f,
    });
    expect(out?.outboundConcentration).toBe(1);
  });

  it("returns undefined when the upstream is failing", async () => {
    const f = json({ error: { status: 500, code: "bad_gateway" } }, 500);
    await expect(
      fetchSpenderProfile({ chainId: 1, address: "0xspender", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for an unsupported chain", async () => {
    const f = json({ data: [] });
    await expect(
      fetchSpenderProfile({ chainId: 999999, address: "0xspender", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});

describe("onchain-context — fetchWalletBalances", () => {
  it("sums USD across balances", async () => {
    const f = json({
      data: [
        { contract: "0xusdc", symbol: "USDC", amount: "12400000000", value_usd: 12400 },
        { contract: "0xweth", symbol: "WETH", amount: "1000000000000000000", value_usd: 3100 },
      ],
    });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.totalUsd).toBe(15500);
    expect(out?.balances).toHaveLength(2);
  });

  it("tolerates rows with no USD price", async () => {
    const f = json({ data: [{ contract: "0xx", symbol: "X", amount: "1" }] });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.totalUsd).toBe(0);
    expect(out?.balances[0]?.usd).toBeUndefined();
  });

  it("returns undefined when the upstream is failing", async () => {
    const f = json({ error: { status: 500, code: "bad_gateway" } }, 500);
    await expect(
      fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});
