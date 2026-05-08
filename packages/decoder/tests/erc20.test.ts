import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import { decode } from "../src/index";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const ERC20_ABI = [
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

describe("erc20 recognizer", () => {
  it("decodes transfer(address,uint256)", async () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [RECIPIENT, 100_000000n] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    expect(result.kind).toBe("transfer");
    if (result.kind !== "transfer") throw new Error();
    expect(result.token.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.amount).toBe("100000000");
  });

  it("decodes approve and flags unlimited", async () => {
    const MAX = (1n << 256n) - 1n;
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [RECIPIENT, MAX] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    expect(result.kind).toBe("approve");
    if (result.kind !== "approve") throw new Error();
    expect(result.isUnlimited).toBe(true);
    expect(result.amount).toBe(MAX.toString());
  });

  it("decodes approve with bounded amount as not unlimited", async () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [RECIPIENT, 100n] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    if (result.kind !== "approve") throw new Error();
    expect(result.isUnlimited).toBe(false);
  });
});
