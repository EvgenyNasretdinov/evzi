import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { DecodedAction } from "@intent-check/types";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

const ERC20_SELECTORS = new Set(["0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0xa22cb465"]);

export function tryDecodeErc20(input: { to: string; data: string }): DecodedAction | null {
  const sel = (input.data ?? "").slice(0, 10).toLowerCase();
  if (!ERC20_SELECTORS.has(sel)) return null;

  const decoded = decodeFunctionData({ abi: ERC20_ABI, data: input.data as `0x${string}` });
  const token = getAddress(input.to);

  switch (decoded.functionName) {
    case "transfer":
      return { kind: "transfer", token, to: getAddress(decoded.args[0]), amount: decoded.args[1].toString() };
    case "transferFrom":
      return { kind: "transfer", token, to: getAddress(decoded.args[1]), amount: decoded.args[2].toString() };
    case "approve": {
      const amount = decoded.args[1];
      const MAX = (1n << 256n) - 1n;
      // Treat anything >= 2^255 as effectively unlimited.
      const isUnlimited = amount >= (1n << 255n) || amount === MAX;
      return { kind: "approve", token, spender: getAddress(decoded.args[0]), amount: amount.toString(), isUnlimited };
    }
    case "setApprovalForAll":
      return { kind: "setApprovalForAll", collection: token, operator: getAddress(decoded.args[0]), approved: decoded.args[1] };
  }
  return null;
}
