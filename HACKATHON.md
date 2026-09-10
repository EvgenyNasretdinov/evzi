# ETHOnline 2026 — Continuity submission

**Project:** Evzi — an intent firewall for AI agents
**Track:** Continuity (the project existed before this event)
**Baseline tag:** `pre-ethonline-2026` → commit `5360023`, 8 May – 10 May 2026
**Hackathon branch:** `ethonline-2026`

Everything built during this event is exactly:

```bash
git diff pre-ethonline-2026..HEAD
```

63 files changed, 8,327 insertions, 21 deletions, across 25 commits.

---

## What the project was before this event

A browser extension that answers one question: **does this wallet request match
what the dApp claims it does?** It hooks the in-page provider, decodes the
calldata, looks the contract up in a curated registry and on Sourcify,
simulates against a Tenderly fork, classifies the origin, and asks an LLM to
compare all of it against the user's stated intent.

That is the part written in May: the MV3 extension (`inpage.js`,
content-script, background orchestrator, React popup), the Hono judge worker
(`/judge`, `/infer-intent`, `/chat`, the safety floor and trust ceiling), and
the packages `decoder`, `protocol-registry`, `origin-trust`, `sourcify-client`,
`tenderly-client`, `token-metadata`, `types` — about 8,100 lines of TypeScript
and 128 tests.

**None of it is being resubmitted.** It is the substrate the new work sits on.

## What was built during ETHOnline 2026

A second, harder question: **does this agent-proposed action still match what
the human actually authorized?**

The human states a goal once. Evzi freezes it into an `AuthorizedIntent` — a
hashed, immutable object carrying machine-readable constraints. An agent then
proposes transactions. Every proposal is checked against that frozen
authorization, against live on-chain data from The Graph, and against the
existing deterministic checks, producing a policy: `ALLOW` /
`REQUIRE_APPROVAL` / `REJECT`.

### New packages and apps

| Path | What it does | Tests |
|---|---|---|
| `packages/intent` | The frozen authorization, canonical-JSON hashing, tamper and expiry detection, the constraint verifier, and `derivePolicy` | 59 |
| `packages/onchain-context` | Two Graph providers (subgraph gateway + Token API), orchestration with timeout and degradation, a TTL cache, and the findings derived from live data | 48 |
| `apps/ledger-signer` | Hardware signing daemon that calls the verifier itself before touching the device | 10 |
| `apps/judge` (additions) | `POST /verify`, `POST /agent/plan`, `/openapi.json`, server-side Graph enrichment, `claimedSymbolFor` | +42 |
| `apps/demo-pages/agent-console.html` | The propose → verify → correct loop, in one page | — |
| `apps/judge/ab/` | The A/B experiment and its recorded result | — |

Tests: **128 → 287**.

### Modified pre-existing files

Kept deliberately small, and every change additive:

- `packages/types/src/index.ts` — new interfaces; `JudgeVerdict.policy`,
  `JudgeInput.authorization` and `JudgeInput.onchain` are all optional, so every
  existing construction site and golden fixture still holds.
- `apps/judge/src/judge.ts` — both verdict paths now go through `finalize()`,
  which applies the existing safety floor and then attaches the policy.
- `apps/judge/src/index.ts` — mounts the new routes, passes the Graph keys.
- `apps/demo-pages/index.html` — links the new demo.
- `packages/decoder/tests/eip712.test.ts` — fixes a **pre-existing** break:
  `pnpm typecheck` was failing on three indexed accesses before this event.
  Fixed so typecheck could serve as a green gate for the new work.

---

## Sponsor tracks

### The Graph — AI Tooling / Use Case (Continuity)

Live Graph data is load-bearing: without it the verdict is different.

Two Graph products are composed. The **subgraph gateway** answers in 200–500ms
and is the only source the verdict blocks on. The **Token API** answers in ~10s
on the free tier — measured across `/tokens`, `/balances`, `/holders` and
`/transfers`, all ≈10,000ms — which is far too slow to hold a user waiting to
sign, so it runs in the background and fills a ten-minute cache that enriches
later checks. A token is treated as canonical if **either** product vouches for
it, so one being unavailable does not blind the check.

What it catches, live:

```
real USDC (mainnet)   canonical=true   $1.03T volume     8,787,430 holders
real USDC (Base)      canonical=true   $79.6M liquidity
counterfeit "USDC"    canonical=false  → DANGER GRAPH_TOKEN_IMPERSONATION
```

The counterfeit case is one the pre-existing pipeline could not catch at all:
contract verification describes code, and a counterfeit's code is fine. Only
market data separates it from the real thing.

Code: `packages/onchain-context/`. Live check: `tests/live/check.ts`.

### Bazantic — Help an Agent Use Your Project (Continuity)

`POST /verify` is the reusable artifact: stateless, deterministic, no LLM
consulted, so the same proposal always yields the same policy. It decodes the
proposed calldata itself rather than trusting the caller's description of it.
The OpenAPI spec is served from the deployment at `/openapi.json`.

The required A/B is in `apps/judge/ab/`, with the result recorded in
[`ab/RESULTS.md`](apps/judge/ab/RESULTS.md). Eleven proposals against one
authorization, three trials each, same model and prompt in both arms — the only
difference is arm B receiving the `/verify` response:

| metric | raw API | with Evzi |
|---|---|---|
| violations caught | 17/27 | **27/27** |
| false alarms on safe proposals | 0/6 | 0/6 |
| correct decisions | 23/33 | **33/33** |

The raw model failed exactly where the answer needs an exact decode or
knowledge the calldata does not contain: an over-cap amount, a counterfeit
token, and a lookalike router address — 0/3 on each.

### Ledger — Continuity

`apps/ledger-signer` signs on the device, but **calls `/verify` itself first**
rather than trusting whoever called it. A compromised extension or a rogue
agent cannot obtain a signature for something the authorization forbids: on
`REJECT` the device is never asked, and an unreachable verifier also refuses
rather than signing blind.

Nano S constraints, verified: 320 KB and security-only updates since 2026, so
no Key Ring app and no advanced clear-signing. Plain transaction signing
through the Ethereum app is what this supports, and the popup explains the
transaction before the device is ever asked.

**Status: the policy gate is covered by 10 tests against a faked device; an
end-to-end signature on real hardware is not yet demonstrated.**

### Uniswap — Stack Contribution (Continuity)

See [`FEEDBACK.md`](FEEDBACK.md).

---

## Running it

```bash
pnpm install

# 1. judge worker — needs OPENAI_API_KEY, GRAPH_API_KEY, GRAPH_TOKEN_API_JWT
#    in apps/judge/.dev.vars
pnpm --filter @intent-check/judge dev

# 2. demo pages
python3 -m http.server 8765 --directory apps/demo-pages
# → http://localhost:8765/agent-console.html

# 3. optional: hardware signer (Ledger unlocked, Ethereum app open,
#    Ledger Live closed)
pnpm --filter @intent-check/ledger-signer probe
pnpm --filter @intent-check/ledger-signer start

# the A/B experiment
pnpm --filter @intent-check/judge ab
```

Everything: `pnpm test && pnpm typecheck`.

## What is honestly not done

- **No hardware signature has been produced yet.** The daemon and its policy
  gate are written and tested; the device was not reachable over USB during
  development.
- **The agent proposer is scripted, not an LLM.** Deliberate — the interesting
  behaviour belongs to the verifier, and a deterministic proposer keeps the
  demo and the A/B reproducible — but it is not a language-model agent, and the
  submission should not be read as claiming one.
- **A spender-funnel signal was designed and dropped.** It needed transfers
  filtered by recipient across all tokens; `/v1/evm/transfers` ignores
  `to`/`recipient`/`receiver` and returns nothing for `to_address` at any
  `age`, so the query is not expressible on this tier. A check that silently
  never fires is worse than no check.
- **The A/B sample is small** — eleven proposals, three trials. The three total
  failures are unambiguous and structural, but the percentages should not be
  read as precise. Caveats are listed in `ab/RESULTS.md`.
