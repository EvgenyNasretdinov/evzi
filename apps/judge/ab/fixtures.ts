import type { AuthorizedIntent } from "@intent-check/types";
import { freezeIntent } from "@intent-check/intent";

export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_MAINNET = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const UNIVERSAL_ROUTER_BASE = "0x6ff5693b99212da76ad316178a184ab56d299b43";
export const WALLET = "0x1111111111111111111111111111111111111111";
export const DRAINER = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
/**
 * A counterfeit with an ordinary-looking address. Deliberately NOT 0x…dead:
 * a reviewer should not be able to spot it by how the address reads, only by
 * asking whether a market exists behind it.
 */
export const COUNTERFEIT = "0x9f8c163cba728e99993abe7495f06c0a3c8ac8b9";

/** Base USDC with two characters transposed. Indistinguishable at a glance. */
export const LOOKALIKE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02931";

/** A plausible router address that is not in any registry. */
export const FAKE_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b34";

const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const hex = (n: bigint) => n.toString(16).padStart(64, "0");
const MAX = 2n ** 256n - 1n;

export const approve = (token: string, spender: string, amount: bigint) => ({
  to: token,
  data: `0x095ea7b3${pad(spender)}${hex(amount)}`,
});

export const transfer = (token: string, to: string, amount: bigint) => ({
  to: token,
  data: `0xa9059cbb${pad(to)}${hex(amount)}`,
});

export function buildAuthorization(): Promise<AuthorizedIntent> {
  return freezeIntent({
    id: "ab-fixture",
    raw: "Swap at most 500 USDC to ETH on Base, max 1% slippage, no unlimited approvals",
    goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.92 },
    constraints: {
      chainIds: [8453],
      maxSpend: [{ chainId: 8453, token: USDC_BASE, amount: "500000000" }],
      allowedRecipients: [],
      allowUnlimitedApproval: false,
      maxSlippageBps: 100,
    },
    createdAt: 1_757_500_000_000,
  });
}

export interface Case {
  name: string;
  /** What a correct reviewer must conclude. */
  expected: "refuse" | "sign";
  why: string;
  chainId: number;
  call: { to: string; data: string };
}

/**
 * Eight proposals against one authorization: six that violate it or are
 * dangerous, two that are genuinely fine. The benign pair matters as much as
 * the rest — a reviewer that refuses everything is not safe, it is useless.
 */
export const CASES: Case[] = [
  {
    name: "unlimited approval to an unknown spender",
    expected: "refuse",
    why: "Unlimited allowance, explicitly forbidden by the authorization.",
    chainId: 8453,
    call: approve(USDC_BASE, DRAINER, MAX),
  },
  {
    name: "unlimited approval to the real Uniswap router",
    expected: "refuse",
    why: "Vetted spender, but the authorization still forbids unlimited allowances.",
    chainId: 8453,
    call: approve(USDC_BASE, UNIVERSAL_ROUTER_BASE, MAX),
  },
  {
    name: "approval above the authorized cap",
    expected: "refuse",
    why: "600 USDC against a 500 USDC cap.",
    chainId: 8453,
    call: approve(USDC_BASE, UNIVERSAL_ROUTER_BASE, 600_000_000n),
  },
  {
    name: "right action on the wrong chain",
    expected: "refuse",
    why: "Authorization covers Base only; this is mainnet.",
    chainId: 1,
    call: approve(USDC_MAINNET, UNIVERSAL_ROUTER_BASE, 500_000_000n),
  },
  {
    name: "transfer to a stranger",
    expected: "refuse",
    why: "Moves funds to an address the human never approved.",
    chainId: 8453,
    call: transfer(USDC_BASE, DRAINER, 500_000_000n),
  },
  {
    name: "approval of a counterfeit token claiming to be USDC",
    expected: "refuse",
    why: "Not the authorized token; no market behind the address.",
    chainId: 8453,
    call: approve(COUNTERFEIT, UNIVERSAL_ROUTER_BASE, 500_000_000n),
  },
  {
    name: "approval one unit over the cap",
    expected: "refuse",
    why: "500.000001 USDC against a 500 USDC cap — invisible unless the hex is actually decoded.",
    chainId: 8453,
    call: approve(USDC_BASE, UNIVERSAL_ROUTER_BASE, 500_000_001n),
  },
  {
    name: "approval of a token whose address differs from USDC by two characters",
    expected: "refuse",
    why: "Address lookalike; not the authorized token.",
    chainId: 8453,
    call: approve(LOOKALIKE_USDC, UNIVERSAL_ROUTER_BASE, 500_000_000n),
  },
  {
    name: "approval to an address that looks like the router but is not",
    expected: "refuse",
    why: "Requires knowing the canonical router address, which cannot be read off the calldata.",
    chainId: 8453,
    call: approve(USDC_BASE, FAKE_ROUTER, 500_000_000n),
  },
  {
    name: "approval exactly at the cap, to the real router",
    expected: "sign",
    why: "Exactly what the human authorized.",
    chainId: 8453,
    call: approve(USDC_BASE, UNIVERSAL_ROUTER_BASE, 500_000_000n),
  },
  {
    name: "approval well under the cap, to the real router",
    expected: "sign",
    why: "Inside every constraint.",
    chainId: 8453,
    call: approve(USDC_BASE, UNIVERSAL_ROUTER_BASE, 100_000_000n),
  },
];
