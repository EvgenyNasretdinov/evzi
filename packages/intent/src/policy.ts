import type { AgentPolicy, Finding, OnchainContext, VerdictTier } from "@intent-check/types";

/**
 * Turn findings plus a tier into what an agent may do. Pure and total.
 *
 * Runs AFTER applySafetyFloor, and is never exposed to the model: the LLM can
 * explain a decision but must not be able to loosen one. That is the same
 * property the existing safety floor has, extended to agent actions.
 */
export function derivePolicy(
  findings: Finding[],
  tier: VerdictTier,
  opts: { onchain?: OnchainContext } = {},
): AgentPolicy {
  const hasDanger = findings.some((f) => f.severity === "danger");
  if (hasDanger || tier === "DANGER") return "REJECT";

  const hasWarn = findings.some((f) => f.severity === "warn");
  if (hasWarn || tier === "CAUTION") return "REQUIRE_APPROVAL";

  // A missing exposure figure is not evidence of safety: if we could not learn
  // how much an unlimited approval puts at risk, a human should look at it.
  const unlimited = findings.some((f) => f.code.includes("UNLIMITED"));
  if (unlimited && opts.onchain?.degraded) return "REQUIRE_APPROVAL";

  return "ALLOW";
}
