import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { lookupProtocol } from "@intent-check/protocol-registry";
import type { DecodedAction } from "@intent-check/types";

// Single source of truth for known Uniswap Universal Router deployments lives
// in `@intent-check/protocol-registry`. The recognizer queries it instead of
// holding its own table — adding a new chain or version means editing one file.
function isKnownRouter(chainId: number, to: string): boolean {
  const info = lookupProtocol(chainId, to);
  return info?.protocol === "Uniswap" && info.kind === "router";
}

// Universal Router ships two top-level entry points across deployments:
//   execute(bytes commands, bytes[] inputs, uint256 deadline)  → 0x3593564c
//   execute(bytes commands, bytes[] inputs)                    → 0x24856bc3
// Newer deployments tend to use the 2-arg form. We try both selectors and pick
// the matching ABI.
const UR_ABI_3ARG = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]);
const UR_ABI_2ARG = parseAbi(["function execute(bytes commands, bytes[] inputs)"]);

const UR_SELECTOR_3ARG = "0x3593564c";
const UR_SELECTOR_2ARG = "0x24856bc3";

const CMD_V3_SWAP_EXACT_IN = 0x00;
const CMD_V3_SWAP_EXACT_OUT = 0x01;
const CMD_V2_SWAP_EXACT_IN = 0x08;
const CMD_V2_SWAP_EXACT_OUT = 0x09;

// Universal Router command id → human-readable name. Subset focused on the most
// common Web3 user flows; unknown ids stringify as "0x??".
const COMMAND_NAMES: Record<number, string> = {
  0x00: "V3_SWAP_EXACT_IN",
  0x01: "V3_SWAP_EXACT_OUT",
  0x02: "PERMIT2_TRANSFER_FROM",
  0x03: "PERMIT2_PERMIT_BATCH",
  0x04: "SWEEP",
  0x05: "TRANSFER",
  0x06: "PAY_PORTION",
  0x08: "V2_SWAP_EXACT_IN",
  0x09: "V2_SWAP_EXACT_OUT",
  0x0a: "PERMIT2_PERMIT",
  0x0b: "WRAP_ETH",
  0x0c: "UNWRAP_WETH",
  0x0d: "PERMIT2_TRANSFER_FROM_BATCH",
  0x0e: "BALANCE_CHECK_ERC20",
  0x10: "V4_SWAP",
  0x11: "V3_POSITION_MANAGER_PERMIT",
  0x12: "V3_POSITION_MANAGER_CALL",
  0x13: "V4_INITIALIZE_POOL",
  0x14: "V4_POSITION_MANAGER_CALL",
  0x21: "EXECUTE_SUB_PLAN",
};

function commandName(cmd: number): string {
  return COMMAND_NAMES[cmd] ?? `0x${cmd.toString(16).padStart(2, "0")}`;
}

function isSwapCommand(c: number): boolean {
  return c === CMD_V3_SWAP_EXACT_IN || c === CMD_V3_SWAP_EXACT_OUT
      || c === CMD_V2_SWAP_EXACT_IN || c === CMD_V2_SWAP_EXACT_OUT;
}

// Universal Router uses two address sentinels in the recipient field of swap
// commands. Treat both as normal protocol semantics rather than third-party
// addresses — see Uniswap UR Constants.sol.
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002"; // route output stays on the router for next command
const MSG_SENDER = "0x0000000000000000000000000000000000000001";   // route output goes to the user's wallet

function classifyRecipient(addrLower: string, walletLower?: string): { resolved: string; kind: "wallet" | "router_self" | "third_party" } {
  if (addrLower === MSG_SENDER) {
    return { resolved: walletLower ? getAddress(walletLower) : MSG_SENDER, kind: "wallet" };
  }
  if (addrLower === ADDRESS_THIS) {
    return { resolved: ADDRESS_THIS, kind: "router_self" };
  }
  if (walletLower && addrLower === walletLower) {
    return { resolved: getAddress(walletLower), kind: "wallet" };
  }
  return { resolved: getAddress(addrLower), kind: "third_party" };
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

export function tryDecodeUniversalRouter(input: { chainId: number; to: string; data: string; from?: string }): DecodedAction | null {
  if (!input.data || input.data.length < 10) return null;
  const selector = input.data.slice(0, 10).toLowerCase();
  if (selector !== UR_SELECTOR_3ARG && selector !== UR_SELECTOR_2ARG) return null;

  // Selector match is enough to attempt decode; if args don't fit the UR shape
  // the try/catch below sends us back to the next recognizer / unknown fallback.
  const trusted = isKnownRouter(input.chainId, input.to);
  const walletLower = input.from?.toLowerCase();

  try {
    const abi = selector === UR_SELECTOR_3ARG ? UR_ABI_3ARG : UR_ABI_2ARG;
    const { args } = decodeFunctionData({ abi, data: input.data as Hex });
    // Both UR_ABI_3ARG and UR_ABI_2ARG produce a tuple whose first two elements
    // are `commands: bytes` and `inputs: bytes[]`. Discard the (optional) deadline.
    const [commandsHex, inputs] = args as unknown as readonly [Hex, readonly Hex[]];
    const commandIds = Array.from(commandsHex.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16) & 0x3f);
    const commands = commandIds.map(commandName);

    const swapIdx = commandIds.findIndex(isSwapCommand);
    if (swapIdx === -1) {
      // We recognize the entry point and the command sequence but no direct swap
      // command (e.g., V4 swap via EXECUTE_SUB_PLAN). Surface the structure so the
      // judge can reason about it; mark recipient as router_self since we don't
      // know the resolved recipient without decoding the sub-plan.
      return {
        kind: "swap",
        tokenIn:  { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
        tokenOut: { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
        minAmountOut: "0",
        recipient: getAddress(input.to),
        recipientKind: "router_self",
        router: getAddress(input.to),
        protocol: "Uniswap",
        trusted,
        commands,
      };
    }
    const cmd = commandIds[swapIdx]!;
    const swapInput = inputs[swapIdx]!;

    if (cmd === CMD_V3_SWAP_EXACT_IN) {
      const [recipient, amountIn, amountOutMin, path] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
        swapInput
      );
      const { first, last } = firstAndLastTokenInV3Path(path as Hex);
      const recipientLower = (recipient as string).toLowerCase();
      const r = classifyRecipient(recipientLower, walletLower);
      return {
        kind: "swap",
        tokenIn:  { chainId: input.chainId, address: first, amount: (amountIn as bigint).toString() },
        tokenOut: { chainId: input.chainId, address: last,  amount: "0" },
        minAmountOut: (amountOutMin as bigint).toString(),
        recipient: r.resolved,
        recipientKind: r.kind,
        router: getAddress(input.to),
        protocol: "Uniswap",
        trusted,
        commands,
      };
    }

    // Other swap commands: surface a low-confidence swap pointing at the router.
    return {
      kind: "swap",
      tokenIn:  { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
      tokenOut: { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
      minAmountOut: "0",
      recipient: getAddress(input.to),
      recipientKind: "router_self",
      router: getAddress(input.to),
      protocol: "Uniswap",
      trusted,
      commands,
    };
  } catch {
    return null;
  }
}
