import type { OnchainContext } from "@intent-check/types";
import { fetchTokenReputation } from "./subgraph";
import { fetchSpenderProfile, fetchWalletBalances } from "./tokenApi";

export interface Deps {
  tokenReputation: (a: {
    chainId: number;
    token: string;
    apiKey: string;
    signal?: AbortSignal;
  }) => Promise<OnchainContext["token"] | undefined>;
  spenderProfile: (a: {
    chainId: number;
    address: string;
    jwt: string;
    signal?: AbortSignal;
  }) => Promise<OnchainContext["spender"] | undefined>;
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
  spender?: string;
  wallet?: string;
  graphApiKey?: string;
  tokenApiJwt?: string;
  timeoutMs?: number;
  deps?: Partial<Deps>;
}

const DEFAULT_TIMEOUT_MS = 3000;

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
    spenderProfile: fetchSpenderProfile,
    walletBalances: fetchWalletBalances,
    ...args.deps,
  };

  const wantToken = Boolean(args.token && args.graphApiKey);
  const wantSpender = Boolean(args.spender && args.tokenApiJwt);
  const wantWallet = Boolean(args.wallet && args.tokenApiJwt);

  const [token, spender, wallet] = await Promise.all([
    wantToken
      ? settle(
          d.tokenReputation({
            chainId: args.chainId,
            token: args.token!,
            apiKey: args.graphApiKey!,
          }),
          timeout,
        )
      : Promise.resolve(undefined),
    wantSpender
      ? settle(
          d.spenderProfile({
            chainId: args.chainId,
            address: args.spender!,
            jwt: args.tokenApiJwt!,
          }),
          timeout,
        )
      : Promise.resolve(undefined),
    wantWallet
      ? settle(
          d.walletBalances({
            chainId: args.chainId,
            address: args.wallet!,
            jwt: args.tokenApiJwt!,
          }),
          timeout,
        )
      : Promise.resolve(undefined),
  ]);

  const degraded = (wantToken && !token) || (wantSpender && !spender) || (wantWallet && !wallet);

  return { token, spender, wallet, degraded };
}
