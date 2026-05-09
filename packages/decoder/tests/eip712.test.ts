import { describe, it, expect } from "vitest";
import { decodeTypedData } from "../src/eip712";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DRAINER = "0x000000000000000000000000000000000000dEaD";
const SENDER = "0xf8A8061e985fa35b8ED2f57ae1516816D5E712CE";

describe("eip712 — ERC-2612 Permit", () => {
  it("decodes a Permit envelope", () => {
    const env = {
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC_BASE },
      primaryType: "Permit",
      message: { owner: SENDER, spender: DRAINER, value: "1000000", nonce: "0", deadline: "1800000000" },
    };
    const r = decodeTypedData(env);
    expect(r?.kind).toBe("permit");
    if (r?.kind !== "permit") throw new Error();
    expect(r.token.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(r.owner.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(r.spender.toLowerCase()).toBe(DRAINER.toLowerCase());
    expect(r.amount).toBe("1000000");
  });

  it("accepts JSON-string envelope (wallet pass-through)", () => {
    const env = JSON.stringify({
      domain: { chainId: 1, verifyingContract: USDC_BASE },
      primaryType: "Permit",
      message: { owner: SENDER, spender: DRAINER, value: "1", nonce: "0", deadline: "0" },
    });
    const r = decodeTypedData(env);
    expect(r?.kind).toBe("permit");
  });
});

describe("eip712 — Permit2", () => {
  it("decodes PermitTransferFrom (single)", () => {
    const env = {
      domain: { chainId: 8453, verifyingContract: PERMIT2 },
      primaryType: "PermitTransferFrom",
      message: {
        permitted: { token: USDC_BASE, amount: "100000000" },
        spender: DRAINER,
        nonce: "0",
        deadline: "1800000000",
      },
    };
    const r = decodeTypedData(env);
    if (r?.kind !== "permit2Transfer") throw new Error();
    expect(r.permitted).toHaveLength(1);
    expect(r.permitted[0].address.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(r.permitted[0].amount).toBe("100000000");
    expect(r.spender.toLowerCase()).toBe(DRAINER.toLowerCase());
  });

  it("decodes PermitBatchTransferFrom (drainer payload)", () => {
    const env = {
      domain: { chainId: 8453, verifyingContract: PERMIT2 },
      primaryType: "PermitBatchTransferFrom",
      message: {
        permitted: [
          { token: USDC_BASE, amount: "999999999" },
          { token: USDT, amount: "999999999" },
        ],
        spender: DRAINER,
        nonce: "0",
        deadline: "1800000000",
      },
    };
    const r = decodeTypedData(env);
    if (r?.kind !== "permit2Transfer") throw new Error();
    expect(r.permitted).toHaveLength(2);
    expect(r.spender.toLowerCase()).toBe(DRAINER.toLowerCase());
  });

  it("decodes PermitSingle (allowance-style)", () => {
    const env = {
      domain: { chainId: 8453, verifyingContract: PERMIT2 },
      primaryType: "PermitSingle",
      message: {
        details: { token: USDC_BASE, amount: "1461501637330902918203684832716283019655932542975", expiration: "1800000000", nonce: 0 },
        spender: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
        sigDeadline: "1800000000",
      },
    };
    const r = decodeTypedData(env);
    if (r?.kind !== "permit2Transfer") throw new Error();
    expect(r.permitted[0].address.toLowerCase()).toBe(USDC_BASE.toLowerCase());
  });
});

describe("eip712 — Seaport", () => {
  it("decodes OrderComponents with offer + consideration", () => {
    const env = {
      domain: { name: "Seaport", chainId: 1, verifyingContract: SEAPORT },
      primaryType: "OrderComponents",
      message: {
        offerer: SENDER,
        offer: [{ itemType: 2, token: "0x1111111111111111111111111111111111111111", identifierOrCriteria: "1", startAmount: "1", endAmount: "1" }],
        consideration: [{ itemType: 0, token: "0x0000000000000000000000000000000000000000", identifierOrCriteria: "0", startAmount: "1000000000000000000", endAmount: "1000000000000000000", recipient: SENDER }],
        zone: "0x0000000000000000000000000000000000000000",
      },
    };
    const r = decodeTypedData(env);
    if (r?.kind !== "seaportOrder") throw new Error();
    expect(r.offerer.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(r.offer).toHaveLength(1);
    expect(r.consideration).toHaveLength(1);
  });
});

describe("eip712 — passthrough", () => {
  it("returns null for unrecognized primaryType", () => {
    const env = { domain: { chainId: 1, verifyingContract: PERMIT2 }, primaryType: "UnknownThing", message: {} };
    expect(decodeTypedData(env)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(decodeTypedData("not a json")).toBeNull();
  });

  it("returns null for missing message", () => {
    expect(decodeTypedData({ domain: {}, primaryType: "Permit" })).toBeNull();
  });
});
