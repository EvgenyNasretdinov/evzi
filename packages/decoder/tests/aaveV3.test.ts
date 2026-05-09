import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import { decode } from "../src/index";

const POOL_MAINNET = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const POOL_RANDOM = "0x1234567890123456789012345678901234567890";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const SENDER = "0xf8A8061e985fa35b8ED2f57ae1516816D5E712CE";

const POOL_ABI = [
  { type: "function", name: "supply",   stateMutability: "nonpayable", inputs: [
    { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "onBehalfOf", type: "address" }, { name: "referralCode", type: "uint16" },
  ], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [
    { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" },
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "borrow",   stateMutability: "nonpayable", inputs: [
    { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "interestRateMode", type: "uint256" }, { name: "referralCode", type: "uint16" }, { name: "onBehalfOf", type: "address" },
  ], outputs: [] },
  { type: "function", name: "repay",    stateMutability: "nonpayable", inputs: [
    { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "interestRateMode", type: "uint256" }, { name: "onBehalfOf", type: "address" },
  ], outputs: [{ type: "uint256" }] },
] as const;

describe("aaveV3 recognizer", () => {
  it("decodes supply", async () => {
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "supply", args: [USDC, 100_000000n, SENDER, 0] });
    const result = await decode({ chainId: 1, to: POOL_MAINNET, data, value: "0x0", from: SENDER });
    if (result.kind !== "lendingAction") throw new Error();
    expect(result.protocol).toBe("Aave");
    expect(result.verb).toBe("supply");
    expect(result.asset.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.amount).toBe("100000000");
    expect(result.onBehalfOf?.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(result.trusted).toBe(true);
  });

  it("decodes withdraw", async () => {
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [USDC, 50_000000n, SENDER] });
    const result = await decode({ chainId: 1, to: POOL_MAINNET, data, value: "0x0", from: SENDER });
    if (result.kind !== "lendingAction") throw new Error();
    expect(result.verb).toBe("withdraw");
    expect(result.amount).toBe("50000000");
  });

  it("decodes borrow", async () => {
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "borrow", args: [USDC, 25_000000n, 2n, 0, SENDER] });
    const result = await decode({ chainId: 1, to: POOL_MAINNET, data, value: "0x0", from: SENDER });
    if (result.kind !== "lendingAction") throw new Error();
    expect(result.verb).toBe("borrow");
    expect(result.onBehalfOf?.toLowerCase()).toBe(SENDER.toLowerCase());
  });

  it("decodes repay", async () => {
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "repay", args: [USDC, 25_000000n, 2n, SENDER] });
    const result = await decode({ chainId: 1, to: POOL_MAINNET, data, value: "0x0", from: SENDER });
    if (result.kind !== "lendingAction") throw new Error();
    expect(result.verb).toBe("repay");
  });

  it("flags trusted=false for Aave-shaped calldata to a random address", async () => {
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "supply", args: [USDC, 1n, SENDER, 0] });
    const result = await decode({ chainId: 1, to: POOL_RANDOM, data, value: "0x0", from: SENDER });
    if (result.kind !== "lendingAction") throw new Error();
    expect(result.trusted).toBe(false);
  });
});
