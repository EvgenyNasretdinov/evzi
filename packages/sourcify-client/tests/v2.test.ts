import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchVerifiedContractV2 } from "../src/v2";

const ADDRESS_MIXED = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const ADDRESS_LOWER = ADDRESS_MIXED.toLowerCase();

const happyBody = {
  match: "exact_match",
  chainId: "1",
  address: ADDRESS_LOWER,
  abi: [{ type: "function", name: "execute", inputs: [{ type: "bytes" }], outputs: [] }],
  compilation: { language: "Solidity", contractName: "UniversalRouter" },
  deployment: {
    blockNumber: "18000000",
    deployer: "0xABC0000000000000000000000000000000000000",
    transactionHash: "0xtx",
  },
  proxyResolution: {
    isProxy: false,
    proxyType: null,
    implementations: [],
  },
  signatures: {
    function: [
      { signature: "execute(bytes)", signatureHash4: "0x09c5eabe", signatureHash32: "0x09c5eabe00000000000000000000000000000000000000000000000000000000" },
    ],
    event: [],
    error: [],
  },
  userdoc: {
    notice: "Uniswap router",
    methods: { "execute(bytes)": { notice: "Executes a sequence of commands" } },
  },
};

describe("sourcify-client v2", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path — verified contract with all fields populated", async () => {
    fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(happyBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchVerifiedContractV2({ chainId: 1, address: ADDRESS_LOWER });
    expect(r.verified).toBe(true);
    expect(r.matchType).toBe("exact_match");
    expect(r.contractName).toBe("UniversalRouter");
    expect(r.abi.length).toBe(1);
    expect(r.proxy?.isProxy).toBe(false);
    expect(r.deployment?.blockNumber).toBe(18000000);
    expect(typeof r.deployment?.blockNumber).toBe("number");
    expect(r.deployment?.deployer).toBe("0xabc0000000000000000000000000000000000000");
    expect(r.signatures?.function[0]?.signature).toBe("execute(bytes)");
    expect(r.signatures?.function[0]?.selector4).toBe("0x09c5eabe");
    expect(r.userdoc?.methods?.["execute(bytes)"]?.notice).toMatch(/Executes a sequence/);
  });

  it("404 — verified=false, abi=[]", async () => {
    fetchMock = vi.fn(async (_url: string) => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchVerifiedContractV2({ chainId: 1, address: ADDRESS_LOWER });
    expect(r.verified).toBe(false);
    expect(r.abi).toEqual([]);
  });

  it("non-2xx (500) — verified=false, abi=[]; does not throw", async () => {
    fetchMock = vi.fn(async (_url: string) => new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchVerifiedContractV2({ chainId: 1, address: ADDRESS_LOWER });
    expect(r.verified).toBe(false);
    expect(r.abi).toEqual([]);
  });

  it("no proxyResolution in response — proxy is undefined", async () => {
    const body = { ...happyBody };
    delete (body as any).proxyResolution;
    fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchVerifiedContractV2({ chainId: 1, address: ADDRESS_LOWER });
    expect(r.proxy).toBeUndefined();
  });

  it("address case — URL fetched is lowercased", async () => {
    let capturedUrl = "";
    fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify(happyBody), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchVerifiedContractV2({ chainId: 1, address: ADDRESS_MIXED });
    expect(capturedUrl).toContain(ADDRESS_LOWER);
    expect(capturedUrl).not.toContain(ADDRESS_MIXED);
  });

  it("returns verified=false when fetch rejects (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const result = await fetchVerifiedContractV2({ chainId: 1, address: "0x0000000000000000000000000000000000000001" });
    expect(result.verified).toBe(false);
    expect(result.abi).toEqual([]);
  });

  it("returns verified=false when 200 body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    const result = await fetchVerifiedContractV2({ chainId: 1, address: "0x0000000000000000000000000000000000000001" });
    expect(result.verified).toBe(false);
    expect(result.abi).toEqual([]);
  });

  it("handles partial signatures field with no function key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      match: "exact_match",
      abi: [],
      signatures: { event: [{ signature: "Transfer(address,address,uint256)", signatureHash4: "0xddf252ad" }] },
    }), { status: 200 })));
    const result = await fetchVerifiedContractV2({ chainId: 1, address: "0x1" });
    expect(result.verified).toBe(true);
    expect(result.signatures?.function).toEqual([]);
    expect(result.signatures?.event).toHaveLength(1);
  });

  it("matchType === 'match' for partial-match response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ match: "match", abi: [] }), { status: 200 })));
    const result = await fetchVerifiedContractV2({ chainId: 1, address: "0x1" });
    expect(result.matchType).toBe("match");
  });
});
