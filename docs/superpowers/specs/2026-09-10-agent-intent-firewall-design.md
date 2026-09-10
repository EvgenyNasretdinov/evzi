# Evzi as an Intent Firewall for AI Agents — Design

**Date:** 2026-09-10
**Status:** Draft for implementation planning
**Context:** ETHOnline 2026, Continuity track. Submission deadline
Sunday 2026-09-13, 12:00 EDT.

## Summary

Evzi today answers one question: *does this wallet request match what the
dApp claims it does?* This design extends it to a second, harder question:
*does this agent-proposed action still match what the human actually
authorized?*

The user states a goal in natural language once. Evzi freezes it into an
`AuthorizedIntent` — a hashed, immutable object carrying machine-readable
constraints. An AI agent then proposes one or more on-chain actions to
satisfy that goal. Every proposal is verified against the frozen
authorization, against live on-chain behavioural data from The Graph, and
against the existing deterministic checks. The verifier emits a policy
decision: `ALLOW` / `REQUIRE_APPROVAL` / `REJECT`.

The differentiator is not agent orchestration. It is **independent
verification**: the component that checks the agent is not the agent, does
not share its context, and cannot be argued with by it.

## What is pre-existing vs new

Continuity judging requires this boundary to be explicit.

**Pre-existing (May 2026, 76 commits, ~8.1k lines TS):** MV3 extension
(`inpage.js` provider hook, content-script bridge, background orchestrator,
React popup), Hono judge worker (`/judge`, `/infer-intent`, `/chat`, safety
floor + trust ceiling), and the packages `decoder`, `protocol-registry`,
`origin-trust`, `sourcify-client`, `tenderly-client`, `token-metadata`,
`types`. Roughly 100 tests.

**New during ETHOnline 2026:** `packages/intent`,
`packages/onchain-context`, `apps/ledger-signer`, the agent console demo
page, judge routes `/verify` and `/agent/plan`, the `policy` field on
`JudgeVerdict`, and the Bazantic MCP gateway + recipes.

The repository has no `main` branch; `intent-check-mvp` is the de-facto
trunk and is in sync with origin. The boundary is therefore drawn with an
annotated tag on the last May commit (`5360023`):

```
pre-ethonline-2026   →  everything before it is the May 2026 hackathon
ethonline-2026       →  branch holding every commit made during this event
```

`git diff pre-ethonline-2026..HEAD` is exactly the new work, which is the
line the submission points judges at.

## Goals and non-goals

**Goals.**

1. A human authorization that is immutable and verifiable after the fact.
2. A verifier that rejects constraint violations without model discretion.
3. Live on-chain behavioural data as a load-bearing verdict input.
4. Hardware confirmation for anything that needs a human.
5. The verifier callable by third-party agents as a plain HTTP API.

**Non-goals.** A general autonomous DeFi agent. Multi-step planning or
orchestration frameworks. Any new chain beyond mainnet + Base. Replacing
the existing human-facing popup flow — it is reused, not sidelined.

## Architecture

The agent runs **in the demo page**, so its proposals enter through the
existing `window.ethereum` hook. No new transport between agent and
extension is built.

```
   apps/demo-pages/agent-console.html
     │  user types goal ──────────────► POST /agent/plan (judge worker)
     │                                    └─ LLM + Uniswap Trading API
     │  ◄──────────────────────────────── proposed calls[]
     │
     └─ window.ethereum.request(eth_sendTransaction)
          │
          └─ inpage.js  ────────── EXISTING, unchanged ──────────┐
                                                                 ▼
   background.ts (existing orchestrator, extended)
     1-9.  existing: decode, registry, sourcify, simulate, origin
     10.   NEW  fetchOnchainContext()   → packages/onchain-context
     11.   NEW  verifyAgainstIntent()   → packages/intent
     12.   POST /judge  { …, intent: AuthorizedIntent, onchain }
                                                                 ▼
   apps/judge — LLM verdict, then applySafetyFloor, then derivePolicy()
                                                                 ▼
   popup (existing screens + authorization banner)
     policy=REJECT           → blocked, agent told no
     policy=REQUIRE_APPROVAL → human confirms
     policy=ALLOW            → proceeds
                                                                 ▼
   apps/ledger-signer (localhost:8787) → DMK/HID → Nano S → signature
```

### `packages/intent` — the frozen authorization

```ts
export interface AuthorizedIntent {
  id: string;            // uuid
  raw: string;           // the user's exact words
  goal: UserIntent;      // existing type, reused
  constraints: IntentConstraints;
  createdAt: number;
  hash: string;          // sha256 over canonical JSON of everything above
}

export interface IntentConstraints {
  chainIds: number[];
  maxSpend: { chainId: number; token: string; amount: string }[];
  allowedRecipients: string[];      // empty ⇒ user's own wallet only
  allowUnlimitedApproval: boolean;  // default false
  maxSlippageBps?: number;
  allowedProtocols?: string[];
  expiresAt?: number;
}
```

The hash is computed once, when the human confirms, and recomputed on every
subsequent proposal. A mismatch is itself a violation
(`INTENT_TAMPERED`). The popup shows the first 8 hex chars as
`authorization #a3f9c1`, which makes immutability a demonstrable property
rather than a claim in the pitch.

Constraints are produced by an LLM parse of `raw` (reusing the
`/infer-intent` pattern) and are **shown to the human for confirmation
before freezing**. The model proposes constraints; it never gets to change
them afterwards.

### Verification

```ts
verifyAgainstIntent(
  intent: AuthorizedIntent,
  decoded: DecodedAction,
  onchain: OnchainContext,
  sim?: SimResult,
): Finding[]
```

New finding codes, all `severity: "danger"` except where noted:

| Code | Fires when |
|---|---|
| `INTENT_TAMPERED` | recomputed hash ≠ stored hash |
| `INTENT_EXPIRED` | `expiresAt` passed |
| `INTENT_CHAIN_MISMATCH` | tx chain ∉ `constraints.chainIds` |
| `INTENT_AMOUNT_EXCEEDED` | spend > matching `maxSpend` cap |
| `INTENT_UNLIMITED_APPROVAL_FORBIDDEN` | unlimited approve while `allowUnlimitedApproval === false` |
| `INTENT_RECIPIENT_NOT_ALLOWED` | recipient ∉ allowed set and ≠ user wallet |
| `INTENT_TOKEN_MISMATCH` | asset not named in the goal |
| `INTENT_PROTOCOL_NOT_ALLOWED` | target protocol ∉ `allowedProtocols` (warn) |

### Policy derivation

`JudgeVerdict` gains one field:

```ts
policy: "ALLOW" | "REQUIRE_APPROVAL" | "REJECT";
```

`derivePolicy(findings, tier)` runs **after** `applySafetyFloor`, is pure,
and is not reachable by the LLM:

- any `INTENT_*` danger finding → `REJECT`
- any other danger finding, or `tier === "DANGER"` → `REJECT`
- `tier === "CAUTION"`, or any warn finding → `REQUIRE_APPROVAL`
- `degraded` on-chain context combined with an unlimited approval →
  `REQUIRE_APPROVAL` (never `ALLOW`: the exposure figure that would have
  justified caution is missing)
- otherwise → `ALLOW`

This mirrors the existing safety-floor property — the model can explain a
decision but cannot loosen it.

**Agent mode vs human mode.** `policy` binds only when an
`AuthorizedIntent` is present, i.e. an agent is acting on the human's
behalf. There, `REJECT` is returned to the agent as a refusal and is not
human-overridable: clicking through a constraint the human set minutes ago
defeats the point of having set it.

When no `AuthorizedIntent` is present — the pre-existing flow, a person
clicking a dApp themselves — `policy` is **advisory**. The popup keeps its
current behaviour, including "sign anyway" on `DANGER`. Nobody gets locked
out of their own wallet by a verdict they disagree with, and the ~100
existing tests keep their current expectations.

### `packages/onchain-context` — The Graph

Base URL `https://api.pinax.network/v1/evm`, `Authorization: Bearer <JWT>`.
The JWT is issued from a key at [thegraph.market](https://thegraph.market)
(free tier: 100 req/s). A Graph Network gateway key is **not** accepted by
this API — verified 2026-09-10, returns `401` regardless of header.

Three calls, three findings, each of which changes a verdict:

| Function | Endpoint | Finding | Effect |
|---|---|---|---|
| `fetchSpenderProfile()` | `/transfers` | `GRAPH_SPENDER_FUNNEL` | CAUTION "unknown spender" → **DANGER** "412 wallets sent tokens here in 48h, all forwarded to one address" |
| `fetchTokenReputation()` | `/tokens`, `/holders` | `GRAPH_TOKEN_IMPERSONATION` | SAFE "approve USDC" → **DANGER** "this 'USDC' has 12 holders" |
| `fetchWalletBalances()` | `/balances` | `GRAPH_EXPOSURE_USD` | "approve MAX_UINT256" → "**puts $12,400 at risk**"; also grounds `maxSpend` caps in real holdings |

Shape:

```ts
export interface OnchainContext {
  spender?: { address: string; firstSeenDaysAgo?: number;
              distinctInboundSenders48h: number;
              outboundConcentration: number; };  // 0..1
  token?:   { address: string; symbol?: string; holders?: number;
              marketCapUsd?: number; canonical: boolean; };
  wallet?:  { address: string; totalUsd?: number;
              balances: { token: string; symbol?: string;
                          amount: string; usd?: number }[]; };
  degraded: boolean;    // true when any call failed or timed out
}
```

`OnchainContext` is attached to `JudgeInput` so the LLM reasons over it too
— The Graph's criterion is "do meaningful work with the data", not merely
fetch it.

**Failure policy.** All Graph calls run in parallel with a 3s timeout. On
failure `degraded = true`, the Graph findings are omitted, and the pipeline
proceeds. A data-source outage must never block a verdict — but a degraded
verdict never returns `ALLOW` for an unlimited approval, since the exposure
figure that would have justified caution is missing.

**Caching.** In-memory TTL keyed by `chainId:address` — 60s for balances,
600s for token reputation and spender profiles. Keeps the demo responsive
and well under the rate limit.

### `apps/ledger-signer` — hardware confirmation

A local Node daemon on `localhost:8787`, `POST /sign` → DMK over node-HID →
Ethereum app on the device → signed raw tx.

**Why a daemon and not WebHID in the popup.** An MV3 popup is destroyed
when it loses focus. Confirming on a Nano S takes several seconds of button
presses, during which focus moves to the device dialog. The daemon survives
that; the popup does not.

**Nano S constraints (verified 2026-09-10).** The device has 320 KB and
receives security-only updates as of 2026 — no Key Ring Protocol app and no
advanced clear-signing. Therefore: plain transaction signing through the
Ethereum app only. The Permit2 scenario stays on the transaction path
rather than EIP-712, and the submission states this limitation plainly
rather than implying richer device support than we have.

### `POST /verify` — the third-party agent API

```
POST /verify
{ "intent": AuthorizedIntent, "calls": [{ chainId, from, to, data, value }] }
→ { "policy", "verdict", "findings", "onchain", "perCall": [...] }
```

Stateless, no extension required. This is what the Bazantic MCP gateway
wraps, and it is the reusable artifact other agents can adopt after the
hackathon.

## Demo

One browser tab, one terminal window for the signer.

```
User:  "Swap at most 500 USDC to ETH on Base, max 1% slippage,
        no unlimited approvals."
       → popup: constraints shown, confirmed, authorization #a3f9c1 frozen

Agent proposal 1:  approve(USDC, MAX_UINT256)
       → REJECT · INTENT_UNLIMITED_APPROVAL_FORBIDDEN
                + GRAPH_EXPOSURE_USD "would expose $12,400"

Agent proposal 2:  approve(USDC, 500) + swap via Uniswap
       → REQUIRE_APPROVAL → tap Ledger → signed
```

Second scenario, ~30s: a malicious agent proposes `approve` on a
counterfeit USDC to a funnel address. `REJECT`, carried entirely by Graph
evidence — this is also the A/B fixture for Bazantic.

## Testing

TDD on everything deterministic, matching existing repo discipline.

- `packages/intent`: unit tests per finding code; hash stability across key
  reordering; tamper detection. Table-driven.
- `derivePolicy`: exhaustive over the finding-severity × tier matrix.
- `packages/onchain-context`: recorded HTTP fixtures — no live calls in
  tests; explicit timeout/`degraded` cases.
- `/verify`: golden tests for both demo scenarios end to end.
- Existing ~100 tests must stay green; `policy` is additive and every new
  field is optional on the wire.

## Sponsor mapping

| Sponsor | Track | Qualifying artifact |
|---|---|---|
| The Graph | AI Tooling (Continuity), $5k | `packages/onchain-context`, three load-bearing findings |
| Bazantic | 3 × $1k | MCP gateway over `/verify`, recipe combining Evzi + Graph, A/B result |
| Uniswap | Continuity, $2k | Trading API in `/agent/plan`, `FEEDBACK.md` + form |
| Ledger | Continuity, $1.5k | `apps/ledger-signer`, device gate on `REQUIRE_APPROVAL` |

## Risks

| Risk | Mitigation |
|---|---|
| Graph JWT not obtained | Blocks the largest bounty. 3 clicks at thegraph.market/keys; everything before it has no external dependency. |
| Nano S refuses DMK/HID | Ledger is scheduled after the core. Fallback: popup-only confirmation, Ledger dropped from submission. |
| Bazantic platform friction | Timeboxed to 4h. `/verify` has standalone value regardless. |
| Sponsor breadth dilutes the demo | One demo path only. A sponsor that does not appear in it is not integrated. |
| Live token data unstable on Base testnet | Demo reads mainnet/Base mainnet data; transactions are simulated or signed against a fork. |

## Implementation order

1. Tag `pre-ethonline-2026`, branch `ethonline-2026` (continuity boundary).
2. `packages/intent` + `derivePolicy` — no external dependencies.
3. `packages/onchain-context` — needs the JWT.
4. Agent console page + `/agent/plan` + `/verify`.
5. `apps/ledger-signer`.
6. Bazantic gateway + recipes + A/B run.
7. Uniswap `FEEDBACK.md`, `HACKATHON.md`, README, demo video.

Steps 2 and 4 carry the demo. Anything after step 5 is severable if time
runs short.
