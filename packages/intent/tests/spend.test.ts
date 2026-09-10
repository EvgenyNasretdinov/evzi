import { describe, it, expect } from "vitest";
import { extractSpend, MAX_UINT256 } from "../src/spend";
import type { DecodedAction } from "@intent-check/types";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("intent — extractSpend", () => {
  it("reads an unlimited approval", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC,
      spender: "0xdead",
      amount: MAX_UINT256,
      isUnlimited: true,
    };
    const { movements, unrecognized } = extractSpend(decoded, 8453);
    expect(unrecognized).toBe(false);
    expect(movements).toEqual([
      {
        token: USDC,
        amount: MAX_UINT256,
        recipient: "0xdead",
        isUnlimited: true,
        kind: "approve",
      },
    ]);
  });

  it("lowercases addresses so comparisons cannot miss on casing", () => {
    const decoded: DecodedAction = {
      kind: "approve",
      token: USDC.toUpperCase(),
      spender: "0xDeAd",
      amount: "500",
      isUnlimited: false,
    };
    expect(extractSpend(decoded, 8453).movements[0]).toMatchObject({
      token: USDC,
      recipient: "0xdead",
    });
  });

  it("reads a plain transfer", () => {
    const decoded: DecodedAction = {
      kind: "transfer",
      token: USDC,
      to: "0xbob",
      amount: "1000000",
    };
    expect(extractSpend(decoded, 8453).movements).toEqual([
      { token: USDC, amount: "1000000", recipient: "0xbob", isUnlimited: false, kind: "transfer" },
    ]);
  });

  it("reads the inbound leg of a swap and its recipient", () => {
    const decoded: DecodedAction = {
      kind: "swap",
      tokenIn: { chainId: 8453, address: USDC, amount: "500000000" },
      tokenOut: { chainId: 8453, address: "ETH", amount: "0" },
      minAmountOut: "0",
      recipient: "0xme",
      router: "0xr",
      protocol: "Uniswap",
    };
    expect(extractSpend(decoded, 8453).movements).toEqual([
      { token: USDC, amount: "500000000", recipient: "0xme", isUnlimited: false, kind: "swapIn" },
    ]);
  });

  it("treats every permitted token in a Permit2 batch as a movement", () => {
    const decoded: DecodedAction = {
      kind: "permit2Transfer",
      permitted: [
        { chainId: 8453, address: USDC, amount: "1" },
        { chainId: 8453, address: "0xweth", amount: "2" },
      ],
      spender: "0xdrainer",
      deadline: "0",
    };
    const { movements } = extractSpend(decoded, 8453);
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.recipient === "0xdrainer")).toBe(true);
  });

  it("treats setApprovalForAll(true) as unlimited", () => {
    const decoded: DecodedAction = {
      kind: "setApprovalForAll",
      collection: "0xnft",
      operator: "0xop",
      approved: true,
    };
    expect(extractSpend(decoded, 8453).movements[0]).toMatchObject({
      isUnlimited: true,
      kind: "approve",
      recipient: "0xop",
    });
  });

  it("ignores setApprovalForAll(false), which grants nothing", () => {
    const decoded: DecodedAction = {
      kind: "setApprovalForAll",
      collection: "0xnft",
      operator: "0xop",
      approved: false,
    };
    expect(extractSpend(decoded, 8453).movements).toEqual([]);
  });

  it("marks unknown calldata as unrecognized rather than guessing it is safe", () => {
    const decoded: DecodedAction = { kind: "unknown", selector: "0x12345678" };
    expect(extractSpend(decoded, 8453)).toEqual({ movements: [], unrecognized: true });
  });

  it("marks a generic decoded call as unrecognized for spend purposes", () => {
    const decoded: DecodedAction = {
      kind: "generic",
      functionName: "doThing",
      signature: "doThing()",
      target: "0xt",
      args: [],
      trusted: false,
    };
    expect(extractSpend(decoded, 8453).unrecognized).toBe(true);
  });
});
