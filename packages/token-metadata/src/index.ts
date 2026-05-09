/**
 * Token metadata: ERC-20 `symbol()` and `decimals()` resolution with caching.
 *
 * Why we need this:
 * - Tenderly's asset_changes sometimes ship `token_info` (symbol, decimals)
 *   but not always — for newly-deployed tokens or unusual chains the field
 *   is empty and we end up rendering "−700000000000000 0xab…cd".
 * - For native ETH the canonical sentinel is no token contract; we hardcode.
 *
 * The fetcher is async-RPC-based and cacheable. The extension wires it to
 * `chrome.storage.local` with a 7-day TTL so repeat lookups (USDC on every
 * Uniswap swap…) are free.
 *
 * No network logic in this file beyond `viem.publicClient.readContract` —
 * callers supply the RPC URL.
 */

import { createPublicClient, http, parseAbi } from "viem";

export interface TokenMeta {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** Native-currency placeholders. Both lowercase. */
const NATIVE_SENTINELS = new Set([
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // common in 1inch / various dexes
  "eth",
  "0x0000000000000000000000000000000000000000",
]);

const NATIVE_BY_CHAIN: Record<number, { symbol: string; decimals: number }> = {
  1:     { symbol: "ETH",   decimals: 18 },
  10:    { symbol: "ETH",   decimals: 18 }, // Optimism native is also ETH
  56:    { symbol: "BNB",   decimals: 18 },
  137:   { symbol: "MATIC", decimals: 18 },
  8453:  { symbol: "ETH",   decimals: 18 },
  42161: { symbol: "ETH",   decimals: 18 },
};

export function isNativeAddress(address: string): boolean {
  if (!address) return false;
  return NATIVE_SENTINELS.has(address.toLowerCase());
}

export function nativeMeta(chainId: number): TokenMeta {
  const def = NATIVE_BY_CHAIN[chainId] ?? { symbol: "ETH", decimals: 18 };
  return { chainId, address: "0x0000000000000000000000000000000000000000", symbol: def.symbol, decimals: def.decimals };
}

/**
 * Fetch ERC-20 metadata via two RPC reads. Returns null on failure (e.g.
 * a non-ERC-20 contract that doesn't have these methods). Callers should
 * cache positive results aggressively — token metadata never changes.
 */
export async function fetchTokenMeta(args: {
  chainId: number;
  address: string;
  rpcUrl: string;
  /** Optional fetch timeout (ms). Default 5000. */
  timeoutMs?: number;
}): Promise<TokenMeta | null> {
  if (isNativeAddress(args.address)) return nativeMeta(args.chainId);

  const client = createPublicClient({
    transport: http(args.rpcUrl, { timeout: args.timeoutMs ?? 5_000 }),
    chain: undefined,
  });
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: args.address as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" }),
      client.readContract({ address: args.address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
    ]);
    if (typeof symbol !== "string" || typeof decimals !== "number") return null;
    return { chainId: args.chainId, address: args.address, symbol, decimals };
  } catch {
    return null;
  }
}

/**
 * Format a raw integer amount (in token's smallest units) as a human string
 * with up to `displayDp` fractional digits of precision. Trims trailing zeros.
 *
 * Accepts negative-prefixed strings ("-700000000000000") and preserves the sign.
 */
export function formatTokenAmount(rawAmount: string, decimals: number, displayDp = 6): string {
  const isNeg = rawAmount.startsWith("-");
  const abs = isNeg ? rawAmount.slice(1) : rawAmount;
  if (decimals < 0 || decimals > 36) return rawAmount; // sanity — fall back to raw
  if (abs === "0") return "0";

  // Pad with leading zeros so we can split at decimals.
  const padded = abs.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fracPart = padded.slice(padded.length - decimals);
  const trimmed = fracPart.slice(0, displayDp).replace(/0+$/, "");
  const signPrefix = isNeg ? "−" : "";
  return signPrefix + (trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart);
}
