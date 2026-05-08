import { describe, it, expect } from "vitest";
import { applySafetyFloor } from "../src/safetyFloor";
import type { JudgeVerdict, Finding } from "@intent-check/types";

const llm: JudgeVerdict = { tier: "SAFE", headline: "looks fine", reasons: [], confidence: 0.9 };

describe("safety floor", () => {
  it("upgrades SAFE to DANGER when a danger finding exists", () => {
    const findings: Finding[] = [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "unlimited approval" }];
    const r = applySafetyFloor(llm, findings);
    expect(r.tier).toBe("DANGER");
    expect(r.reasons.some((x) => x.text.includes("unlimited approval"))).toBe(true);
  });

  it("upgrades SAFE to CAUTION when only warn findings", () => {
    const findings: Finding[] = [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "contract is not verified" }];
    expect(applySafetyFloor(llm, findings).tier).toBe("CAUTION");
  });

  it("never downgrades a higher LLM tier", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    expect(applySafetyFloor(danger, []).tier).toBe("DANGER");
  });
});
