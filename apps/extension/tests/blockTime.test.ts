import { describe, it, expect, vi, afterEach } from "vitest";
import { estimateAgeDays, getChainHead, __resetHeadCache } from "../src/lib/blockTime";

describe("estimateAgeDays", () => {
  it("returns 7 days when deployBlock is 50400 behind head on Ethereum mainnet", () => {
    const age = estimateAgeDays({ chainId: 1, headBlock: 19_000_000, deployBlock: 19_000_000 - 50400 });
    expect(age).toBeCloseTo(7, 0);
  });
  it("returns 0 when deployBlock equals head", () => {
    expect(estimateAgeDays({ chainId: 1, headBlock: 100, deployBlock: 100 })).toBe(0);
  });
  it("clamps negative ages to 0 (deployBlock ahead of head)", () => {
    expect(estimateAgeDays({ chainId: 1, headBlock: 100, deployBlock: 200 })).toBe(0);
  });
  it("returns undefined for unknown chain", () => {
    expect(estimateAgeDays({ chainId: 99999, headBlock: 100, deployBlock: 50 })).toBeUndefined();
  });
});

describe("getChainHead", () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetHeadCache(); });

  it("parses eth_blockNumber hex result to a number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: "0x123abc" }), { status: 200 })));
    const head = await getChainHead(1, "https://test/");
    expect(head).toBe(0x123abc);
  });
  it("caches the result for 60s within the same chain", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "0xabc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getChainHead(1, "https://test/");
    await getChainHead(1, "https://test/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("returns undefined when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await getChainHead(1, "https://test/")).toBeUndefined();
  });
  it("returns undefined for non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await getChainHead(1, "https://test/")).toBeUndefined();
  });
  it("returns undefined when result field is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await getChainHead(1, "https://test/")).toBeUndefined();
  });
});
