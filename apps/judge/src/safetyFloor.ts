import { maxTier, type Finding, type JudgeInput, type JudgeVerdict, type VerdictTier } from "@intent-check/types";

function findingsTier(findings: Finding[]): VerdictTier {
  if (findings.some((f) => f.severity === "danger")) return "DANGER";
  if (findings.some((f) => f.severity === "warn"))   return "CAUTION";
  return "SAFE";
}

/**
 * Returns true when the deterministic signals together justify clamping the
 * LLM's verdict to ≤ CAUTION. This is the "trust ceiling": the LLM cannot
 * escalate to DANGER on a hunch about a transaction we already vetted as
 * a known protocol with a successful simulation and no danger findings.
 */
function isDeterministicallyTrusted(input: JudgeInput): boolean {
  if (input.decoded.kind !== "swap") return false;
  if (input.decoded.trusted !== true) return false;
  if (!input.sim || !input.sim.success) return false;
  if (input.findings.some((f) => f.severity === "danger")) return false;
  return true;
}

export function applySafetyFloor(llm: JudgeVerdict, findingsOrInput: Finding[] | JudgeInput): JudgeVerdict {
  // Support both legacy (findings only) and new (full input) call sites.
  const findings = Array.isArray(findingsOrInput) ? findingsOrInput : findingsOrInput.findings;
  const input = Array.isArray(findingsOrInput) ? null : findingsOrInput;

  let working = llm;

  // Trust ceiling: if all deterministic signals are positive on a known protocol,
  // refuse to escalate to DANGER. CAUTION is still allowed (LLM may catch real risks).
  if (input && isDeterministicallyTrusted(input) && working.tier === "DANGER") {
    working = {
      ...working,
      tier: "CAUTION",
      headline: working.headline,
      reasons: [
        { severity: "info" as const, text: "Deterministic checks all passed (trusted protocol, simulation OK, no danger findings) — agent's danger verdict softened to CAUTION." },
        ...working.reasons,
      ],
    };
  }

  const floor = findingsTier(findings);
  const tier = maxTier(working.tier, floor);
  if (tier === working.tier) return working;

  const extraReasons = findings
    .filter((f) => (tier === "DANGER" && f.severity === "danger") || (tier === "CAUTION" && f.severity !== "info"))
    .map((f) => ({ severity: f.severity, text: f.text }));

  return {
    ...working,
    tier,
    reasons: [...extraReasons, ...working.reasons],
    headline: tier === "DANGER" ? `Stop — ${extraReasons[0]?.text ?? working.headline}` : working.headline,
  };
}
