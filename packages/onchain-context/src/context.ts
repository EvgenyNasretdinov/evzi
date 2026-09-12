import type { OnchainContext } from "@intent-check/types";
import { fetchTokenReputation } from "./subgraph";
import { fetchTokenStats, fetchWalletBalances } from "./tokenApi";
import { cachedOrKickoffDurable, type DurableStore } from "./cache";

type TokenFacts = NonNullable<OnchainContext["token"]>;

export interface Deps {
  /** Subgraph view: liquidity and volume standing behind the token. */
  tokenReputation: (a: {
    chainId: number;
    token: string;
    apiKey: string;
    signal?: AbortSignal;
  }) => Promise<TokenFacts | undefined>;
  /** Token API view: how many people hold it. */
  tokenStats: (a: {
    chainId: number;
    address: string;
    jwt: string;
    signal?: AbortSignal;
  }) => Promise<TokenFacts | undefined>;
  walletBalances: (a: {
    chainId: number;
    address: string;
    jwt: string;
    signal?: AbortSignal;
  }) => Promise<OnchainContext["wallet"] | undefined>;
}

export interface ContextArgs {
  chainId: number;
  token?: string;
  wallet?: string;
  graphApiKey?: string;
  tokenApiJwt?: string;
  timeoutMs?: number;
  deps?: Partial<Deps>;
  /** Pass `c.executionCtx.waitUntil` on Workers so background enrichment survives. */
  keepAlive?: (p: Promise<unknown>) => void;
  /** Somewhere durable to cache slow upstreams. Workers KV in production. */
  store?: DurableStore;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Token API results stay usable far longer than the verdict they serve: holder
 * counts and balances move slowly, so a cached answer is nearly as good as a
 * fresh one, and repeat lookups cost nothing.
 */
const SLOW_SOURCE_TTL_MS = 600_000;

/**
 * Resolve to `undefined` rather than rejecting, whether the promise is slow or
 * throws. A data source must never be able to take down a verdict.
 */
function settle<T>(p: Promise<T | undefined>, ms: number): Promise<T | undefined> {
  return Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Merge the two independent views of a token.
 *
 * Liquidity and holder count are different evidence from different Graph
 * products, so a token is treated as canonical if either can vouch for it — and
 * one product being unavailable does not blind the check.
 */
function mergeToken(
  address: string,
  liquidity: TokenFacts | undefined,
  holders: TokenFacts | undefined,
): TokenFacts | undefined {
  if (!liquidity && !holders) return undefined;
  return {
    address,
    symbol: holders?.symbol ?? liquidity?.symbol,
    holders: holders?.holders,
    marketCapUsd: liquidity?.marketCapUsd,
    canonical: Boolean(liquidity?.canonical || holders?.canonical),
  };
}

/**
 * Gather live Graph context for one proposed action.
 *
 * Never throws and never blocks: a source that fails, times out, or has no
 * credential simply leaves its slot empty. `degraded` says whether something we
 * asked for is missing, so the policy layer can refuse to read silence as
 * safety.
 */
export async function fetchOnchainContext(args: ContextArgs): Promise<OnchainContext> {
  const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const d: Deps = {
    tokenReputation: fetchTokenReputation,
    tokenStats: fetchTokenStats,
    walletBalances: fetchWalletBalances,
    ...args.deps,
  };

  const wantToken = Boolean(args.token);
  const wantWallet = Boolean(args.wallet && args.tokenApiJwt);

  // Both Graph products are asked at once and share one budget, so the wait is
  // the slowest single answer rather than the sum of them. Each is cached and
  // may fall back to filling that cache in the background: a source that has a
  // bad day costs the caller the budget, never the verdict.
  const slow = { store: args.store, keepAlive: args.keepAlive, waitMs: timeout };

  const [liquidity, holders, wallet] = await Promise.all([
    args.token && args.graphApiKey
      ? settle(
          d.tokenReputation({
            chainId: args.chainId,
            token: args.token,
            apiKey: args.graphApiKey,
          }),
          timeout,
        )
      : undefined,

    args.token && args.tokenApiJwt
      ? cachedOrKickoffDurable(
          `tokens:${args.chainId}:${args.token.toLowerCase()}`,
          SLOW_SOURCE_TTL_MS,
          () => d.tokenStats({ chainId: args.chainId, address: args.token!, jwt: args.tokenApiJwt! }),
          slow,
        )
      : undefined,

    wantWallet
      ? cachedOrKickoffDurable(
          `balances:${args.chainId}:${args.wallet!.toLowerCase()}`,
          SLOW_SOURCE_TTL_MS,
          () => d.walletBalances({ chainId: args.chainId, address: args.wallet!, jwt: args.tokenApiJwt! }),
          slow,
        )
      : undefined,
  ]);

  const token = args.token ? mergeToken(args.token.toLowerCase(), liquidity, holders) : undefined;

  // Degraded means "something we wanted is missing", which includes a slow
  // source that has not landed yet. The policy layer reads that as a reason to
  // ask a human rather than as evidence of safety.
  const degraded = (wantToken && !token) || (wantWallet && !wallet);

  return { token, wallet, degraded };
}
