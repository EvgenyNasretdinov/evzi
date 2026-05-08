import { maxTier, type Finding, type JudgeVerdict, type VerdictTier } from "@intent-check/types";

function findingsTier(findings: Finding[]): VerdictTier {
  if (findings.some((f) => f.severity === "danger")) return "DANGER";
  if (findings.some((f) => f.severity === "warn"))   return "CAUTION";
  return "SAFE";
}

export function applySafetyFloor(llm: JudgeVerdict, findings: Finding[]): JudgeVerdict {
  const floor = findingsTier(findings);
  const tier = maxTier(llm.tier, floor);
  if (tier === llm.tier) return llm;

  const extraReasons = findings
    .filter((f) => (tier === "DANGER" && f.severity === "danger") || (tier === "CAUTION" && f.severity !== "info"))
    .map((f) => ({ severity: f.severity, text: f.text }));

  return {
    ...llm,
    tier,
    reasons: [...extraReasons, ...llm.reasons],
    headline: tier === "DANGER" ? `Stop — ${extraReasons[0]?.text ?? llm.headline}` : llm.headline,
  };
}
