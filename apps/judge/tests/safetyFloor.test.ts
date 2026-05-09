import { describe, it, expect } from "vitest";
import { applySafetyFloor } from "../src/safetyFloor";
import type { JudgeVerdict, Finding, JudgeInput } from "@intent-check/types";

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

// ---- M2.6 trust-ceiling clamp ----

function trustedSwapInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    intent: { kind: "swap", summary: "swap", confidence: 0.9 },
    decoded: {
      kind: "swap",
      tokenIn:  { chainId: 10, address: "0x4200000000000000000000000000000000000006", amount: "100" },
      tokenOut: { chainId: 10, address: "0x4200000000000000000000000000000000000042", amount: "0" },
      minAmountOut: "0",
      recipient: "0x0000000000000000000000000000000000000002",
      recipientKind: "router_self",
      router: "0x8B844f885672f333Bc0042cB669255f93a4C1E6b",
      protocol: "Uniswap",
      trusted: true,
      commands: ["V3_SWAP_EXACT_IN", "UNWRAP_WETH"],
    },
    sim: { success: true, assetChanges: [], balanceChanges: [], gasUsed: "100000", logs: [] },
    contract: { address: "0x8B844f885672f333Bc0042cB669255f93a4C1E6b", chainId: 10, verified: false, isProxy: false },
    origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
    findings: [],
    request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x8B844f885672f333Bc0042cB669255f93a4C1E6b" }] },
    ...overrides,
  };
}

describe("safety floor — trust ceiling", () => {
  it("clamps LLM DANGER to CAUTION on a fully trusted swap", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER", headline: "looks scary" };
    const r = applySafetyFloor(danger, trustedSwapInput());
    expect(r.tier).toBe("CAUTION");
    expect(r.reasons[0]?.text.toLowerCase()).toContain("deterministic checks all passed");
  });

  it("does NOT clamp when sim is missing", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    const r = applySafetyFloor(danger, trustedSwapInput({ sim: undefined }));
    expect(r.tier).toBe("DANGER");
  });

  it("does NOT clamp when sim failed", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    const r = applySafetyFloor(danger, trustedSwapInput({ sim: { success: false, assetChanges: [], balanceChanges: [], gasUsed: "0", logs: [] } }));
    expect(r.tier).toBe("DANGER");
  });

  it("does NOT clamp when a danger finding exists", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    const findings: Finding[] = [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "x" }];
    const r = applySafetyFloor(danger, trustedSwapInput({ findings }));
    expect(r.tier).toBe("DANGER");
  });

  it("does NOT clamp when decoded.trusted is false", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    const input = trustedSwapInput();
    if (input.decoded.kind !== "swap") throw new Error();
    input.decoded.trusted = false;
    const r = applySafetyFloor(danger, input);
    expect(r.tier).toBe("DANGER");
  });

  it("preserves CAUTION when LLM said CAUTION on a trusted swap (no spurious info reason)", () => {
    const caution: JudgeVerdict = { ...llm, tier: "CAUTION", reasons: [{ severity: "warn" as const, text: "slight thing" }] };
    const r = applySafetyFloor(caution, trustedSwapInput());
    expect(r.tier).toBe("CAUTION");
    expect(r.reasons.length).toBe(1);
    expect(r.reasons[0]?.text).toBe("slight thing");
  });

  // M2.7 — registry-based trust ceiling (works even when decoded.kind === "unknown")
  it("clamps DANGER to CAUTION when decoded is unknown but contract is in registry", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    const input: JudgeInput = {
      ...trustedSwapInput(),
      decoded: { kind: "unknown", selector: "0x24856bc3" },
      contract: {
        address: "0x8B844f885672f333Bc0042cB669255f93a4C1E6b",
        chainId: 10,
        verified: false,
        isProxy: false,
        knownProtocol: { protocol: "Uniswap", name: "UniversalRouter v2", kind: "router" },
      },
    };
    const r = applySafetyFloor(danger, input);
    expect(r.tier).toBe("CAUTION");
  });
});
