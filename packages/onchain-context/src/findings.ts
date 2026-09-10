import type { Finding, OnchainContext } from "@intent-check/types";

/**
 * Symbols worth impersonating. A counterfeit carrying one of these is never an
 * accident, which is what makes "no market behind it" damning rather than
 * merely unusual.
 */
const BLUE_CHIPS = new Set(["USDC", "USDT", "DAI", "WETH", "WBTC"]);

/** Many payers in, one payee out — the drainer funnel. */
const FUNNEL_MIN_SENDERS = 20;
const FUNNEL_MIN_CONCENTRATION = 0.8;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Turn live Graph data into verdict findings.
 *
 * Each finding here is one the deterministic layer could not reach on its own:
 * contract verification describes code, while these describe behaviour and
 * markets. That is the whole reason live data earns its place in the pipeline.
 */
export function graphFindings(
  ctx: OnchainContext,
  opts: { claimedSymbol?: string; isUnlimitedApproval?: boolean },
): Finding[] {
  const findings: Finding[] = [];

  const claimed = (opts.claimedSymbol ?? ctx.token?.symbol ?? "").toUpperCase();
  if (ctx.token && !ctx.token.canonical && BLUE_CHIPS.has(claimed)) {
    findings.push({
      code: "GRAPH_TOKEN_IMPERSONATION",
      severity: "danger",
      text: `This token calls itself ${claimed}, but The Graph shows no real market behind this address — the genuine ${claimed} has hundreds of millions in liquidity.`,
    });
  }

  const s = ctx.spender;
  if (
    s &&
    s.distinctInboundSenders48h >= FUNNEL_MIN_SENDERS &&
    s.outboundConcentration >= FUNNEL_MIN_CONCENTRATION
  ) {
    findings.push({
      code: "GRAPH_SPENDER_FUNNEL",
      severity: "danger",
      text: `${s.distinctInboundSenders48h} different wallets sent tokens to this address in the last 48 hours, and ${Math.round(
        s.outboundConcentration * 100,
      )}% of what left went to a single address. That is the shape of a drainer.`,
    });
  }

  if (opts.isUnlimitedApproval && ctx.wallet?.totalUsd) {
    findings.push({
      code: "GRAPH_EXPOSURE_USD",
      severity: "warn",
      text: `An unlimited approval here would put ${usd(
        ctx.wallet.totalUsd,
      )} of holdings within reach.`,
    });
  }

  return findings;
}
