import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import type { DecodedAction } from "@intent-check/types";

// Known Uniswap Universal Router deployments. Used as a positive identification
// signal; we also accept any contract whose calldata starts with the execute()
// selector and decodes into the expected shape, since UR is deployed across many
// chains and Uniswap rolls new versions periodically.
const KNOWN_ROUTERS: Record<number, string[]> = {
  1: [
    "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",  // UR v2
    "0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B",  // UR v1
  ],
  10:    [
    "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8",
    "0x8B844f885672f333Bc0042cB669255f93a4C1E6b",  // newer optimism UR
  ],
  137:   ["0x643770E279d5D0733F21d6DC03A8efbABf3255B4"],  // polygon
  8453:  ["0x6fF5693b99212Da76ad316178A184AB56D299b43"],  // base
  42161: ["0x5E325eDA8064b456f4781070C0738d849c824258"],  // arbitrum
  56:    ["0x4Dae2f939ACf50408e13d58534Ff8c2776d45265"],  // bnb
};

function isKnownRouter(chainId: number, to: string): boolean {
  const list = KNOWN_ROUTERS[chainId] ?? [];
  return list.some((a) => a.toLowerCase() === to.toLowerCase());
}

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
  if (!input.data || input.data.length < 10) return null;
  if (input.data.slice(0, 10).toLowerCase() !== "0x3593564c") return null; // execute selector

  // Selector match is enough to attempt decode; if args don't fit the UR shape
  // the try/catch below sends us back to the next recognizer / unknown fallback.
  const known = isKnownRouter(input.chainId, input.to);
  void known; // currently unused; downstream may want to surface a "trusted router" signal.

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
