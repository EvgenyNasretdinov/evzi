import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { freezeIntent, type IntentDraft } from "../src/freeze";

/**
 * The agent console reimplements canonical JSON in plain browser JS, because it
 * has to hash an authorization before any bundler is involved. If that copy
 * drifts from this package, every authorization it produces would fail the
 * integrity check with no obvious cause.
 *
 * Rather than trusting a second copy to stay correct, this test extracts the
 * function from the shipped HTML and checks it agrees with ours.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, "../../../apps/demo-pages/agent-console.html");

function extractCanonicalize(): (v: unknown) => string {
  const html = readFileSync(pagePath, "utf8");
  const match = html.match(/function canonicalize\(v\) \{[\s\S]*?\n\}/);
  if (!match) throw new Error("canonicalize() not found in agent-console.html");
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}; return canonicalize;`)() as (v: unknown) => string;
}

const draft: IntentDraft = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, max 1% slippage, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.92 },
  constraints: {
    chainIds: [8453],
    maxSpend: [
      { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "500000000" },
    ],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
    maxSlippageBps: 100,
  },
  createdAt: 1_757_500_000_000,
};

describe("intent — demo page canonicalization parity", () => {
  const pageCanonicalize = extractCanonicalize();

  it("agrees on a full authorization draft", async () => {
    const { canonicalize } = await import("../src/canonical");
    expect(pageCanonicalize(draft)).toBe(canonicalize(draft));
  });

  it("produces a string that hashes to the same authorization hash", async () => {
    const { sha256Hex } = await import("../src/canonical");
    const frozen = await freezeIntent(draft);
    expect(await sha256Hex(pageCanonicalize(draft))).toBe(frozen.hash);
  });

  it("agrees on key ordering", async () => {
    const { canonicalize } = await import("../src/canonical");
    const reordered = { b: 1, a: { d: 2, c: 3 } };
    expect(pageCanonicalize(reordered)).toBe(canonicalize(reordered));
  });

  it("agrees on dropping undefined and keeping null", async () => {
    const { canonicalize } = await import("../src/canonical");
    const v = { a: undefined, b: null, c: [1, undefined] };
    expect(pageCanonicalize(v)).toBe(canonicalize(v));
  });
});
