import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import type { DecodedAction } from "@intent-check/types";

const ROUTERS: Record<number, string> = {
  1: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",         // ethereum mainnet UR v2
  8453: "0x6fF5693b99212Da76ad316178A184AB56D299b43",      // base
};

const UR_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);

const CMD_V3_SWAP_EXACT_IN = 0x00;
const CMD_V3_SWAP_EXACT_OUT = 0x01;
const CMD_V2_SWAP_EXACT_IN = 0x08;
const CMD_V2_SWAP_EXACT_OUT = 0x09;

function isSwapCommand(c: number): boolean {
  return c === CMD_V3_SWAP_EXACT_IN || c === CMD_V3_SWAP_EXACT_OUT
      || c === CMD_V2_SWAP_EXACT_IN || c === CMD_V2_SWAP_EXACT_OUT;
}

function firstAndLastTokenInV3Path(path: Hex): { first: string; last: string } {
  // Path layout: address (20) + fee (3) + address (20) + ...
  const bytes = path.slice(2);
  // One full hop is 20 + 3 + 20 = 43 bytes = 86 hex chars. Anything shorter is malformed.
  if (bytes.length < 86) {
    throw new Error("V3 path too short");
  }
  const first = "0x" + bytes.slice(0, 40);
  const last = "0x" + bytes.slice(bytes.length - 40);
  return { first: getAddress(first), last: getAddress(last) };
}

export function tryDecodeUniversalRouter(input: { chainId: number; to: string; data: string }): DecodedAction | null {
  const expected = ROUTERS[input.chainId];
  if (!expected || expected.toLowerCase() !== input.to.toLowerCase()) return null;
  if (!input.data || input.data.length < 10) return null;
  if (input.data.slice(0, 10).toLowerCase() !== "0x3593564c") return null; // execute selector

  try {
    const { args } = decodeFunctionData({ abi: UR_ABI, data: input.data as Hex });
    const [commandsHex, inputs] = args as [Hex, Hex[], bigint];
    const commands = Array.from(commandsHex.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16) & 0x3f);

    const swapIdx = commands.findIndex(isSwapCommand);
    if (swapIdx === -1) return null;
    const cmd = commands[swapIdx]!;
    const swapInput = inputs[swapIdx]!;

    if (cmd === CMD_V3_SWAP_EXACT_IN) {
      const [recipient, amountIn, amountOutMin, path] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
        swapInput
      );
      const { first, last } = firstAndLastTokenInV3Path(path as Hex);
      return {
        kind: "swap",
        tokenIn:  { chainId: input.chainId, address: first, amount: (amountIn as bigint).toString() },
        tokenOut: { chainId: input.chainId, address: last,  amount: "0" },
        minAmountOut: (amountOutMin as bigint).toString(),
        recipient: getAddress(recipient as string),
        router: getAddress(input.to),
        protocol: "Uniswap",
      };
    }

    // Other swap commands: surface a low-confidence swap pointing at the router.
    return {
      kind: "swap",
      tokenIn:  { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
      tokenOut: { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
      minAmountOut: "0",
      recipient: getAddress(input.to),
      router: getAddress(input.to),
      protocol: "Uniswap",
    };
  } catch {
    return null;
  }
}
