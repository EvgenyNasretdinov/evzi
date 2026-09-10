# Agent Intent Firewall — Phase 1: `packages/intent`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frozen `AuthorizedIntent` and the deterministic verifier that turns "the agent proposed X" into `ALLOW` / `REQUIRE_APPROVAL` / `REJECT`.

**Architecture:** A new dependency-free package `packages/intent` holds the authorization object, a canonical-JSON hash that proves it was not mutated, a sync constraint verifier that emits existing-shaped `Finding[]`, and a pure `derivePolicy()`. Shared types move into `packages/types` so nothing depends on the still-unwritten Graph package. The judge worker gains one optional field on the wire; every existing test stays green.

**Tech Stack:** TypeScript 5.6 (ESM, `strict`, `noUncheckedIndexedAccess`), vitest 2.1, pnpm 9 workspaces, Web Crypto `crypto.subtle` (present in Node 20, Cloudflare Workers, and MV3 service workers).

**Spec:** `docs/superpowers/specs/2026-09-10-agent-intent-firewall-design.md`

## Global Constraints

- Package name `@intent-check/intent`; branded Evzi publicly, `@intent-check/*` on npm for legacy reasons.
- `packages/types` must stay **runtime-dependency-free** — declare shared interfaces there, never import from sibling packages.
- Every new `Finding` uses the existing shape `{ code, severity, text }` with `severity: "info" | "warn" | "danger"`.
- `text` is user-facing prose shown in the popup checklist: one sentence, name the concrete number or address, no jargon-only strings.
- All amounts are raw integer strings; compare with `BigInt`, never `Number`.
- Addresses are compared lowercased; never assume checksum casing.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit.
- Commits: imperative mood, **no AI co-author trailers** — the repo's convention and the maintainer's explicit instruction.
- Work happens on branch `ethonline-2026`, tagged baseline `pre-ethonline-2026`.

---

### Task 1: Package scaffold, canonical JSON, and hashing

**Files:**
- Create: `packages/intent/package.json`
- Create: `packages/intent/tsconfig.json`
- Create: `packages/intent/src/canonical.ts`
- Create: `packages/intent/src/index.ts`
- Test: `packages/intent/tests/canonical.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canonicalize(value: unknown): string`, `sha256Hex(input: string): Promise<string>`.

- [x] **Step 1: Create the package manifest**

`packages/intent/package.json` — copied from `packages/origin-trust/package.json`, name changed:

```json
{
  "name": "@intent-check/intent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/intent/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

Then run `pnpm install` from the repo root so the workspace picks the package up.

- [x] **Step 2: Write the failing test**

`packages/intent/tests/canonical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canonicalize, sha256Hex } from "../src/canonical";

describe("intent — canonicalize", () => {
  it("sorts object keys so key order cannot change the output", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalize({ x: { d: 1, c: 2 } })).toBe('{"x":{"c":2,"d":1}}');
  });

  it("preserves array order, because order is meaningful", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no incidental whitespace", () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it("drops undefined members so optional fields cannot shift the hash", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("keeps null, which is a real value", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("escapes strings via JSON rules", () => {
    expect(canonicalize({ a: 'q"\n' })).toBe('{"a":"q\\"\\n"}');
  });
});

describe("intent — sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable across calls", async () => {
    expect(await sha256Hex("evzi")).toBe(await sha256Hex("evzi"));
  });
});
```

- [x] **Step 3: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — cannot resolve `../src/canonical`.

- [x] **Step 4: Implement `canonical.ts`**

```ts
/**
 * Deterministic JSON: object keys sorted, no incidental whitespace,
 * `undefined` members dropped. Two structurally equal values always
 * serialize to the same string, so hashing them is meaningful.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("canonicalize: non-finite number");
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

`packages/intent/src/index.ts`:

```ts
export * from "./canonical";
```

- [x] **Step 5: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS, 10 tests.

- [x] **Step 6: Commit**

```bash
git add packages/intent pnpm-lock.yaml
git commit -m "feat(intent): canonical JSON and sha256 for authorization hashing"
```

---

### Task 2: Shared types in `packages/types`

**Files:**
- Modify: `packages/types/src/index.ts` (append; do not reorder existing exports)
- Test: `packages/intent/tests/types.contract.test.ts`

**Interfaces:**
- Consumes: existing `UserIntent`, `Finding`, `SimResult`, `JudgeVerdict`, `JudgeInput`.
- Produces: `IntentConstraints`, `AuthorizedIntent`, `OnchainContext`, `AgentPolicy`, and two additive fields — `JudgeVerdict.policy?`, `JudgeInput.authorization?`, `JudgeInput.onchain?`.

`OnchainContext` lives here rather than in `packages/onchain-context` so that
`packages/intent` can consume it without depending on a package that does not
exist yet. `packages/types` stays runtime-dependency-free.

- [x] **Step 1: Write the failing test**

`packages/intent/tests/types.contract.test.ts` — a compile-time contract check
plus a runtime assertion that optional fields really are optional:

```ts
import { describe, it, expect } from "vitest";
import type {
  AuthorizedIntent,
  IntentConstraints,
  OnchainContext,
  AgentPolicy,
  JudgeVerdict,
} from "@intent-check/types";

describe("intent — shared types", () => {
  it("builds a minimal AuthorizedIntent", () => {
    const constraints: IntentConstraints = {
      chainIds: [8453],
      maxSpend: [{ chainId: 8453, token: "0xaaa", amount: "500000000" }],
      allowedRecipients: [],
      allowUnlimitedApproval: false,
    };
    const intent: AuthorizedIntent = {
      id: "b1",
      raw: "swap at most 500 USDC to ETH on Base",
      goal: { kind: "swap", summary: "swap 500 USDC for ETH", confidence: 0.9 },
      constraints,
      createdAt: 1_757_500_000_000,
      hash: "deadbeef",
    };
    expect(intent.constraints.allowUnlimitedApproval).toBe(false);
    expect(intent.constraints.maxSlippageBps).toBeUndefined();
  });

  it("lets a verdict carry a policy without breaking verdicts that do not", () => {
    const withoutPolicy: JudgeVerdict = {
      tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9,
    };
    const policy: AgentPolicy = "REQUIRE_APPROVAL";
    const withPolicy: JudgeVerdict = { ...withoutPolicy, policy };
    expect(withoutPolicy.policy).toBeUndefined();
    expect(withPolicy.policy).toBe("REQUIRE_APPROVAL");
  });

  it("marks a degraded on-chain context", () => {
    const ctx: OnchainContext = { degraded: true };
    expect(ctx.spender).toBeUndefined();
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — `AuthorizedIntent` is not exported from `@intent-check/types`.

- [x] **Step 3: Append the types**

Append to `packages/types/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Agent intent firewall (ETHOnline 2026).
// ---------------------------------------------------------------------------

/** Machine-readable limits the human agreed to, parsed from their own words. */
export interface IntentConstraints {
  chainIds: number[];
  /** Per-token spend caps. Raw integer strings, same convention as TokenAmount. */
  maxSpend: { chainId: number; token: string; amount: string }[];
  /** Empty means: the user's own wallet is the only acceptable recipient. */
  allowedRecipients: string[];
  allowUnlimitedApproval: boolean;
  maxSlippageBps?: number;
  allowedProtocols?: string[];
  expiresAt?: number;
}

/**
 * A human authorization, frozen at confirmation time. `hash` covers every
 * other field via canonical JSON, so any later mutation is detectable.
 */
export interface AuthorizedIntent {
  id: string;
  raw: string;
  goal: UserIntent;
  constraints: IntentConstraints;
  createdAt: number;
  hash: string;
}

/** Live behavioural data from The Graph. Every field optional: it may degrade. */
export interface OnchainContext {
  spender?: {
    address: string;
    firstSeenDaysAgo?: number;
    distinctInboundSenders48h: number;
    /** 0..1 — share of outflow going to a single address. */
    outboundConcentration: number;
  };
  token?: {
    address: string;
    symbol?: string;
    holders?: number;
    marketCapUsd?: number;
    /** True when the protocol registry vouches for this exact address. */
    canonical: boolean;
  };
  wallet?: {
    address: string;
    totalUsd?: number;
    balances: { token: string; symbol?: string; amount: string; usd?: number }[];
  };
  /** True when any upstream call failed or timed out. */
  degraded: boolean;
}

/** What an agent is permitted to do with a proposal. */
export type AgentPolicy = "ALLOW" | "REQUIRE_APPROVAL" | "REJECT";
```

Then add the additive optional fields. In `JudgeVerdict`, after `confidence`:

```ts
  /** Present when an AuthorizedIntent was supplied. Binding in agent mode,
   *  advisory in the human flow. Derived deterministically — never by the LLM. */
  policy?: AgentPolicy;
```

In `JudgeInput`, after `netEffect`:

```ts
  /** The frozen human authorization an agent is acting under, when there is one. */
  authorization?: AuthorizedIntent;
  /** Live on-chain behavioural context, when available. */
  onchain?: OnchainContext;
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS.

- [x] **Step 5: Verify nothing else broke**

Run: `pnpm test && pnpm typecheck`
Expected: all pre-existing suites PASS. Every added field is optional, so no
existing construction site becomes invalid.

- [x] **Step 6: Commit**

```bash
git add packages/types packages/intent
git commit -m "feat(types): AuthorizedIntent, IntentConstraints, OnchainContext, AgentPolicy"
```

---

### Task 3: Freezing and integrity checking

**Files:**
- Create: `packages/intent/src/freeze.ts`
- Modify: `packages/intent/src/index.ts`
- Test: `packages/intent/tests/freeze.test.ts`

**Interfaces:**
- Consumes: `canonicalize`, `sha256Hex` (Task 1); `AuthorizedIntent`, `Finding` (Task 2).
- Produces: `freezeIntent(draft: IntentDraft): Promise<AuthorizedIntent>`,
  `checkIntegrity(intent: AuthorizedIntent, now?: number): Promise<Finding[]>`,
  and `type IntentDraft = Omit<AuthorizedIntent, "hash">`.

Integrity is async because Web Crypto is async; constraint checking (Task 5)
is sync. Keeping them separate is what lets the constraint verifier stay a
plain pure function.

- [x] **Step 1: Write the failing test**

`packages/intent/tests/freeze.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { freezeIntent, checkIntegrity, type IntentDraft } from "../src/freeze";

const draft: IntentDraft = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, max 1% slippage, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.92 },
  constraints: {
    chainIds: [8453],
    maxSpend: [{ chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "500000000" }],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
    maxSlippageBps: 100,
  },
  createdAt: 1_757_500_000_000,
};

describe("intent — freezeIntent", () => {
  it("produces a 64-char hex hash", async () => {
    const frozen = await freezeIntent(draft);
    expect(frozen.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same content", async () => {
    expect((await freezeIntent(draft)).hash).toBe((await freezeIntent(draft)).hash);
  });

  it("ignores key order in the draft", async () => {
    const reordered: IntentDraft = {
      createdAt: draft.createdAt, goal: draft.goal, raw: draft.raw,
      id: draft.id, constraints: draft.constraints,
    };
    expect((await freezeIntent(reordered)).hash).toBe((await freezeIntent(draft)).hash);
  });

  it("changes when a constraint changes", async () => {
    const loosened: IntentDraft = {
      ...draft,
      constraints: { ...draft.constraints, allowUnlimitedApproval: true },
    };
    expect((await freezeIntent(loosened)).hash).not.toBe((await freezeIntent(draft)).hash);
  });
});

describe("intent — checkIntegrity", () => {
  it("passes an untouched authorization", async () => {
    const frozen = await freezeIntent(draft);
    expect(await checkIntegrity(frozen, draft.createdAt + 1000)).toEqual([]);
  });

  it("flags INTENT_TAMPERED when a constraint was loosened after freezing", async () => {
    const frozen = await freezeIntent(draft);
    const tampered = {
      ...frozen,
      constraints: { ...frozen.constraints, allowUnlimitedApproval: true },
    };
    const findings = await checkIntegrity(tampered, draft.createdAt + 1000);
    expect(findings.map((f) => f.code)).toContain("INTENT_TAMPERED");
    expect(findings[0]?.severity).toBe("danger");
  });

  it("flags INTENT_EXPIRED past the deadline", async () => {
    const frozen = await freezeIntent({
      ...draft,
      constraints: { ...draft.constraints, expiresAt: draft.createdAt + 60_000 },
    });
    const findings = await checkIntegrity(frozen, draft.createdAt + 61_000);
    expect(findings.map((f) => f.code)).toContain("INTENT_EXPIRED");
  });

  it("does not flag expiry before the deadline", async () => {
    const frozen = await freezeIntent({
      ...draft,
      constraints: { ...draft.constraints, expiresAt: draft.createdAt + 60_000 },
    });
    expect(await checkIntegrity(frozen, draft.createdAt + 59_000)).toEqual([]);
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — cannot resolve `../src/freeze`.

- [x] **Step 3: Implement `freeze.ts`**

```ts
import type { AuthorizedIntent, Finding } from "@intent-check/types";
import { canonicalize, sha256Hex } from "./canonical";

/** An authorization before its hash is computed. */
export type IntentDraft = Omit<AuthorizedIntent, "hash">;

/** Freeze a draft: hash every field, so later mutation is detectable. */
export async function freezeIntent(draft: IntentDraft): Promise<AuthorizedIntent> {
  const hash = await sha256Hex(canonicalize(draft));
  return { ...draft, hash };
}

/**
 * Verify an authorization is the one the human confirmed and is still live.
 * Returns findings rather than throwing: the caller merges them into the
 * verdict checklist alongside every other signal.
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
      text: "The authorization was modified after you approved it — the request no longer matches what you agreed to.",
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
```

Update `packages/intent/src/index.ts`:

```ts
export * from "./canonical";
export * from "./freeze";
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS, 8 new tests.

- [x] **Step 5: Commit**

```bash
git add packages/intent
git commit -m "feat(intent): freeze authorizations and detect tampering or expiry"
```

---

### Task 4: Extracting the spend shape from a decoded action

**Files:**
- Create: `packages/intent/src/spend.ts`
- Modify: `packages/intent/src/index.ts`
- Test: `packages/intent/tests/spend.test.ts`

**Interfaces:**
- Consumes: `DecodedAction`, `TokenAmount` (existing types).
- Produces: `extractSpend(decoded: DecodedAction, chainId: number): SpendShape`
  where `SpendShape = { movements: Movement[]; unrecognized: boolean }` and
  `Movement = { token: string; amount: string; recipient?: string; isUnlimited: boolean; kind: "approve" | "transfer" | "swapIn" }`.

One normalizing layer so the constraint verifier does not carry a nine-armed
switch. `swapIn` is the token leaving the wallet in a swap; the token arriving
is not a spend and is deliberately not modelled.

- [x] **Step 1: Write the failing test**

`packages/intent/tests/spend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractSpend, MAX_UINT256 } from "../src/spend";
import type { DecodedAction } from "@intent-check/types";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("intent — extractSpend", () => {
  it("reads an unlimited approval", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: "0xdead", amount: MAX_UINT256, isUnlimited: true,
    };
    const { movements, unrecognized } = extractSpend(decoded, 8453);
    expect(unrecognized).toBe(false);
    expect(movements).toEqual([
      { token: USDC, amount: MAX_UINT256, recipient: "0xdead", isUnlimited: true, kind: "approve" },
    ]);
  });

  it("lowercases addresses so comparisons cannot miss on casing", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC.toUpperCase(), spender: "0xDeAd", amount: "500", isUnlimited: false,
    };
    expect(extractSpend(decoded, 8453).movements[0]).toMatchObject({
      token: USDC, recipient: "0xdead",
    });
  });

  it("reads a plain transfer", () => {
    const decoded: DecodedAction = { kind: "transfer", token: USDC, to: "0xbob", amount: "1000000" };
    expect(extractSpend(decoded, 8453).movements).toEqual([
      { token: USDC, amount: "1000000", recipient: "0xbob", isUnlimited: false, kind: "transfer" },
    ]);
  });

  it("reads the inbound leg of a swap and its recipient", () => {
    const decoded: DecodedAction = {
      kind: "swap",
      tokenIn: { chainId: 8453, address: USDC, amount: "500000000" },
      tokenOut: { chainId: 8453, address: "ETH", amount: "0" },
      minAmountOut: "0", recipient: "0xme", router: "0xr", protocol: "Uniswap",
    };
    expect(extractSpend(decoded, 8453).movements).toEqual([
      { token: USDC, amount: "500000000", recipient: "0xme", isUnlimited: false, kind: "swapIn" },
    ]);
  });

  it("treats every permitted token in a Permit2 batch as a movement", () => {
    const decoded: DecodedAction = {
      kind: "permit2Transfer",
      permitted: [
        { chainId: 8453, address: USDC, amount: "1" },
        { chainId: 8453, address: "0xweth", amount: "2" },
      ],
      spender: "0xdrainer", deadline: "0",
    };
    const { movements } = extractSpend(decoded, 8453);
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.recipient === "0xdrainer")).toBe(true);
  });

  it("treats setApprovalForAll(true) as unlimited", () => {
    const decoded: DecodedAction = {
      kind: "setApprovalForAll", collection: "0xnft", operator: "0xop", approved: true,
    };
    expect(extractSpend(decoded, 8453).movements[0]).toMatchObject({
      isUnlimited: true, kind: "approve", recipient: "0xop",
    });
  });

  it("ignores setApprovalForAll(false), which grants nothing", () => {
    const decoded: DecodedAction = {
      kind: "setApprovalForAll", collection: "0xnft", operator: "0xop", approved: false,
    };
    expect(extractSpend(decoded, 8453).movements).toEqual([]);
  });

  it("marks unknown calldata as unrecognized rather than guessing it is safe", () => {
    const decoded: DecodedAction = { kind: "unknown", selector: "0x12345678" };
    expect(extractSpend(decoded, 8453)).toEqual({ movements: [], unrecognized: true });
  });

  it("marks a generic decoded call as unrecognized for spend purposes", () => {
    const decoded: DecodedAction = {
      kind: "generic", functionName: "doThing", signature: "doThing()",
      target: "0xt", args: [], trusted: false,
    };
    expect(extractSpend(decoded, 8453).unrecognized).toBe(true);
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — cannot resolve `../src/spend`.

- [x] **Step 3: Implement `spend.ts`**

```ts
import type { DecodedAction } from "@intent-check/types";

export const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export interface Movement {
  token: string;
  amount: string;
  recipient?: string;
  isUnlimited: boolean;
  kind: "approve" | "transfer" | "swapIn";
}

export interface SpendShape {
  movements: Movement[];
  /** True when we cannot tell what leaves the wallet — never treat as "nothing leaves". */
  unrecognized: boolean;
}

const lc = (s: string | undefined): string | undefined => s?.toLowerCase();

export function extractSpend(decoded: DecodedAction, chainId: number): SpendShape {
  switch (decoded.kind) {
    case "approve":
      return {
        unrecognized: false,
        movements: [{
          token: decoded.token.toLowerCase(),
          amount: decoded.amount,
          recipient: lc(decoded.spender),
          isUnlimited: decoded.isUnlimited,
          kind: "approve",
        }],
      };

    case "setApprovalForAll":
      return {
        unrecognized: false,
        movements: decoded.approved
          ? [{
              token: decoded.collection.toLowerCase(),
              amount: MAX_UINT256,
              recipient: lc(decoded.operator),
              isUnlimited: true,
              kind: "approve",
            }]
          : [],
      };

    case "permit":
      return {
        unrecognized: false,
        movements: [{
          token: decoded.token.toLowerCase(),
          amount: decoded.amount,
          recipient: lc(decoded.spender),
          isUnlimited: decoded.amount === MAX_UINT256,
          kind: "approve",
        }],
      };

    case "permit2Transfer":
      return {
        unrecognized: false,
        movements: decoded.permitted.map((p) => ({
          token: p.address.toLowerCase(),
          amount: p.amount,
          recipient: lc(decoded.spender),
          isUnlimited: p.amount === MAX_UINT256,
          kind: "approve" as const,
        })),
      };

    case "transfer":
      return {
        unrecognized: false,
        movements: [{
          token: decoded.token.toLowerCase(),
          amount: decoded.amount,
          recipient: lc(decoded.to),
          isUnlimited: false,
          kind: "transfer",
        }],
      };

    case "swap":
      return {
        unrecognized: false,
        movements: [{
          token: decoded.tokenIn.address.toLowerCase(),
          amount: decoded.tokenIn.amount,
          recipient: lc(decoded.recipient),
          isUnlimited: false,
          kind: "swapIn",
        }],
      };

    case "lendingAction":
      return {
        unrecognized: false,
        movements: decoded.verb === "supply" || decoded.verb === "repay"
          ? [{
              token: decoded.asset.toLowerCase(),
              amount: decoded.amount,
              recipient: lc(decoded.onBehalfOf ?? decoded.pool),
              isUnlimited: false,
              kind: "transfer",
            }]
          : [],
      };

    case "seaportOrder":
      return {
        unrecognized: false,
        movements: decoded.offer.map((o) => ({
          token: o.address.toLowerCase(),
          amount: o.amount,
          recipient: lc(decoded.offerer),
          isUnlimited: false,
          kind: "transfer" as const,
        })),
      };

    case "generic":
    case "unknown":
      return { movements: [], unrecognized: true };
  }
}
```

Update `packages/intent/src/index.ts` to also `export * from "./spend";`.

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS, 9 new tests.

- [x] **Step 5: Commit**

```bash
git add packages/intent
git commit -m "feat(intent): normalize decoded actions into a spend shape"
```

---

### Task 5: The constraint verifier

**Files:**
- Create: `packages/intent/src/verify.ts`
- Modify: `packages/intent/src/index.ts`
- Test: `packages/intent/tests/verify.test.ts`

**Interfaces:**
- Consumes: `extractSpend`, `MAX_UINT256` (Task 4); `AuthorizedIntent`, `OnchainContext`, `Finding`, `DecodedAction`, `SimResult` (Task 2).
- Produces: `verifyAgainstIntent(intent: AuthorizedIntent, decoded: DecodedAction, ctx: VerifyContext): Finding[]`
  where `VerifyContext = { chainId: number; wallet: string; onchain?: OnchainContext; sim?: SimResult }`.

Sync and pure. `wallet` is required because "no explicit recipients" means
"the user's own wallet", which cannot be evaluated without knowing it.

- [x] **Step 1: Write the failing test**

`packages/intent/tests/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyAgainstIntent, type VerifyContext } from "../src/verify";
import { MAX_UINT256 } from "../src/spend";
import type { AuthorizedIntent, DecodedAction } from "@intent-check/types";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x1111111111111111111111111111111111111111";

const intent: AuthorizedIntent = {
  id: "01J8",
  raw: "Swap at most 500 USDC to ETH on Base, no unlimited approvals",
  goal: { kind: "swap", summary: "swap 500 USDC for ETH on Base", confidence: 0.9 },
  constraints: {
    chainIds: [8453],
    maxSpend: [{ chainId: 8453, token: USDC, amount: "500000000" }],
    allowedRecipients: [],
    allowUnlimitedApproval: false,
  },
  createdAt: 1_757_500_000_000,
  hash: "f".repeat(64),
};

const ctx: VerifyContext = { chainId: 8453, wallet: WALLET };
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("intent — verifyAgainstIntent", () => {
  it("passes a swap that stays inside every constraint", () => {
    const decoded: DecodedAction = {
      kind: "swap",
      tokenIn: { chainId: 8453, address: USDC, amount: "500000000" },
      tokenOut: { chainId: 8453, address: "ETH", amount: "0" },
      minAmountOut: "0", recipient: WALLET, router: "0xr", protocol: "Uniswap",
    };
    expect(verifyAgainstIntent(intent, decoded, ctx)).toEqual([]);
  });

  it("rejects an unlimited approval the human forbade", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: "0xdead", amount: MAX_UINT256, isUnlimited: true,
    };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_UNLIMITED_APPROVAL_FORBIDDEN");
    expect(findings.every((f) => f.severity === "danger")).toBe(true);
  });

  it("allows an unlimited approval when the human explicitly permitted it", () => {
    const permissive: AuthorizedIntent = {
      ...intent,
      constraints: { ...intent.constraints, allowUnlimitedApproval: true },
    };
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: WALLET, amount: MAX_UINT256, isUnlimited: true,
    };
    expect(codes(verifyAgainstIntent(permissive, decoded, ctx)))
      .not.toContain("INTENT_UNLIMITED_APPROVAL_FORBIDDEN");
  });

  it("rejects a spend above the cap and names both numbers", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: WALLET, amount: "600000000", isUnlimited: false,
    };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_AMOUNT_EXCEEDED");
    expect(findings[0]?.text).toMatch(/600|500/);
  });

  it("accepts a spend exactly at the cap", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: WALLET, amount: "500000000", isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx)))
      .not.toContain("INTENT_AMOUNT_EXCEEDED");
  });

  it("rejects a chain the authorization never mentioned", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: USDC, spender: WALLET, amount: "1", isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, { ...ctx, chainId: 1 })))
      .toContain("INTENT_CHAIN_MISMATCH");
  });

  it("rejects a third-party recipient when only the user's wallet is allowed", () => {
    const decoded: DecodedAction = {
      kind: "transfer", token: USDC, to: "0xbob", amount: "1",
    };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx)))
      .toContain("INTENT_RECIPIENT_NOT_ALLOWED");
  });

  it("accepts a recipient the human listed explicitly", () => {
    const withRecipient: AuthorizedIntent = {
      ...intent,
      constraints: { ...intent.constraints, allowedRecipients: ["0xBOB"] },
    };
    const decoded: DecodedAction = { kind: "transfer", token: USDC, to: "0xbob", amount: "1" };
    expect(codes(verifyAgainstIntent(withRecipient, decoded, ctx)))
      .not.toContain("INTENT_RECIPIENT_NOT_ALLOWED");
  });

  it("rejects a token the authorization never named", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: "0xother", spender: WALLET, amount: "1", isUnlimited: false,
    };
    expect(codes(verifyAgainstIntent(intent, decoded, ctx)))
      .toContain("INTENT_TOKEN_MISMATCH");
  });

  it("warns rather than rejects when the calldata could not be decoded", () => {
    const decoded: DecodedAction = { kind: "unknown", selector: "0x12345678" };
    const findings = verifyAgainstIntent(intent, decoded, ctx);
    expect(codes(findings)).toContain("INTENT_UNVERIFIABLE");
    expect(findings[0]?.severity).toBe("warn");
  });

  it("reports every violation at once, not just the first", () => {
    const decoded: DecodedAction = {
      kind: "approve", token: "0xother", spender: "0xdead", amount: MAX_UINT256, isUnlimited: true,
    };
    const found = codes(verifyAgainstIntent(intent, decoded, { ...ctx, chainId: 1 }));
    expect(found).toContain("INTENT_CHAIN_MISMATCH");
    expect(found).toContain("INTENT_UNLIMITED_APPROVAL_FORBIDDEN");
    expect(found).toContain("INTENT_TOKEN_MISMATCH");
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — cannot resolve `../src/verify`.

- [x] **Step 3: Implement `verify.ts`**

```ts
import type {
  AuthorizedIntent, DecodedAction, Finding, OnchainContext, SimResult,
} from "@intent-check/types";
import { extractSpend } from "./spend";

export interface VerifyContext {
  chainId: number;
  /** The user's own wallet — the implicit recipient when none are listed. */
  wallet: string;
  onchain?: OnchainContext;
  sim?: SimResult;
}

const danger = (code: string, text: string): Finding => ({ code, severity: "danger", text });

export function verifyAgainstIntent(
  intent: AuthorizedIntent,
  decoded: DecodedAction,
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  const { constraints } = intent;
  const wallet = ctx.wallet.toLowerCase();

  if (!constraints.chainIds.includes(ctx.chainId)) {
    findings.push(danger(
      "INTENT_CHAIN_MISMATCH",
      `This runs on chain ${ctx.chainId}, but you authorized only ${constraints.chainIds.join(", ")}.`,
    ));
  }

  const { movements, unrecognized } = extractSpend(decoded, ctx.chainId);

  if (unrecognized) {
    findings.push({
      code: "INTENT_UNVERIFIABLE",
      severity: "warn",
      text: "This call could not be decoded, so it cannot be checked against your authorization.",
    });
  }

  const allowed = new Set(constraints.allowedRecipients.map((r) => r.toLowerCase()));

  for (const m of movements) {
    if (m.isUnlimited && !constraints.allowUnlimitedApproval) {
      findings.push(danger(
        "INTENT_UNLIMITED_APPROVAL_FORBIDDEN",
        `This grants unlimited access to your ${m.token.slice(0, 10)}…, but you ruled out unlimited approvals.`,
      ));
    }

    const cap = constraints.maxSpend.find(
      (c) => c.chainId === ctx.chainId && c.token.toLowerCase() === m.token,
    );

    if (!cap) {
      findings.push(danger(
        "INTENT_TOKEN_MISMATCH",
        `This moves ${m.token.slice(0, 10)}…, which your authorization never mentioned.`,
      ));
    } else if (!m.isUnlimited && BigInt(m.amount) > BigInt(cap.amount)) {
      findings.push(danger(
        "INTENT_AMOUNT_EXCEEDED",
        `This spends ${m.amount}, above the ${cap.amount} you authorized.`,
      ));
    }

    const to = m.recipient;
    // An empty allow-list means "my own wallet only", and Set.has on an empty
    // set is already false — no special case needed. The swapIn carve-out
    // exists because a router legitimately appears as the recipient mid-swap.
    const isThirdParty = to !== undefined && to !== wallet && !allowed.has(to);
    const routerLegOk = allowed.size === 0 && m.kind === "swapIn";
    if (isThirdParty && !routerLegOk) {
      findings.push(danger(
        "INTENT_RECIPIENT_NOT_ALLOWED",
        `This sends to ${to.slice(0, 10)}…, which is neither your wallet nor a recipient you approved.`,
      ));
    }
  }

  return findings;
}
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS, 11 new tests. If the "clean swap" case fails because the
router is the recipient, that is the `swapIn` carve-out doing its job —
confirm the recipient in the fixture is `WALLET`.

- [x] **Step 5: Commit**

```bash
git add packages/intent
git commit -m "feat(intent): verify proposals against frozen constraints"
```

---

### Task 6: Policy derivation

**Files:**
- Create: `packages/intent/src/policy.ts`
- Modify: `packages/intent/src/index.ts`
- Test: `packages/intent/tests/policy.test.ts`

**Interfaces:**
- Consumes: `Finding`, `VerdictTier`, `AgentPolicy`, `OnchainContext` (Task 2).
- Produces: `derivePolicy(findings: Finding[], tier: VerdictTier, opts?: { onchain?: OnchainContext }): AgentPolicy`.

Pure, total, and deliberately unreachable from the LLM — the same property the
existing safety floor has.

- [x] **Step 1: Write the failing test**

`packages/intent/tests/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivePolicy } from "../src/policy";
import type { Finding } from "@intent-check/types";

const f = (code: string, severity: Finding["severity"]): Finding => ({ code, severity, text: code });

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
    expect(derivePolicy([f("UNLIMITED_APPROVAL_PRESENT", "info")], "SAFE", {
      onchain: { degraded: true },
    })).toBe("REQUIRE_APPROVAL");
  });

  it("allows the same case once context is healthy", () => {
    expect(derivePolicy([f("UNLIMITED_APPROVAL_PRESENT", "info")], "SAFE", {
      onchain: { degraded: false },
    })).toBe("ALLOW");
  });

  it("prefers the strictest outcome when signals disagree", () => {
    expect(derivePolicy(
      [f("SOMETHING", "warn"), f("INTENT_CHAIN_MISMATCH", "danger")], "CAUTION",
    )).toBe("REJECT");
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/intent test`
Expected: FAIL — cannot resolve `../src/policy`.

- [x] **Step 3: Implement `policy.ts`**

```ts
import type { AgentPolicy, Finding, OnchainContext, VerdictTier } from "@intent-check/types";

/**
 * Turn findings plus a tier into what an agent may do. Pure and total.
 *
 * Runs AFTER applySafetyFloor, and is never exposed to the model: the LLM can
 * explain a decision but must not be able to loosen one.
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

  // A missing exposure figure is not evidence of safety.
  const unlimited = findings.some((f) => f.code.includes("UNLIMITED"));
  if (unlimited && opts.onchain?.degraded) return "REQUIRE_APPROVAL";

  return "ALLOW";
}
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @intent-check/intent test`
Expected: PASS, 10 new tests.

- [x] **Step 5: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: every pre-existing suite still PASS.

- [x] **Step 6: Commit**

```bash
git add packages/intent
git commit -m "feat(intent): derive ALLOW/REQUIRE_APPROVAL/REJECT from findings"
```

---

### Task 7: Wire policy into the judge

**Files:**
- Modify: `apps/judge/src/judge.ts`
- Modify: `apps/judge/package.json` (add `@intent-check/intent` dependency)
- Test: `apps/judge/tests/policy.integration.test.ts`

**Interfaces:**
- Consumes: `derivePolicy` (Task 6), existing `applySafetyFloor`.
- Produces: `/judge` responses carrying `policy` whenever `JudgeInput.authorization` is present.

- [x] **Step 1: Add the workspace dependency**

In `apps/judge/package.json`, add to `dependencies` (create the block if absent):

```json
"@intent-check/intent": "workspace:*"
```

Run `pnpm install` from the repo root.

- [x] **Step 2: Write the failing test**

`apps/judge/tests/policy.integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivePolicy } from "@intent-check/intent";
import type { Finding } from "@intent-check/types";

describe("judge — policy attachment", () => {
  it("re-exports a working derivePolicy across the package boundary", () => {
    const findings: Finding[] = [
      { code: "INTENT_AMOUNT_EXCEEDED", severity: "danger", text: "over cap" },
    ];
    expect(derivePolicy(findings, "SAFE")).toBe("REJECT");
  });
});
```

- [x] **Step 3: Run the test and verify it fails**

Run: `pnpm --filter @intent-check/judge test`
Expected: FAIL — cannot resolve `@intent-check/intent`.

- [x] **Step 4: Attach the policy in `judge.ts`**

Locate where the handler returns the verdict after `applySafetyFloor`. Add
the import at the top:

```ts
import { derivePolicy } from "@intent-check/intent";
```

Then, immediately before the verdict is returned, replace the returned object
with one that carries the policy. `policy` is attached only when an
authorization was supplied, keeping the human flow byte-identical:

```ts
const floored = applySafetyFloor(verdict, input);
const withPolicy = input.authorization
  ? { ...floored, policy: derivePolicy(input.findings, floored.tier, { onchain: input.onchain }) }
  : floored;
return withPolicy;
```

- [x] **Step 5: Run the tests and verify they pass**

Run: `pnpm --filter @intent-check/judge test`
Expected: PASS, including every pre-existing judge test — the human path
produces no `policy` field and its golden fixtures are unchanged.

- [x] **Step 6: Run the full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [x] **Step 7: Commit**

```bash
git add apps/judge pnpm-lock.yaml
git commit -m "feat(judge): attach agent policy when an authorization is present"
```

---

## Phase 1 done — what exists now

`packages/intent` verifies any decoded action against a frozen human
authorization and reduces the result to a policy the agent must obey; the
judge returns that policy on the wire. ~48 new tests. No external service is
required, so none of this can be blocked by a missing API key.

## Later phases

Each gets its own plan document, written when its inputs are unblocked.

- **Phase 2 — `packages/onchain-context`.** JWT obtained and accepted.
  **The Token API upstream is down as of 2026-09-10** — `api.pinax.network`
  answers `401` without the token and `500 bad_gateway` with it on every
  `/v1/evm/*` path including `/v1/evm/networks`; `token-api.thegraph.com`
  resolves but refuses connections. Free tier, once it returns: 200 req/min,
  10 items per response, which caps funnel analysis at ~10 pages.

  Therefore Phase 2 is built behind a `GraphProvider` interface with two
  implementations: `tokenApi` (preferred) and `subgraph` (verified working
  today against `gateway.thegraph.com`, block 25947088, using the
  `1732553a…` gateway key). Whichever provider is alive powers the demo, and
  supporting both is itself a stronger Graph submission than either alone.
  Three fetchers, three findings, recorded HTTP fixtures, 3s timeout with
  `degraded` fallback.
- **Phase 3 — agent console + `/agent/plan` + `/verify`.** The demo path and
  the Bazantic surface.
- **Phase 4 — `apps/ledger-signer`.** DMK over node-HID; Nano S signs plain
  transactions only.
- **Phase 5 — submission.** `HACKATHON.md`, `FEEDBACK.md`, README, demo video.
