import type {
  AuthorizedIntent,
  DecodedAction,
  Finding,
  OnchainContext,
  SimResult,
} from "@intent-check/types";
import { extractSpend } from "./spend";

export interface VerifyContext {
  chainId: number;
  /** The user's own wallet — the implicit recipient when none are listed. */
  wallet: string;
  onchain?: OnchainContext;
  sim?: SimResult;
  /**
   * Whether an address is a vetted protocol. Injected by the caller so this
   * package keeps depending only on types. Approving a router is how swaps
   * work; without this, every legitimate swap approval reads as a drain.
   */
  isKnownSpender?: (address: string) => boolean;
}

const danger = (code: string, text: string): Finding => ({ code, severity: "danger", text });

/**
 * Check one proposed action against the human's frozen authorization.
 *
 * Sync and pure: given the same inputs it always produces the same findings,
 * which is what makes the resulting policy something the agent cannot argue
 * with. Every violation is reported, not just the first, so the user sees the
 * whole picture in one pass.
 */
export function verifyAgainstIntent(
  intent: AuthorizedIntent,
  decoded: DecodedAction,
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  const { constraints } = intent;
  const wallet = ctx.wallet.toLowerCase();

  if (!constraints.chainIds.includes(ctx.chainId)) {
    findings.push(
      danger(
        "INTENT_CHAIN_MISMATCH",
        `This runs on chain ${ctx.chainId}, but you authorized only ${constraints.chainIds.join(", ")}.`,
      ),
    );
  }

  const { movements, unrecognized } = extractSpend(decoded, ctx.chainId);

  if (unrecognized) {
    findings.push({
      code: "INTENT_UNVERIFIABLE",
      severity: "warn",
      text: "This call could not be decoded, so it cannot be checked against your authorization.",
    });
  }

  const allowed = new Set(constraints.allowedRecipients.map((r) => r.toLowerCase()));

  for (const m of movements) {
    if (m.isUnlimited && !constraints.allowUnlimitedApproval) {
      findings.push(
        danger(
          "INTENT_UNLIMITED_APPROVAL_FORBIDDEN",
          `This grants unlimited access to your ${m.token.slice(0, 10)}…, but you ruled out unlimited approvals.`,
        ),
      );
    }

    const cap = constraints.maxSpend.find(
      (c) => c.chainId === ctx.chainId && c.token.toLowerCase() === m.token,
    );

    if (!cap) {
      findings.push(
        danger(
          "INTENT_TOKEN_MISMATCH",
          `This moves ${m.token.slice(0, 10)}…, which your authorization never mentioned.`,
        ),
      );
    } else if (!m.isUnlimited && BigInt(m.amount) > BigInt(cap.amount)) {
      findings.push(
        danger(
          "INTENT_AMOUNT_EXCEEDED",
          `This spends ${m.amount}, above the ${cap.amount} you authorized.`,
        ),
      );
    }

    // An empty allow-list means "my own wallet only", and Set.has on an empty
    // set is already false — no special case needed. The swapIn carve-out
    // exists because a router legitimately appears as the recipient mid-swap.
    const to = m.recipient;
    const isThirdParty = to !== undefined && to !== wallet && !allowed.has(to);
    const routerLegOk = allowed.size === 0 && m.kind === "swapIn";
    // Granting an allowance to a vetted protocol is not a transfer to a
    // stranger; the amount and unlimited checks above are what police it.
    const vettedSpender =
      m.kind === "approve" && to !== undefined && (ctx.isKnownSpender?.(to) ?? false);
    if (isThirdParty && !routerLegOk && !vettedSpender) {
      findings.push(
        danger(
          "INTENT_RECIPIENT_NOT_ALLOWED",
          `This sends to ${to.slice(0, 10)}…, which is neither your wallet nor a recipient you approved.`,
        ),
      );
    }
  }

  return findings;
}
