/**
 * Aave v3 Pool recognizer. Decodes the four core lending actions:
 * supply, withdraw, borrow, repay. Each is a single function on the Pool
 * contract. We resolve the protocol identity via @intent-check/protocol-registry,
 * so adding a new chain's Pool address is a one-file change.
 *
 * https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/pool/Pool.sol
 */

import { decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { lookupProtocol } from "@intent-check/protocol-registry";
import type { DecodedAction } from "@intent-check/types";

const POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)",
]);

const SELECTORS: Record<string, "supply" | "withdraw" | "borrow" | "repay"> = {
  // keccak256(...)[:4] for each signature.
  "0x617ba037": "supply",   // supply(address,uint256,address,uint16)
  "0x69328dec": "withdraw", // withdraw(address,uint256,address)
  "0xa415bcad": "borrow",   // borrow(address,uint256,uint256,uint16,address)
  "0x573ade81": "repay",    // repay(address,uint256,uint256,address)
};

function isAavePool(chainId: number, to: string): boolean {
  const info = lookupProtocol(chainId, to);
  return info?.protocol === "Aave" && info.kind === "lending";
}

export function tryDecodeAaveV3(input: { chainId: number; to: string; data: string }): DecodedAction | null {
  if (!input.data || input.data.length < 10) return null;
  const sel = input.data.slice(0, 10).toLowerCase();
  const verb = SELECTORS[sel];
  if (!verb) return null;
  // Aave's selectors are unique enough that we don't gate on the address —
  // but we still set `trusted` from the registry lookup to power the trust
  // ceiling. (False positives would require an unrelated contract using the
  // exact same 4-byte selectors with the same arg layout, which is unlikely
  // but possible; the trust ceiling won't trigger for those.)
  const trusted = isAavePool(input.chainId, input.to);

  try {
    const { args, functionName } = decodeFunctionData({ abi: POOL_ABI, data: input.data as Hex });
    const pool = getAddress(input.to);

    switch (functionName) {
      case "supply": {
        const [asset, amount, onBehalfOf] = args as [string, bigint, string, number];
        return {
          kind: "lendingAction",
          protocol: "Aave",
          verb: "supply",
          asset: getAddress(asset),
          amount: amount.toString(),
          onBehalfOf: getAddress(onBehalfOf),
          pool,
          trusted,
        };
      }
      case "withdraw": {
        const [asset, amount, to] = args as [string, bigint, string];
        return {
          kind: "lendingAction",
          protocol: "Aave",
          verb: "withdraw",
          asset: getAddress(asset),
          amount: amount.toString(),
          onBehalfOf: getAddress(to),
          pool,
          trusted,
        };
      }
      case "borrow": {
        const [asset, amount, , , onBehalfOf] = args as [string, bigint, bigint, number, string];
        return {
          kind: "lendingAction",
          protocol: "Aave",
          verb: "borrow",
          asset: getAddress(asset),
          amount: amount.toString(),
          onBehalfOf: getAddress(onBehalfOf),
          pool,
          trusted,
        };
      }
      case "repay": {
        const [asset, amount, , onBehalfOf] = args as [string, bigint, bigint, string];
        return {
          kind: "lendingAction",
          protocol: "Aave",
          verb: "repay",
          asset: getAddress(asset),
          amount: amount.toString(),
          onBehalfOf: getAddress(onBehalfOf),
          pool,
          trusted,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
