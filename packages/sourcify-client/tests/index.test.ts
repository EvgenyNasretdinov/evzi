import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/usdc-base.json";
import { fetchVerifiedContract } from "../src/index";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("sourcify-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes(USDC.toLowerCase())) {
        return new Response(JSON.stringify(fixture), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns ABI and contract name for a verified contract", async () => {
    const r = await fetchVerifiedContract({ chainId: 8453, address: USDC });
    expect(r.verified).toBe(true);
    expect(r.contractName).toBe("USDC");
    expect(Array.isArray(r.abi)).toBe(true);
    expect(r.abi[0].name).toBe("transfer");
  });

  it("returns verified=false for unknown contract", async () => {
    const r = await fetchVerifiedContract({ chainId: 8453, address: "0x000000000000000000000000000000000000dEaD" });
    expect(r.verified).toBe(false);
    expect(r.abi).toEqual([]);
  });
});
