import type { AuthorizedIntent, Finding } from "@intent-check/types";
import { canonicalize, sha256Hex } from "./canonical";

/** An authorization before its hash is computed. */
export type IntentDraft = Omit<AuthorizedIntent, "hash">;

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
export async function checkIntegrity(
  intent: AuthorizedIntent,
  now: number = Date.now(),
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { hash, ...draft } = intent;
  const recomputed = await sha256Hex(canonicalize(draft));

  if (recomputed !== hash) {
    findings.push({
      code: "INTENT_TAMPERED",
      severity: "danger",
      text: "The authorization was modified after you approved it — this request no longer matches what you agreed to.",
    });
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
