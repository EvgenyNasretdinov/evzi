/**
 * Hand-curated registry of well-known Web3 contract addresses.
 *
 * Used as a deterministic trust signal: if a contract appears here, we know
 * what it is and don't need Sourcify verification or a successful calldata
 * decode to label it as trusted. This is the gap that pure Sourcify lookups
 * leave (e.g., Uniswap routers are often partial-match or unverified, and
 * Sourcify coverage on chains like Optimism is uneven).
 *
 * Adding entries: prefer the canonical deployment from the protocol's official
 * docs / GitHub deployments file. Group new chains under their numeric chainId.
 */

export type ProtocolKind =
  | "router"        // Uniswap UR, 1inch aggregator, etc.
  | "permit2"       // Uniswap Permit2 universal address
  | "marketplace"   // Seaport, Blur
  | "lending"       // Aave, Compound pool addresses
  | "weth"          // canonical wrapped-native token
  | "stablecoin"    // USDC, USDT
  | "bridge"        // Across, Hop
  | "ens"           // ENS registrar / resolver
  | "other";

export interface ProtocolInfo {
  protocol: string;        // human-readable family ("Uniswap", "Seaport", "Permit2")
  name: string;            // specific deployment ("UniversalRouter", "Permit2", "WETH")
  kind: ProtocolKind;
}

/**
 * Cross-chain "universal" addresses that resolve to the same deployment on every
 * chain (CREATE2 / canonical salts). Looked up before chain-specific tables.
 */
const UNIVERSAL: Record<string, ProtocolInfo> = {
  "0x000000000022d473030f116ddee9f6b43ac78ba3": { protocol: "Permit2", name: "Permit2", kind: "permit2" },
  "0x0000000000000068f116a894984e2db1123eb395": { protocol: "Seaport", name: "Seaport 1.6", kind: "marketplace" },
  "0x00000000000000adc04c56bf30ac9d3c0aaf14dc": { protocol: "Seaport", name: "Seaport 1.5", kind: "marketplace" },
};

/**
 * Per-chain registry. Address keys are stored lowercase.
 */
const BY_CHAIN: Record<number, Record<string, ProtocolInfo>> = {
  // Ethereum mainnet.
  1: {
    "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
    "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b": { protocol: "Uniswap", name: "UniversalRouter v1", kind: "router" },
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { protocol: "WETH", name: "WETH9", kind: "weth" },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { protocol: "Circle", name: "USDC", kind: "stablecoin" },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { protocol: "Tether", name: "USDT", kind: "stablecoin" },
  },
  // Optimism.
  10: {
    "0xcb1355ff08ab38bbce60111f1bb2b784be25d7e8": { protocol: "Uniswap", name: "UniversalRouter (legacy)", kind: "router" },
    "0x8b844f885672f333bc0042cb669255f93a4c1e6b": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
    "0x4200000000000000000000000000000000000006": { protocol: "WETH", name: "WETH (Optimism)", kind: "weth" },
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { protocol: "Circle", name: "USDC (Optimism)", kind: "stablecoin" },
    "0x4200000000000000000000000000000000000042": { protocol: "Optimism", name: "OP token", kind: "other" },
  },
  // Polygon.
  137: {
    "0x643770e279d5d0733f21d6dc03a8efbabf3255b4": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
  },
  // Base.
  8453: {
    "0x6ff5693b99212da76ad316178a184ab56d299b43": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { protocol: "Circle", name: "USDC (Base)", kind: "stablecoin" },
    "0x4200000000000000000000000000000000000006": { protocol: "WETH", name: "WETH (Base)", kind: "weth" },
  },
  // Arbitrum.
  42161: {
    "0x5e325eda8064b456f4781070c0738d849c824258": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
  },
  // BNB.
  56: {
    "0x4dae2f939acf50408e13d58534ff8c2776d45265": { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
  },
};

/**
 * Returns metadata for a known contract, or null if the address is unrecognized
 * on this chain. Lookup is O(1). Universal addresses (Permit2, Seaport canonical
 * deployments) hit before chain-specific tables.
 *
 * Defensive on the address arg: callers occasionally pass an undefined value
 * after a chrome.storage.session round-trip, and an unhandled .toLowerCase()
 * on undefined would otherwise take down the whole judging pipeline.
 */
export function lookupProtocol(chainId: number, address: string): ProtocolInfo | null {
  if (typeof address !== "string" || address.length === 0) return null;
  const lower = address.toLowerCase();
  const universal = UNIVERSAL[lower];
  if (universal) return universal;
  const chainTable = BY_CHAIN[chainId];
  if (!chainTable) return null;
  return chainTable[lower] ?? null;
}

export function isKnownProtocol(chainId: number, address: string): boolean {
  return lookupProtocol(chainId, address) !== null;
}
