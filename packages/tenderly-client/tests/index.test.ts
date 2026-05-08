import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/usdc-transfer.json";
import { simulate } from "../src/index";

describe("tenderly-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes asset_changes into SimResult.assetChanges", async () => {
    const r = await simulate({
      accessKey: "fake", accountSlug: "a", projectSlug: "p",
      network_id: "8453",
      from: "0xaaa0000000000000000000000000000000000001",
      to:   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      input: "0x", value: "0x0",
    });
    expect(r.success).toBe(true);
    expect(r.assetChanges).toHaveLength(1);
    expect(r.assetChanges[0]!.token.symbol).toBe("USDC");
    expect(r.assetChanges[0]!.token.amount).toBe("100000000");
  });
});
