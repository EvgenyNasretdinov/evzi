import { describe, it, expect } from "vitest";
import { derivePolicy } from "../src/policy";
import type { Finding } from "@intent-check/types";

const f = (code: string, severity: Finding["severity"]): Finding => ({
  code,
  severity,
  text: code,
});

describe("intent — derivePolicy", () => {
  it("allows a clean SAFE verdict", () => {
    expect(derivePolicy([], "SAFE")).toBe("ALLOW");
  });

  it("rejects any INTENT_ violation even when the tier is SAFE", () => {
    expect(derivePolicy([f("INTENT_AMOUNT_EXCEEDED", "danger")], "SAFE")).toBe("REJECT");
  });

  it("rejects a DANGER tier with no findings attached", () => {
    expect(derivePolicy([], "DANGER")).toBe("REJECT");
  });

  it("rejects on a non-intent danger finding", () => {
    expect(derivePolicy([f("UNLIMITED_APPROVAL", "danger")], "SAFE")).toBe("REJECT");
  });

  it("requires approval on CAUTION", () => {
    expect(derivePolicy([], "CAUTION")).toBe("REQUIRE_APPROVAL");
  });

  it("requires approval on a warn finding", () => {
    expect(derivePolicy([f("INTENT_UNVERIFIABLE", "warn")], "SAFE")).toBe("REQUIRE_APPROVAL");
  });

  it("ignores info findings", () => {
    expect(derivePolicy([f("GRAPH_EXPOSURE_USD", "info")], "SAFE")).toBe("ALLOW");
  });

  it("never allows an unlimited approval while on-chain context is degraded", () => {
    expect(
      derivePolicy([f("UNLIMITED_APPROVAL_PRESENT", "info")], "SAFE", {
        onchain: { degraded: true },
      }),
    ).toBe("REQUIRE_APPROVAL");
  });

  it("allows the same case once context is healthy", () => {
    expect(
      derivePolicy([f("UNLIMITED_APPROVAL_PRESENT", "info")], "SAFE", {
        onchain: { degraded: false },
      }),
    ).toBe("ALLOW");
  });

  it("prefers the strictest outcome when signals disagree", () => {
    expect(
      derivePolicy([f("SOMETHING", "warn"), f("INTENT_CHAIN_MISMATCH", "danger")], "CAUTION"),
    ).toBe("REJECT");
  });
});
