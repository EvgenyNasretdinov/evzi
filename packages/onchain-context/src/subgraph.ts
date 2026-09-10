import type { OnchainContext } from "@intent-check/types";

/**
 * A token row as returned by whichever subgraph serves this chain, already
 * reduced to the two things we care about.
 */
interface TokenFacts {
  symbol?: string;
  /** Dollars of liquidity or lifetime volume standing behind the token. */
  weightUsd: number;
}

export interface SubgraphSource {
  /** Deployment id on the decentralized network. Every id here was verified live. */
  id: string;
  query: string;
  extract: (t: Record<string, string>) => TokenFacts;
}

/**
 * Per-chain sources. The two deployments do NOT share a schema: mainnet serves
 * the Uniswap schema (`totalValueLockedUSD`, `volumeUSD`, `txCount`) while Base
 * serves a Messari-style one whose equivalents are underscore-prefixed and
 * which has no transaction counter. Hence a query and an extractor per chain
 * rather than one shared query.
 */
export const SUBGRAPH_SOURCES: Record<number, SubgraphSource> = {
  1: {
    id: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
    query:
      "query($id:ID!){ token(id:$id){ symbol name decimals txCount totalValueLockedUSD volumeUSD } }",
    extract: (t) => ({
      symbol: t.symbol,
      weightUsd: Math.max(Number(t.totalValueLockedUSD ?? "0"), Number(t.volumeUSD ?? "0")),
    }),
  },
  8453: {
    id: "FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS",
    query:
      "query($id:ID!){ token(id:$id){ symbol name lastPriceUSD _totalValueLockedUSD _totalSupply } }",
    extract: (t) => ({
      symbol: t.symbol,
      weightUsd: Number(t._totalValueLockedUSD ?? "0"),
    }),
  },
};

/** Below this, a token has no meaningful market — and a blue-chip symbol on it is a lie. */
const LIQUIDITY_FLOOR_USD = 100_000;

export interface TokenReputationArgs {
  chainId: number;
  token: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Ask The Graph what the market knows about this token.
 *
 * Sourcify tells us whether code is verified; it cannot tell a real USDC from a
 * counterfeit carrying the same symbol. Liquidity can. Returns `undefined` when
 * the lookup could not be performed at all — distinct from a definite "this
 * token is unknown to the market", which comes back as `canonical: false`.
 */
export async function fetchTokenReputation(
  args: TokenReputationArgs,
): Promise<OnchainContext["token"] | undefined> {
  const source = SUBGRAPH_SOURCES[args.chainId];
  if (!source) return undefined;

  const address = args.token.toLowerCase();
  const doFetch = args.fetchImpl ?? fetch;

  try {
    const res = await doFetch(
      `https://gateway.thegraph.com/api/${args.apiKey}/subgraphs/id/${source.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: source.query, variables: { id: address } }),
        signal: args.signal,
      },
    );
    if (!res.ok) return undefined;

    const json = (await res.json()) as {
      data?: { token: Record<string, string> | null };
      errors?: unknown[];
    };

    // The gateway answers 200 with an `errors` array for a missing deployment
    // or a bad field, so status alone is not enough to trust the body.
    if (json.errors?.length) return undefined;
    if (!json.data) return undefined;

    const row = json.data.token;
    if (!row) return { address, canonical: false };

    const facts = source.extract(row);
    const canonical = facts.weightUsd >= LIQUIDITY_FLOOR_USD;

    return {
      address,
      symbol: facts.symbol,
      marketCapUsd: canonical ? facts.weightUsd : undefined,
      canonical,
    };
  } catch {
    return undefined;
  }
}
