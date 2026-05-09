# Intent-Check — Architecture

Last updated for the state at branch `intent-check-mvp` after milestone M2.7.

This document is the entry point for engineers and AI agents joining the
project. It explains:

- What we are building and why.
- How the pieces fit together (components, packages, dataflow).
- The trust model (deterministic vs LLM, safety floor, trust ceiling).
- How the protocol registry works and where to extend it.
- The audit of where data lives — what is hardcoded and why, what is
  configurable, and what should move next.

For the user-facing pitch and design rationale, read
[`specs/2026-05-08-intent-check-design.md`](./superpowers/specs/2026-05-08-intent-check-design.md).
For the original implementation plan, read
[`plans/2026-05-08-intent-check-mvp-m1-m2.md`](./superpowers/plans/2026-05-08-intent-check-mvp-m1-m2.md).
This file describes the **current** system, not the historical plan.

---

## Goal

Tell a user, **before they sign**, whether a Web3 transaction matches the
intent the dapp claims it has. Catch drainers and phishing without false-
positive-flooding the green path.

Two pillars:

1. **Deterministic checks**, run locally in the extension.
   Calldata decoding, address registry, contract verification, simulation.
   No model judgment. Reproducible.
2. **LLM judgment**, run in the backend. The LLM compares the user's
   stated intent against the deterministic findings, produces a one-sentence
   headline + tier (`SAFE` / `CAUTION` / `DANGER`).

A bidirectional **safety floor / trust ceiling** sits between the two so the
LLM can't soften a hard danger and can't escalate a vetted protocol to
DANGER on a hunch.

---

## Components

```
                       browser tab (page main world)
   ┌────────────────────────────────────────────────────────┐
   │ dApp JS  ──calls──►  window.ethereum.request          │
   │                              ▲                         │
   │                         patched by                     │
   │                              │                         │
   │   inpage.js (public/inpage.js, web_accessible)         │
   └──────────────────│postMessage│────────────────────────┘
                      │ port: "intent-check"
   ┌──────────────────▼─────────────────────────────────────┐
   │ content-script.ts (ISOLATED world)                     │
   │   - injects inpage.js at document_start                │
   │   - bridges window.postMessage <-> chrome.runtime      │
   └──────────────────│sendMessage│────────────────────────┘
                      │
   ┌──────────────────▼─────────────────────────────────────┐
   │ background.ts (MV3 service worker)                     │
   │   1. decode(calldata)         → @intent-check/decoder  │
   │   2. lookupProtocol(addr)     → protocol-registry      │
   │   3. fetchVerifiedContract()  → sourcify-client        │
   │   4. inferIntent(pageSnap)                             │
   │   5. (user confirms intent)                            │
   │   6. simulate(tx)             → tenderly-client        │
   │   7. computeNetEffect(sim)                             │
   │   8. deterministicFindings()                           │
   │   9. POST /judge              ──────────────────────┐  │
   │  10. store PhaseState in chrome.storage.session     │  │
   │  11. forward user's decision back to inpage         │  │
   └────────────────────────────────────────────────────│──┘
                      ▲                                 │
                      │  user decides                   │
   ┌──────────────────│─────────────────────────────────│──┐
   │ popup (React + shadcn/ui)                          │  │
   │   PopupView reads chrome.storage.session, polling  │  │
   │   shows: confirm-intent → spinner → verdict        │  │
   │   ChecksPanel summarizes deterministic findings    │  │
   └────────────────────────────────────────────────────│──┘
                                                        │
                            HTTP POST /judge            │
   ┌────────────────────────────────────────────────────▼──┐
   │ apps/judge (Hono on Cloudflare Workers / Node)        │
   │   /judge/info (GET)  → which LLM is wired up          │
   │   /judge       (POST) → JudgeInput                    │
   │                                                        │
   │   ├── llmJudgeOpenAI()    @anthropic-ai/sdk           │
   │   │   default model: gpt-5.2 (env OPENAI_MODEL)       │
   │   │   uses JSON Schema strict response_format         │
   │   │                                                    │
   │   ├── llmJudge() (Anthropic)                          │
   │   │   model: claude-sonnet-4-6                        │
   │   │                                                    │
   │   └── applySafetyFloor(verdict, JudgeInput)           │
   │           ↑                                            │
   │       trust ceiling clamps DANGER → CAUTION           │
   │       safety floor escalates SAFE → CAUTION/DANGER    │
   └────────────────────────────────────────────────────────┘
```

---

## Repo layout

```
intent-check/
├── apps/
│   ├── extension/                  # MV3 Chromium extension
│   │   ├── public/inpage.js        # window.ethereum proxy (vanilla JS, copied verbatim)
│   │   ├── src/
│   │   │   ├── background.ts       # service-worker orchestrator
│   │   │   ├── content-script.ts   # bridge inpage <-> background
│   │   │   ├── popup/
│   │   │   │   ├── App.tsx         # extension entry; polls storage
│   │   │   │   ├── PopupView.tsx   # shared UI shell (ChecksPanel etc.)
│   │   │   │   └── components/
│   │   │   └── shared/
│   │   │       ├── messaging.ts    # typed message contract
│   │   │       └── config.ts       # JUDGE_*, TENDERLY_* (Vite-injected from .env)
│   │   ├── preview/                # localhost dev server, mock states for design iteration
│   │   ├── manifest.config.ts      # MV3 manifest via @crxjs/vite-plugin
│   │   └── vite.config.ts          # injects .env as VITE_TENDERLY_*
│   └── judge/                      # Hono backend (Cloudflare Workers default)
│       ├── src/
│       │   ├── index.ts            # Worker entry (env wiring)
│       │   ├── judge.ts            # /judge + /judge/info handlers, dispatch
│       │   ├── safetyFloor.ts      # post-LLM enforcement
│       │   ├── prompt.ts           # system prompt (with protocol conventions)
│       │   ├── openai.ts           # OpenAI Chat Completions client
│       │   └── anthropic.ts        # Anthropic SDK wrapper
│       ├── tests/                  # vitest + Hono in-process app.request()
│       └── wrangler.toml
├── packages/
│   ├── types/                      # all shared TypeScript types (no runtime deps)
│   ├── decoder/                    # calldata → DecodedAction recognizers
│   │   └── src/recognizers/
│   │       ├── erc20.ts            # transfer/approve/setApprovalForAll
│   │       └── uniswapUniversalRouter.ts
│   ├── protocol-registry/          # hand-curated address book (THE trust source)
│   ├── sourcify-client/            # contract verification lookup
│   └── tenderly-client/            # transaction simulation
└── docs/
    ├── ARCHITECTURE.md             # ← you are here
    └── superpowers/                # specs and plans by milestone
```

Every package is private (`"private": true`), all internal deps go through
`workspace:*`, the only runtime deps that ship to a user are bundled into
the extension build (`apps/extension/dist/`) or the Worker bundle.

---

## Dataflow: a single transaction

1. **dApp invokes `window.ethereum.request({ method: "eth_sendTransaction", … })`.**
   The page lives in the **main world**; our patched `request` is also in main world
   (loaded by `content-script.ts` via a `<script src=chrome-extension://…/inpage.js>`
   inserted at `document_start`).
2. **`inpage.js` intercepts.** Reads `window.ethereum.chainId` synchronously, generates
   a UUID, posts a `{ port: "intent-check", payload: { kind: "wallet_request", id, request, chainIdHex, origin } }`
   message via `window.postMessage`. Awaits a verdict reply via the same channel.
3. **`content-script.ts` (ISOLATED world)** receives the message, snapshots the page
   (title, og:tags, focused-button text), and forwards via `chrome.runtime.sendMessage`
   to the background.
4. **`background.ts`** orchestrates:
   - **Decode**: `decode({ chainId, to, data, value, from })`. Recognizers walk the
     calldata. Returns a `DecodedAction` discriminated union — `swap`, `approve`,
     `setApprovalForAll`, `transfer`, or `unknown`.
   - **Registry lookup**: `lookupProtocol(chainId, to)` → `{ protocol, name, kind } | null`.
     Sets `contract.knownProtocol`. **This is the load-bearing trust signal.**
   - **Sourcify**: `fetchVerifiedContract({ chainId, address: to })` → `{ verified, matchType, contractName, abi }`.
   - **Intent inference**: regex on the page snapshot → `UserIntent { kind, summary, confidence }`.
   - Stores `phase: "awaiting_confirm"` + opens popup. **User confirms or edits intent**.
5. After confirm, background re-enters:
   - Stores `phase: "judging", step: "fetching_simulation"` so the popup can spin.
   - **Simulate**: `simulate(...)` against Tenderly → `SimResult { assetChanges, balanceChanges, gasUsed, success }`.
     Skipped if Tenderly creds aren't configured.
   - **`computeNetEffect(sim, walletAddress)`** sums per-asset deltas for the user's address →
     `NetDelta[]`.
   - **`deterministicFindings()`** produces `Finding[]` — `UNLIMITED_APPROVAL`,
     `SET_APPROVAL_FOR_ALL`, `UNVERIFIED_CONTRACT` (suppressed when knownProtocol is
     set or decoded.trusted is true), `INTENT_MISMATCH_MINT_VS_APPROVE`,
     `SWAP_RECIPIENT_MISMATCH` (suppressed when recipientKind is wallet/router_self).
   - Stores `phase: "judging", step: "calling_judge"`.
   - **POSTs to `/judge`**. Backend dispatches to OpenAI or Anthropic (depending on
     env), gets a structured `JudgeVerdict`, runs `applySafetyFloor()` against the
     full `JudgeInput`, returns the final verdict.
   - Stores `phase: "verdict_ready"`. Popup repaints.
6. **User clicks Sign or Reject** → background forwards back through content-script →
   inpage. inpage either calls the original `target.request` (sign) or throws
   `{ code: 4001 }` (reject). dApp sees a normal wallet response.

---

## Trust model

There are **three** sources of trust signals that flow into the `JudgeInput`:

1. **Address-based: `contract.knownProtocol`** — set by `lookupProtocol(chainId, to)`
   from the bundled registry. **Most reliable.** Doesn't depend on the calldata being
   decodable or Sourcify having the contract verified.
2. **Calldata-shape-based: `decoded.trusted`** — set by individual recognizers when
   they're confident the call matches a well-known protocol shape *and* targets a
   whitelisted address. Currently only the Uniswap Universal Router recognizer sets
   it. Useful when a recognizer can confirm a known protocol but the registry doesn't
   have the specific deployment.
3. **Cryptographic: `contract.verified`** — set by Sourcify. Indicates source code
   matches deployed bytecode. Coverage is uneven (many Uniswap contracts are
   `partial` or absent), so this is a tertiary signal.

When asking "is this trusted?", we use:

```
trustedByRegistry = contract.knownProtocol !== undefined
trustedByDecoder  = decoded.kind === "swap" && decoded.trusted === true
trustedSomehow    = trustedByRegistry || trustedByDecoder
```

The deterministic-findings step suppresses `UNVERIFIED_CONTRACT` when
`trustedSomehow` is true. The safety-floor's trust ceiling triggers when
`trustedSomehow && sim.success && no danger findings`.

### The safety floor / trust ceiling (`apps/judge/src/safetyFloor.ts`)

Two-way enforcement of the deterministic→LLM relationship:

- **Floor (deterministic → LLM upgrade).** If `findings` contain a `danger`-severity
  entry, the published tier is **at least** DANGER. Even if the LLM said SAFE.
  If only `warn` entries exist, the tier is at least CAUTION. The LLM cannot
  soften deterministic findings — it can only summarize them.
- **Ceiling (deterministic → LLM downgrade).** If the call is on a known/trusted
  protocol AND simulation succeeded AND no danger findings exist, an LLM that
  returns DANGER is clamped to CAUTION. The model cannot escalate a vetted
  protocol to DANGER on a hunch.

The floor and ceiling together define a *bracket* `[detMin, detMax]` that the
LLM's verdict gets snapped to. CAUTION is the only tier that survives both
escalation and softening — so the LLM is most useful when it has a real
caution-worthy observation that the deterministic layer didn't catch.

---

## The protocol registry: where, why, how to grow it

### What it is

`packages/protocol-registry/src/index.ts` exports a hand-curated map:

```ts
ProtocolInfo = { protocol: string; name: string; kind: ProtocolKind }
lookupProtocol(chainId: number, address: string) => ProtocolInfo | null
```

`ProtocolKind` is `"router" | "permit2" | "marketplace" | "lending" | "weth" | "stablecoin" | "bridge" | "ens" | "other"`.

The registry is the **single source of truth** for "is this address a known
contract?" Both the Uniswap UR recognizer (for the `decoded.trusted` flag)
and the extension background (for `contract.knownProtocol`) call into it.

### Why hand-curated and not, say, on-chain or live-fetched

- **Determinism.** Every developer / agent / CI run sees the same data.
- **No network at trust-evaluation time.** The popup must render fast; calling out
  to a remote registry per transaction would add latency on the hot path.
- **No supply-chain risk.** A remote registry that the extension trusts is a
  prime target for compromise. Bundled-at-build-time is auditable in `git log`.
- **Small surface.** The set of contracts that genuinely matter for trust
  decisions in 2026 is in the hundreds, not millions. Hand-curating ~100
  entries across the top chains is feasible; ~1M is not.

### Where it lives

Two layers:

1. **Universal addresses** (`UNIVERSAL`) — contracts deployed at the same
   address on every EVM chain via canonical CREATE2 salts:
   - Permit2 `0x000000000022d473030f116ddee9f6b43ac78ba3`
   - Seaport 1.5/1.6 deterministic deployments

2. **Per-chain tables** (`BY_CHAIN`) — keyed by `chainId`. Currently covers
   Ethereum (1), Optimism (10), Polygon (137), Base (8453), Arbitrum (42161),
   BNB (56). Adding a new chain means adding a new top-level key.

Lookups: universal table first (a contract there matches on any chain), then
chain-specific. All address keys are stored lowercase; the lookup function
lower-cases the input before matching.

### How to add an entry

```ts
// In packages/protocol-registry/src/index.ts
const BY_CHAIN: Record<number, Record<string, ProtocolInfo>> = {
  // ...
  10: {
    // ...
    "0xnew_address_lowercased": {
      protocol: "Aave",
      name: "Aave v3 Pool",
      kind: "lending",
    },
  },
};
```

Then add a unit test in `packages/protocol-registry/tests/index.test.ts`
asserting the lookup returns the expected info. That's it — every consumer
(decoder, background, safety floor) automatically picks it up via
`lookupProtocol()`.

### How to make it better in the future

The current setup is intentionally minimal. Here's the upgrade path, ordered
by ROI for the threat model:

1. **Auto-ingest at build time** from a community-maintained address list
   (e.g. Uniswap's [`@uniswap/contracts`](https://github.com/Uniswap/contracts)
   deployments file, DefiLlama's protocols list, or a curated subset of the
   [Trust Wallet token list](https://github.com/trustwallet/assets)). Generate
   `BY_CHAIN` from JSON during `pnpm install` or a pre-commit hook. Keeps the
   "single source of truth" property but removes the manual maintenance burden
   for major additions.
2. **Sourcify-name fallback as a soft signal.** If `lookupProtocol` returns
   null but Sourcify reports a `contractName` matching a small whitelist
   (`UniversalRouter`, `Pool`, `Vault`, …), surface as
   `knownProtocol.kind: "soft"` so the trust ceiling does **not** apply but the
   ChecksPanel labels it. This catches new deployments before someone updates
   the registry, with a clear lower confidence tier.
3. **Per-chain RPC verification on first sight.** When we see a contract for the
   first time, fetch its bytecode and hash it; compare against a known-good
   bytecode hash from the registry. Detects malicious clones at a different
   address that pretend to be the protocol. Cache hits in `chrome.storage.local`.
4. **EIP-1967 proxy resolution.** If a known address is a proxy whose
   implementation slot points elsewhere, we currently treat the proxy as the
   trust anchor. Resolving the implementation and adding *both* to the registry
   would catch upgrade-based attacks where the implementation is swapped to a
   malicious contract.
5. **Trust by attestations.** Use ENS reverse records, EIP-7672 (or whatever
   on-chain attestation scheme stabilizes), or signed lists from trusted
   parties (Uniswap Foundation, Aave, …) instead of a hand-curated TS file.
   Bigger lift; appropriate for production.
6. **Registry as a separate signed JSON.** Ship the registry as a signed JSON
   blob fetched at extension install time and refreshed weekly. Separates
   "code" from "data" so the trust list can be updated without a Chrome Web
   Store re-review.

For the current MVP scope, options 1 and 2 are the natural next steps and
neither requires any architectural change beyond `protocol-registry`.

---

## Hardcoded data audit

What's hardcoded today, why, and whether it should move:

| Location | Value | Why hardcoded | Move? |
|---|---|---|---|
| `packages/protocol-registry/src/index.ts` | All known protocol addresses | This **is** the source of truth — see "protocol registry" section. | No. Future: auto-ingest. |
| `packages/decoder/src/recognizers/uniswapUniversalRouter.ts` | UR command id → name map; sentinel addresses (`0x...0001`, `0x...0002`); execute() selectors `0x3593564c`, `0x24856bc3` | Protocol semantics defined by Uniswap; not configurable. | No. |
| `apps/extension/src/shared/config.ts` | `JUDGE_BASE_URL = "http://127.0.0.1:8787"` | Local dev default. | Yes — replace with `import.meta.env.VITE_JUDGE_URL` once we deploy a real backend. |
| `apps/extension/src/shared/config.ts` | `JUDGE_API_KEY = "local-dev-key"` | Matches wrangler default; protects against random external POSTs while we're in local dev. | Yes — should come from `.env` at build time. |
| `apps/extension/src/shared/config.ts` | `SUPPORTED_CHAIN_IDS`, `CHAIN_ID_TO_NETWORK_ID` | Tenderly's network slug happens to equal chain id for the chains we support. Kept explicit so adding a chain whose Tenderly slug differs is one line. | No. Future: derive from `protocol-registry`. |
| `apps/judge/src/openai.ts` | `https://api.openai.com/v1/chat/completions` | Canonical OpenAI endpoint. | No. |
| `apps/judge/src/openai.ts` | Default model `gpt-5.2` | Overridable via `OPENAI_MODEL` env. | No. |
| `apps/judge/src/anthropic.ts` | Model `claude-sonnet-4-6` | Hardcoded; not configurable. | Yes — surface via env if we ever support multiple Anthropic models. |
| `packages/tenderly-client/src/index.ts` | Default base `https://api.tenderly.co` | Overridable via `args.baseUrl`. | No. |
| `apps/judge/wrangler.toml` | `JUDGE_API_KEY = "local-dev-key"` | Cloudflare-Worker var (committed). | Move to a Cloudflare secret for production. |
| `apps/extension/manifest.config.ts` | host_permissions = `http://*/*`, `https://*/*` | We need to intercept on every dapp. | Tighten to a known-domains list before any Chrome Web Store submission. |
| `.env` (root) | `TENDERLY_*`, `ANTHROPIC_API_KEY`, etc. | gitignored; consumed by Vite (`VITE_TENDERLY_*`) and Wrangler (`apps/judge/.dev.vars`). | This **is** the right place. Just verify the .gitignore. |

Secrets verified gitignored:
- `.env`, `.env.local`, `.dev.vars` all listed in `/Users/evzhen/workspace/intent-check/.gitignore`.
- Chrome `chrome.storage.local` Tenderly creds are runtime overrides — never committed.

The Tenderly access key **is** baked into the extension bundle at build time
(via `Vite.define`). This is documented as acceptable for local dev. The
"proper" fix is to proxy Tenderly through `apps/judge` (M5 in the roadmap)
so the extension carries no third-party keys.

---

## Conventions

### TypeScript
- `noUncheckedIndexedAccess` is on. Array element access returns `T | undefined`.
- Discriminated unions on `kind` (DecodedAction) and `method` (WalletRequest)
  for narrowing.
- All workspace packages publish source directly via `main`/`types`/`exports`
  pointing at `./src/index.ts` — no build step required for cross-package use.

### Tests
- Vitest, run from each package via `pnpm test`. Aggregate via root `pnpm test`.
- Mock `fetch` via `vi.stubGlobal("fetch", ...)` — see sourcify-client / tenderly-client / openai tests.
- Hono handlers are tested via `app.request("/path", { method, body })` — no real HTTP.
- Decoder tests use viem's `encodeFunctionData` + `encodePacked` to round-trip
  real calldata into the decoder, asserting on field values not mock interactions.
- TDD discipline: red phase first when adding a recognizer or finding.

### Commits
- Imperative, no `Co-Authored-By` trailers. Each milestone closes with 3-5
  logically grouped commits (feat / fix / chore).

### Adding a new finding code
1. Add the `code` and severity decision to `deterministicFindings()` in
   `apps/extension/src/background.ts`.
2. Update `apps/judge/src/prompt.ts` if the LLM should know about the
   finding's semantics (so it doesn't double-list).
3. Add a test scenario in `apps/judge/tests/judge.golden.test.ts` if it
   should drive a verdict tier change.

### Adding a new chain
1. Add the chain id to `SUPPORTED_CHAIN_IDS` in `apps/extension/src/shared/config.ts`.
2. Add Tenderly's network slug to `CHAIN_ID_TO_NETWORK_ID` (usually equal to chain id).
3. Add known protocol addresses to `packages/protocol-registry/src/index.ts`
   under the new chain id.

### Adding a new protocol recognizer
1. Create `packages/decoder/src/recognizers/<protocol>.ts`. Export a
   `tryDecode<Protocol>(input: DecodeContext): DecodedAction | null`.
2. Register in `packages/decoder/src/recognizers/index.ts` — order matters,
   most specific first.
3. Add the protocol's known addresses to `packages/protocol-registry`.
4. If the protocol introduces new `DecodedAction` variants (e.g., a Permit2
   `permit2Transfer` variant), add to the union in `packages/types/src/index.ts`.
5. Tests: round-trip calldata through `decode()` and assert field values.

---

## Open issues / next milestones

- **M3a (signatures).** EIP-712 typed-data decoding for `eth_signTypedData_v4`.
  Currently background short-circuits these with "method not supported". This
  is the killer demo — Permit2 batch transfers and Seaport orders don't
  go through `eth_sendTransaction` at all.
- **M3b (origin trust).** Lookalike domain detection (punycode, Levenshtein
  vs a small known-dapp list). The data flows are wired (`OriginSignals`)
  but no checks fire yet.
- **M3c (contract age).** Detect freshly-deployed contracts via on-chain
  binary-search on `getCode`. Critical for catching newly-deployed drainers.
- **M4 (demo polish).** `VITE_DEMO=1` fixture mode that bundles canned
  responses for Sourcify/Tenderly/the LLM. Visual polish on the popup.
- **M5 (production hardening).** Proxy Tenderly through `apps/judge` so
  extension carries no third-party keys. Move `JUDGE_API_KEY` to a
  Cloudflare secret. Tighten manifest host_permissions before any store
  submission.
