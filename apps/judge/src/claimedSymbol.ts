import type { JudgeInput } from "@intent-check/types";

/** Symbols a counterfeit is worth impersonating. Kept in sync with onchain-context. */
const BLUE_CHIPS = ["USDC", "USDT", "DAI", "WETH", "WBTC"];

/**
 * What this token claims to be, as opposed to what the market says it is.
 *
 * The claim cannot come from The Graph: a counterfeit is precisely a token The
 * Graph has never indexed, so it has no symbol there. The claim lives wherever
 * the user was told what they are approving — the token's own metadata as the
 * extension resolved it, or the intent the dApp presented.
 *
 * Order matters: on-chain metadata beats prose, because a counterfeit sets its
 * own `symbol()` to the name it is impersonating.
 */
export function claimedSymbolFor(input: JudgeInput, token: string | undefined): string | undefined {
  if (!token) return undefined;
  const needle = token.toLowerCase();

  const fromDelta = input.netEffect?.deltas.find((d) => d.token.toLowerCase() === needle)?.symbol;
  if (fromDelta) return fromDelta;

  const fromIntent = [...(input.intent.tokensIn ?? []), ...(input.intent.tokensOut ?? [])].find(
    (t) => t.address.toLowerCase() === needle,
  )?.symbol;
  if (fromIntent) return fromIntent;

  // Last resort: the summary the user actually read. If it named a blue chip,
  // that is the claim being made, whoever made it.
  const summary = input.intent.summary.toUpperCase();
  return BLUE_CHIPS.find((s) => summary.includes(s));
}
