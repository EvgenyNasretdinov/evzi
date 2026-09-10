import type { OnchainContext } from "@intent-check/types";

const BASE = "https://api.pinax.network/v1/evm";

/** Pinax network slugs for the chains Evzi supports. */
const NETWORKS: Record<number, string> = { 1: "mainnet", 8453: "base" };

/**
 * A token nobody holds cannot be the blue chip it claims to be. Real USDC has
 * ~8.8M holders; a counterfeit deployed to drain one victim has a handful.
 */
const HOLDERS_FLOOR = 1000;

export interface TokenApiArgs {
  chainId: number;
  address: string;
  jwt: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Shape confirmed against the live API on 2026-09-10. */
interface TokenRow {
  contract?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  holders?: number;
  total_transfers?: number;
  circulating_supply?: number;
}

/** Shape confirmed against the live API on 2026-09-10. */
interface BalanceRow {
  contract?: string;
  symbol?: string;
  decimals?: number;
  /** Raw integer string. */
  amount?: string;
  /** Token quantity, i.e. amount scaled by decimals. NOT a dollar figure. */
  value?: number;
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

/**
 * How many people actually hold this token.
 *
 * Complements the subgraph's liquidity view: liquidity says a market exists,
 * holder count says a population exists. A counterfeit fails both, and the two
 * come from different Graph products, so one being unavailable does not blind
 * us.
 *
 * Returns `undefined` when the lookup could not run at all — distinct from a
 * definite "this token is unknown", which is `canonical: false`.
 */
export async function fetchTokenStats(
  a: TokenApiArgs,
): Promise<OnchainContext["token"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const address = a.address.toLowerCase();
  const rows = await get<TokenRow>(`${BASE}/tokens?network=${net}&contract=${address}`, a);
  if (!rows) return undefined;

  const row = rows[0];
  if (!row) return { address, canonical: false };

  const holders = row.holders ?? 0;
  return {
    address,
    symbol: row.symbol,
    holders,
    canonical: holders >= HOLDERS_FLOOR,
  };
}

/**
 * What the wallet actually holds.
 *
 * The API reports token quantities, not dollars — there is no USD price on any
 * endpoint available to us — so callers must phrase exposure in tokens.
 */
export async function fetchWalletBalances(
  a: TokenApiArgs,
): Promise<OnchainContext["wallet"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const rows = await get<BalanceRow>(
    `${BASE}/balances?network=${net}&address=${a.address.toLowerCase()}&limit=10`,
    a,
  );
  if (!rows) return undefined;

  return {
    address: a.address.toLowerCase(),
    balances: rows.map((b) => ({
      token: (b.contract ?? "").toLowerCase(),
      symbol: b.symbol,
      amount: b.amount ?? "0",
      quantity: b.value,
    })),
  };
}

// Deliberately absent: a spender-funnel profile.
//
// It would need transfers filtered by recipient across all tokens. Verified
// 2026-09-10 that `/v1/evm/transfers` ignores `to`/`recipient`/`receiver`
// entirely and returns nothing for `to_address`/`from_address` at any `age`, so
// the query cannot be expressed on this tier. Shipping a guess here would mean
// a security signal that silently never fires, which is worse than not having
// one.
