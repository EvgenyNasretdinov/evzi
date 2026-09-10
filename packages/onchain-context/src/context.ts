import type { OnchainContext } from "@intent-check/types";
import { fetchTokenReputation } from "./subgraph";
import { fetchTokenStats, fetchWalletBalances } from "./tokenApi";
import { cachedOrKickoff } from "./cache";

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
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Token API results stay usable far longer than the verdict they serve: holder
 * counts and balances move slowly, and the alternative is no signal at all.
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

  // Fast path — the only thing we block on. The subgraph answers in a few
  // hundred milliseconds, which is the budget a user waiting to sign has.
  const liquidity =
    args.token && args.graphApiKey
      ? await settle(
          d.tokenReputation({
            chainId: args.chainId,
            token: args.token,
            apiKey: args.graphApiKey,
          }),
          timeout,
        )
      : undefined;

  // Slow path — never awaited. Served from cache when warm, kicked off in the
  // background when cold, so the first sighting of a token costs nothing and
  // every later one is enriched.
  const holders =
    args.token && args.tokenApiJwt
      ? cachedOrKickoff(`tokens:${args.chainId}:${args.token.toLowerCase()}`, SLOW_SOURCE_TTL_MS, () =>
          d.tokenStats({ chainId: args.chainId, address: args.token!, jwt: args.tokenApiJwt! }),
        )
      : undefined;

  const wallet = wantWallet
    ? cachedOrKickoff(`balances:${args.chainId}:${args.wallet!.toLowerCase()}`, SLOW_SOURCE_TTL_MS, () =>
        d.walletBalances({ chainId: args.chainId, address: args.wallet!, jwt: args.tokenApiJwt! }),
      )
    : undefined;

  const token = args.token ? mergeToken(args.token.toLowerCase(), liquidity, holders) : undefined;

  // Degraded means "something we wanted is missing", which includes a slow
  // source that has not landed yet. The policy layer reads that as a reason to
  // ask a human rather than as evidence of safety.
  const degraded = (wantToken && !token) || (wantWallet && !wallet);

  return { token, wallet, degraded };
}
