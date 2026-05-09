// apps/extension/src/lib/blockTime.ts

/** Approximate blocks per day for our supported chains. Off by ~10% is fine —
 * we use this for "is this contract less than 7 days old?" thresholds, not
 * for displaying timestamps. */
const BLOCKS_PER_DAY: Record<number, number> = {
  1: 7200,        // Ethereum (12s/block)
  10: 43200,      // Optimism Bedrock (2s/block)
  8453: 43200,    // Base (2s/block)
  42161: 350000,  // Arbitrum One (~0.25s/block, ~350K/day in practice)
};

export function estimateAgeDays(args: { chainId: number; headBlock: number; deployBlock: number }): number | undefined {
  const bpd = BLOCKS_PER_DAY[args.chainId];
  if (!bpd) return undefined;
  return Math.max(0, (args.headBlock - args.deployBlock) / bpd);
}

const headCache = new Map<number, { head: number; at: number }>();

/** Fetch chain head via JSON-RPC. 60s in-memory cache per chainId.
 * Returns undefined on any failure — caller decides what to do without an age. */
export async function getChainHead(chainId: number, rpcUrl: string): Promise<number | undefined> {
  const cached = headCache.get(chainId);
  if (cached && Date.now() - cached.at < 60_000) return cached.head;
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: string };
    if (!body.result) return undefined;
    const head = Number(BigInt(body.result));
    if (!Number.isFinite(head)) return undefined;
    headCache.set(chainId, { head, at: Date.now() });
    return head;
  } catch { return undefined; }
}

/** Free public read-only RPCs we use only for `eth_blockNumber` reads.
 * Replace with a backend-proxied call before any production deploy. */
export const FREE_RPC: Record<number, string> = {
  1: "https://cloudflare-eth.com",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
};

/** Test-only hook to reset the cache between tests. */
export function __resetHeadCache(): void { headCache.clear(); }
