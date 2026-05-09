import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchVerifiedContractV2 } from "../src/v2";

const PROXY_ADDR = "0x1f98431c8ad98523631ae4a59f267346ea31f984";
const IMPL_ADDR  = "0x751d7c0cf91a9b7704541b44e5ff7bec3d2caa6f";

describe("fetchVerifiedContractV2 proxy recursion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recurses into implementation when proxy is verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url).toLowerCase();
      if (u.includes(`/v2/contract/1/${PROXY_ADDR}`)) {
        return new Response(JSON.stringify({
          match: "exact_match",
          abi: [{ type: "function", name: "implementation" }],
          compilation: { contractName: "ERC1967Proxy" },
          proxyResolution: { isProxy: true, proxyType: "EIP1967Proxy", implementations: [{ address: IMPL_ADDR, name: "Logic" }] },
        }), { status: 200 });
      }
      if (u.includes(`/v2/contract/1/${IMPL_ADDR}`)) {
        return new Response(JSON.stringify({
          match: "match",
          abi: [{ type: "function", name: "doStuff" }],
          compilation: { contractName: "MyLogicV2" },
          proxyResolution: { isProxy: false, proxyType: null, implementations: [] },
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const result = await fetchVerifiedContractV2({ chainId: 1, address: PROXY_ADDR });
    expect(result.proxy?.isProxy).toBe(true);
    expect(result.proxy?.proxyType).toBe("EIP1967Proxy");
    expect(result.proxy?.implementationAddress).toBe(IMPL_ADDR);
    expect(result.implementation).toBeDefined();
    expect(result.implementation?.verified).toBe(true);
    expect(result.implementation?.contractName).toBe("MyLogicV2");
  });

  it("caps recursion at one hop (impl that's also a proxy doesn't recurse again)", async () => {
    const SECOND_IMPL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let secondHopFetched = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url).toLowerCase();
      if (u.includes(`/v2/contract/1/${PROXY_ADDR}`)) {
        return new Response(JSON.stringify({
          match: "exact_match",
          abi: [],
          proxyResolution: { isProxy: true, proxyType: "EIP1967Proxy", implementations: [{ address: IMPL_ADDR }] },
        }), { status: 200 });
      }
      if (u.includes(`/v2/contract/1/${IMPL_ADDR}`)) {
        return new Response(JSON.stringify({
          match: "match",
          abi: [],
          // The impl ALSO claims to be a proxy — we must NOT follow this.
          proxyResolution: { isProxy: true, proxyType: "EIP1967Proxy", implementations: [{ address: SECOND_IMPL }] },
        }), { status: 200 });
      }
      if (u.includes(`/v2/contract/1/${SECOND_IMPL}`)) {
        secondHopFetched = true;
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const result = await fetchVerifiedContractV2({ chainId: 1, address: PROXY_ADDR });
    expect(result.implementation).toBeDefined();
    expect(result.implementation?.implementation).toBeUndefined();
    expect(secondHopFetched).toBe(false);
  });

  it("returns implementation as verified=false when impl is not on Sourcify", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url).toLowerCase();
      if (u.includes(`/v2/contract/1/${PROXY_ADDR}`)) {
        return new Response(JSON.stringify({
          match: "exact_match",
          abi: [],
          proxyResolution: { isProxy: true, proxyType: "EIP1967Proxy", implementations: [{ address: IMPL_ADDR }] },
        }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const result = await fetchVerifiedContractV2({ chainId: 1, address: PROXY_ADDR });
    expect(result.proxy?.isProxy).toBe(true);
    expect(result.implementation).toBeDefined();
    expect(result.implementation?.verified).toBe(false);
    expect(result.implementation?.abi).toEqual([]);
  });
});
