import { describe, it, expect } from "vitest";
import { encodeFunctionData, encodeAbiParameters, encodePacked } from "viem";
import { decode } from "../src/index";

const ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const UR_ABI = [
  { type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function buildV3SwapExactInInput(recipient: string, amountIn: bigint, amountOutMin: bigint, path: `0x${string}`, payerIsUser: boolean): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
    ],
    [recipient as `0x${string}`, amountIn, amountOutMin, path, payerIsUser]
  );
}

describe("uniswap universal router", () => {
  it("decodes V3_SWAP_EXACT_IN as a swap", async () => {
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(RECIPIENT, 100_000000n, 28_000_000_000_000_000n, path, true);
    const data = encodeFunctionData({
      abi: UR_ABI, functionName: "execute",
      args: ["0x00", [input], BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0" });
    expect(result.kind).toBe("swap");
    if (result.kind !== "swap") throw new Error();
    expect(result.protocol).toBe("Uniswap");
    expect(result.tokenIn.address.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.tokenOut.address.toLowerCase()).toBe(WETH.toLowerCase());
    expect(result.tokenIn.amount).toBe("100000000");
    expect(result.minAmountOut).toBe("28000000000000000");
    expect(result.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.router.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(result.trusted).toBe(true); // ROUTER is in KNOWN_ROUTERS for chain 8453
  });

  it("decodes V3 swap on an unknown router with trusted=false", async () => {
    const UNKNOWN_ROUTER = "0x1234567890123456789012345678901234567890";
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(RECIPIENT, 100_000000n, 28_000_000_000_000_000n, path, true);
    const data = encodeFunctionData({
      abi: UR_ABI, functionName: "execute",
      args: ["0x00", [input], BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
    const result = await decode({ chainId: 8453, to: UNKNOWN_ROUTER, data, value: "0x0" });
    if (result.kind !== "swap") throw new Error();
    expect(result.trusted).toBe(false);
  });

  it("returns unknown for execute() with malformed inputs", async () => {
    // execute selector + truncated/garbage args
    const data = "0x3593564c" + "deadbeef".repeat(8);
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0" });
    expect(result.kind).toBe("unknown");
  });

  it("returns unknown for V3 swap with truncated path", async () => {
    // Build a real execute() but with a 19-byte (too short) path
    const path = ("0x" + "00".repeat(19)) as `0x${string}`;
    const input = buildV3SwapExactInInput(RECIPIENT, 100n, 0n, path, true);
    const data = encodeFunctionData({
      abi: UR_ABI, functionName: "execute",
      args: ["0x00", [input], 0n],
    });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0" });
    expect(result.kind).toBe("unknown");
  });

  // ---- M2.6 sentinel + commands list ----

  const SENDER = "0xf8A8061e985fa35b8ED2f57ae1516816D5E712CE";
  const MSG_SENDER = "0x0000000000000000000000000000000000000001";
  const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

  it("resolves recipient sentinel 0x...0001 to the user's wallet (recipientKind=wallet)", async () => {
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(MSG_SENDER, 100n, 0n, path, true);
    const data = encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x00", [input], 0n] });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0", from: SENDER });
    if (result.kind !== "swap") throw new Error();
    expect(result.recipientKind).toBe("wallet");
    expect(result.recipient.toLowerCase()).toBe(SENDER.toLowerCase());
  });

  it("recognizes recipient sentinel 0x...0002 as router_self forwarding", async () => {
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(ADDRESS_THIS, 100n, 0n, path, true);
    const data = encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x0001", [input, "0x"], 0n] });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0", from: SENDER });
    if (result.kind !== "swap") throw new Error();
    expect(result.recipientKind).toBe("router_self");
    expect(result.recipient.toLowerCase()).toBe(ADDRESS_THIS.toLowerCase());
  });

  it("flags non-sentinel non-sender recipient as third_party", async () => {
    const THIRD = "0x000000000000000000000000000000000000dEaD";
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(THIRD, 100n, 0n, path, true);
    const data = encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x00", [input], 0n] });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0", from: SENDER });
    if (result.kind !== "swap") throw new Error();
    expect(result.recipientKind).toBe("third_party");
  });

  it("returns the full command sequence for chained UR calls (e.g., V3_SWAP + UNWRAP_WETH)", async () => {
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const swapInput = buildV3SwapExactInInput(ADDRESS_THIS, 100n, 0n, path, true);
    // commands = 0x000c → V3_SWAP_EXACT_IN, UNWRAP_WETH
    const data = encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x000c", [swapInput, "0x"], 0n] });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0", from: SENDER });
    if (result.kind !== "swap") throw new Error();
    expect(result.commands).toEqual(["V3_SWAP_EXACT_IN", "UNWRAP_WETH"]);
  });
});
