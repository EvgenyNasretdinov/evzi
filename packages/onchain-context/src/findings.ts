import type { Finding, OnchainContext } from "@intent-check/types";

/**
 * Symbols worth impersonating. A counterfeit carrying one of these is never an
 * accident, which is what makes "no market behind it" damning rather than
 * merely unusual.
 */
const BLUE_CHIPS = new Set(["USDC", "USDT", "DAI", "WETH", "WBTC"]);

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface FindingOpts {
  /** Symbol the dApp or calldata claims this token has. */
  claimedSymbol?: string;
  isUnlimitedApproval?: boolean;
  /** Address of the token being approved, used to price the exposure. */
  approvedToken?: string;
}

/**
 * Turn live Graph data into verdict findings.
 *
 * Each finding here is one the deterministic layer could not reach on its own:
 * contract verification describes code, while these describe markets and
 * holdings. That is what earns live data its place in the pipeline.
 */
export function graphFindings(ctx: OnchainContext, opts: FindingOpts): Finding[] {
  const findings: Finding[] = [];

  const claimed = (opts.claimedSymbol ?? ctx.token?.symbol ?? "").toUpperCase();
  if (ctx.token && !ctx.token.canonical && BLUE_CHIPS.has(claimed)) {
    const holders = ctx.token.holders;
    const evidence =
      holders === undefined
        ? "The Graph shows no real market behind this address"
        : holders === 0
          ? "The Graph has never seen anyone hold it"
          : `The Graph counts only ${qty(holders)} holders of it`;
    findings.push({
      code: "GRAPH_TOKEN_IMPERSONATION",
      severity: "danger",
      text: `This token calls itself ${claimed}, but ${evidence} — the genuine ${claimed} has millions of holders.`,
    });
  }

  if (opts.isUnlimitedApproval && ctx.wallet && opts.approvedToken) {
    const held = ctx.wallet.balances.find(
      (b) => b.token === opts.approvedToken!.toLowerCase(),
    );
    if (held?.quantity) {
      findings.push({
        code: "GRAPH_EXPOSURE",
        severity: "warn",
        text: `An unlimited approval here would put your entire ${qty(held.quantity)} ${held.symbol ?? "token"} balance within reach, not just the amount you are spending now.`,
      });
    }
  }

  return findings;
}
