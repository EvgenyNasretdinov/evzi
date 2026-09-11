import type { AuthorizedIntent, Finding } from "@intent-check/types";
import { canonicalize, sha256Hex } from "./canonical";

/** An authorization before its hash is computed. */
export type IntentDraft = Omit<AuthorizedIntent, "hash" | "signer" | "signature">;

/**
 * The exact text a wallet is asked to sign.
 *
 * Deliberately human-readable: the whole point of asking a person to sign is
 * that they can read what they are agreeing to. It ends with the hash, so a
 * signature over this string covers every constraint without the wallet having
 * to render the whole object.
 */
export function authorizationMessage(intent: AuthorizedIntent): string {
  const c = intent.constraints;
  const caps = c.maxSpend
    .map((m) => `  at most ${m.amount} of ${m.token} on chain ${m.chainId}`)
    .join("\n");
  return [
    "Evzi authorization",
    "",
    intent.raw,
    "",
    `chains: ${c.chainIds.join(", ")}`,
    caps,
    `recipients: ${c.allowedRecipients.length ? c.allowedRecipients.join(", ") : "my own wallet only"}`,
    `unlimited approvals: ${c.allowUnlimitedApproval ? "allowed" : "forbidden"}`,
    c.expiresAt ? `expires: ${new Date(c.expiresAt).toISOString()}` : "expires: never",
    "",
    `hash: ${intent.hash}`,
  ].join("\n");
}

/**
 * Freeze a draft: hash every field, so later mutation is detectable.
 *
 * Called once, at the moment the human confirms. Everything downstream — the
 * agent, the worker, the popup — carries the result unchanged.
 */
export async function freezeIntent(draft: IntentDraft): Promise<AuthorizedIntent> {
  const hash = await sha256Hex(canonicalize(draft));
  return { ...draft, hash };
}

/**
 * Verify an authorization is the one the human confirmed, and is still live.
 *
 * Returns findings rather than throwing: the caller merges them into the
 * verdict checklist alongside every other signal, so the user sees the reason
 * rather than an opaque failure.
 */
export interface IntegrityOptions {
  now?: number;
  /**
   * Recovers the address that produced a signature over a message. Injected so
   * this package keeps depending only on types — the caller brings the crypto.
   * When absent, signatures are simply not checked.
   */
  recoverSigner?: (message: string, signature: string) => Promise<string>;
}

export async function checkIntegrity(
  intent: AuthorizedIntent,
  opts: IntegrityOptions | number = {},
): Promise<Finding[]> {
  // Older callers passed `now` positionally; keep them working.
  const options: IntegrityOptions = typeof opts === "number" ? { now: opts } : opts;
  const now = options.now ?? Date.now();
  const findings: Finding[] = [];
  // The signature is produced after freezing and therefore is not part of what
  // was hashed; re-hashing with it present would flag every signed
  // authorization as tampered.
  const { hash, signer: _signer, signature: _signature, ...draft } = intent;
  const recomputed = await sha256Hex(canonicalize(draft));

  if (recomputed !== hash) {
    findings.push({
      code: "INTENT_TAMPERED",
      severity: "danger",
      text: "The authorization was modified after you approved it — this request no longer matches what you agreed to.",
    });
  }

  // A hash catches carelessness; only a signature catches an adversary, because
  // the hash is over public data and anyone who edits a field can recompute it.
  if (options.recoverSigner) {
    if (!intent.signature || !intent.signer) {
      findings.push({
        code: "INTENT_UNSIGNED",
        severity: "warn",
        text: "This authorization is not signed, so there is no proof it came from your wallet rather than from the agent.",
      });
    } else {
      let recovered: string | undefined;
      try {
        recovered = await options.recoverSigner(authorizationMessage(intent), intent.signature);
      } catch {
        recovered = undefined;
      }
      if (!recovered || recovered.toLowerCase() !== intent.signer.toLowerCase()) {
        findings.push({
          code: "INTENT_SIGNATURE_INVALID",
          severity: "danger",
          text: "The signature on this authorization does not belong to the wallet it claims — it was not approved by you.",
        });
      }
    }
  }

  const { expiresAt } = intent.constraints;
  if (expiresAt !== undefined && now > expiresAt) {
    findings.push({
      code: "INTENT_EXPIRED",
      severity: "danger",
      text: "This authorization has expired. Approve a fresh one rather than reusing it.",
    });
  }

  return findings;
}
