import type { OnchainContext } from "@intent-check/types";

const BASE = "https://api.pinax.network/v1/evm";

/** Pinax network slugs for the chains Evzi supports. */
const NETWORKS: Record<number, string> = { 1: "mainnet", 8453: "base" };

export interface TokenApiArgs {
  chainId: number;
  address: string;
  jwt: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface Transfer {
  from?: string;
  to?: string;
  value?: string;
}

interface Balance {
  contract?: string;
  symbol?: string;
  amount?: string;
  value_usd?: number;
}

/** Best-effort GET. Any failure — status, transport, shape — yields undefined. */
async function get<T>(url: string, a: TokenApiArgs): Promise<T[] | undefined> {
  const doFetch = a.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${a.jwt}`, Accept: "application/json" },
      signal: a.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: T[] };
    return json.data ?? [];
  } catch {
    return undefined;
  }
}

const toBigInt = (v: string | undefined): bigint => {
  try {
    return BigInt(v ?? "0");
  } catch {
    return 0n;
  }
};

/**
 * Behavioural profile of a spender address.
 *
 * The drainer shape is many wallets paying in and one address taking
 * everything out. Contract verification cannot see this at all — an EOA has no
 * source code to verify.
 */
export async function fetchSpenderProfile(
  a: TokenApiArgs,
): Promise<OnchainContext["spender"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const addr = a.address.toLowerCase();
  const rows = await get<Transfer>(
    `${BASE}/transfers?network=${net}&address=${addr}&age=2&limit=10`,
    a,
  );
  if (!rows) return undefined;

  const inboundSenders = new Set<string>();
  const outboundByDest = new Map<string, bigint>();
  let outboundTotal = 0n;

  for (const r of rows) {
    const from = r.from?.toLowerCase();
    const to = r.to?.toLowerCase();
    const value = toBigInt(r.value);

    if (to === addr && from && from !== addr) inboundSenders.add(from);
    if (from === addr && to) {
      outboundByDest.set(to, (outboundByDest.get(to) ?? 0n) + value);
      outboundTotal += value;
    }
  }

  const largest = [...outboundByDest.values()].reduce((m, v) => (v > m ? v : m), 0n);
  const concentration =
    outboundTotal > 0n ? Number((largest * 10_000n) / outboundTotal) / 10_000 : 0;

  return {
    address: addr,
    distinctInboundSenders48h: inboundSenders.size,
    outboundConcentration: concentration,
  };
}

/** What the wallet actually holds — turns MAX_UINT256 into a dollar figure. */
export async function fetchWalletBalances(
  a: TokenApiArgs,
): Promise<OnchainContext["wallet"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const rows = await get<Balance>(
    `${BASE}/balances?network=${net}&address=${a.address.toLowerCase()}&limit=10`,
    a,
  );
  if (!rows) return undefined;

  const balances = rows.map((b) => ({
    token: (b.contract ?? "").toLowerCase(),
    symbol: b.symbol,
    amount: b.amount ?? "0",
    usd: b.value_usd,
  }));

  return {
    address: a.address.toLowerCase(),
    totalUsd: balances.reduce((s, b) => s + (b.usd ?? 0), 0),
    balances,
  };
}
