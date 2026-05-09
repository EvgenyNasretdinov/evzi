# Evzi — Architecture

Last updated for the state at branch `intent-check-mvp` after the M3a/M3b/M3c/M3d
work plus Aave v3 support and the designer's UI overhaul (`ConfirmIntentScreen`,
`VerdictScreen`, `EvziEyeLogo`). HEAD: `e19afd1`.

This document is the entry point for engineers and AI agents joining the
project. It explains:

- What we are building and why.
- How the pieces fit together (components, packages, dataflow).
- The trust model (deterministic vs LLM, safety floor, trust ceiling).
- How the protocol registry works and where to extend it.
- The audit of where data lives — what is hardcoded and why, what is
  configurable, and what should move next.

For the user-facing pitch and the original design / implementation plan, see
the docs under `docs/superpowers/specs/` and `docs/superpowers/plans/`. This
file describes the **current** system, not the historical plan.

The npm package names are `@intent-check/*` for legacy reasons; the project
is branded **Evzi** publicly.

---

## Goal

Tell a user, **before they sign**, whether a Web3 transaction matches the
intent the dApp claims it has. Catch drainers and phishing without false-
positive-flooding the green path.

Two pillars:

1. **Deterministic checks**, run locally in the extension.
   Calldata decoding, address registry, contract verification, simulation,
   origin trust. No model judgment. Reproducible.
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
   │ dApp JS                                                │
   │   ├─ EIP-6963 announceProvider events ◄──┐            │
   │   └─ legacy window.ethereum.request ─────┤            │
   │                                          │ patched by │
   │   inpage.js (public/inpage.js, web_accessible)        │
   │   - patches window.ethereum                            │
   │   - patches each EIP-6963 announced provider           │
   │   - patches window.ethereum.providers[] entries        │
   │   - records last click + nearby form/section context   │
   └──────────────────│postMessage│────────────────────────┘
                      │ port: "intent-check"
   ┌──────────────────▼─────────────────────────────────────┐
   │ content-script.ts (ISOLATED world)                     │
   │   - injects inpage.js at document_start                │
   │   - bridges window.postMessage <-> chrome.runtime      │
   │   - takes a page snapshot (title, og:tags, …)          │
   └──────────────────│sendMessage│────────────────────────┘
                      │
   ┌──────────────────▼─────────────────────────────────────┐
   │ background.ts (MV3 service worker)                     │
   │   1. decode(calldata or typed-data)                    │
   │   2. lookupProtocol(addr)     → protocol-registry      │
   │   3. fetchVerifiedContract()  → sourcify-client        │
   │   4. inferIntent(snapshot)    → /infer-intent (LLM)    │
   │   5. (user confirms intent)                            │
   │   6. simulate(tx)             → tenderly-client        │
   │   7. computeNetEffect(sim)                             │
   │   8. classifyOrigin(url)      → origin-trust           │
   │   9. deterministicFindings()                           │
   │  10. POST /judge              ──────────────────────┐  │
   │  11. store PhaseState in chrome.storage.session     │  │
   │  12. forward user's decision back to inpage         │  │
   └────────────────────────────────────────────────────│──┘
                      ▲                                 │
                      │  user decides                   │
   ┌──────────────────│─────────────────────────────────│──┐
   │ popup (React + shadcn/ui)                          │  │
   │   PopupView reads chrome.storage.session, polling  │  │
   │   ConfirmIntentScreen (kind + summary + concern)   │  │
   │   ProgressList during judging (5-step pipeline)    │  │
   │   VerdictScreen (eye, title, checklist, raw data)  │  │
   └────────────────────────────────────────────────────│──┘
                                                        │
                            HTTP POST /judge            │
   ┌────────────────────────────────────────────────────▼──┐
   │ apps/judge (Hono on Cloudflare Workers / Node)        │
   │                                                        │
   │   GET  /judge/info     → { provider, model }          │
   │   POST /infer-intent   → UserIntent (gpt-5-mini/5.1)  │
   │   POST /judge          → JudgeVerdict                 │
   │                                                        │
   │   Provider dispatch:                                  │
   │   ├── llmJudgeOpenAI()   default gpt-5.4              │
   │   │      uses JSON Schema strict response_format      │
   │   │                                                    │
   │   ├── llmJudge() (Anthropic, default sonnet-4-6)      │
   │   │                                                    │
   │   └── applySafetyFloor(verdict, JudgeInput)           │
   │           ↑                                            │
   │       trust ceiling clamps DANGER → CAUTION when      │
   │         decoded.trusted (swap or lendingAction)       │
   │         OR contract.knownProtocol  set,               │
   │         AND sim.success, AND no danger findings.      │
   │                                                        │
   │       safety floor escalates SAFE → CAUTION/DANGER    │
   │         based on Finding severities.                  │
   └────────────────────────────────────────────────────────┘
```

---

## Repo layout

```
intent-check/
├── apps/
│   ├── extension/                  # MV3 Chromium extension
│   │   ├── public/inpage.js        # window.ethereum + EIP-6963 proxy (vanilla JS)
│   │   ├── src/
│   │   │   ├── background.ts       # service-worker orchestrator
│   │   │   ├── content-script.ts   # bridge inpage <-> background
│   │   │   ├── popup/
│   │   │   │   ├── App.tsx         # extension entry; polls storage, fetches /judge/info
│   │   │   │   ├── PopupView.tsx   # shared shell — idle / confirm / judging / verdict / error
│   │   │   │   ├── components/
│   │   │   │   │   ├── ConfirmIntentScreen.tsx  # designer's confirm screen (summary-first)
│   │   │   │   │   ├── VerdictScreen.tsx        # designer's verdict screen + checklist
│   │   │   │   │   ├── EvziEyeLogo.tsx          # branded iris logo
│   │   │   │   │   └── VerdictChip.tsx
│   │   │   │   ├── verdict/verdictContent.ts    # builds checklist from JudgeInput
│   │   │   │   └── lib/decodedDisplay.ts
│   │   │   └── shared/
│   │   │       ├── messaging.ts    # typed message contract (3 hops)
│   │   │       └── config.ts       # JUDGE_*, TENDERLY_* (Vite-injected from .env)
│   │   ├── preview/                # localhost dev server with mock states + URL deep-links
│   │   ├── manifest.config.ts      # MV3 manifest via @crxjs/vite-plugin
│   │   └── vite.config.ts          # injects .env, sourcemaps on
│   ├── judge/                      # Hono backend (Cloudflare Workers default)
│   │   ├── src/
│   │   │   ├── index.ts            # Worker entry (env wiring)
│   │   │   ├── judge.ts            # mountJudge — /judge, /judge/info, /infer-intent
│   │   │   ├── safetyFloor.ts      # post-LLM enforcement (floor + ceiling)
│   │   │   ├── prompt.ts           # system prompt (UR conventions, drainers, origin findings)
│   │   │   ├── inferIntent.ts      # LLM-driven intent inference (cheap model)
│   │   │   ├── openai.ts           # OpenAI Chat Completions client (json_schema strict)
│   │   │   └── anthropic.ts        # Anthropic SDK wrapper
│   │   ├── tests/
│   │   └── wrangler.toml
│   └── demo-pages/                 # static phishing scenarios for the live demo
│       ├── index.html              # landing
│       ├── fake-mint.html          # fake NFT mint → USDC.approve(MAX)
│       ├── airdrop-claim.html      # fake airdrop → Permit2 batch drainer signature
│       └── README.md
├── packages/
│   ├── types/                      # all shared TypeScript types (no runtime deps)
│   ├── decoder/                    # calldata + EIP-712 → DecodedAction
│   │   └── src/recognizers/
│   │       ├── erc20.ts                       # transfer/approve/setApprovalForAll
│   │       ├── uniswapUniversalRouter.ts      # 2-arg + 3-arg execute(), V4_SWAP, sentinels
│   │       ├── aaveV3.ts                      # supply / withdraw / borrow / repay
│   │       └── eip712.ts                      # Permit, Permit2, Seaport orders
│   ├── protocol-registry/          # hand-curated cross-chain known-address book
│   ├── origin-trust/               # known-dApps + Levenshtein/punycode lookalike check
│   ├── sourcify-client/            # contract-verification lookup
│   ├── tenderly-client/            # transaction simulation (12s timeout)
│   └── token-metadata/             # ERC-20 symbol/decimals + amount formatting
└── docs/
    ├── ARCHITECTURE.md             # ← you are here
    └── superpowers/                # specs and plans by milestone
```

Every workspace package is private (`"private": true`). Internal imports use
`workspace:*`. The only runtime artifacts that ship to a user are bundled into
the extension build (`apps/extension/dist/`) or the Worker bundle.

---

## Dataflow: a single transaction

1. **dApp invokes a wallet method.** Either `window.ethereum.request(...)` or
   on a provider object received from EIP-6963 announceProvider events.
2. **`inpage.js` intercepts.** It has patched all known provider entry points:
   - `window.ethereum`
   - `window.ethereum.providers[]` (legacy multi-wallet array)
   - Each provider received via `eip6963:announceProvider`
3. **Click context capture.** A document-level `click` listener records the
   last clicked button (text, ARIA label, section heading) plus the visible
   form inputs and a 1.2KB text excerpt in the surrounding region. The
   wallet request payload includes this `clickContext` + `actionContext` so
   the LLM intent inference can see what the user actually pressed.
4. **`content-script.ts`** (ISOLATED world) receives the postMessage, takes
   a page snapshot, and forwards via `chrome.runtime.sendMessage`.
5. **`background.ts`** orchestrates:
   - **Decode**: handles `eth_sendTransaction` (calldata), `eth_signTypedData_v4`
     (typed data), `personal_sign` (free-form). Returns a `DecodedAction`
     discriminated union.
   - **Registry lookup**: `lookupProtocol(chainId, target)` → load-bearing
     trust signal independent of decoder result.
   - **Sourcify**: `fetchVerifiedContract({chainId, address})`.
   - **Origin trust**: `classifyOrigin(url)` → `trusted`/`punycode`/`lookalike`/`unknown`.
   - **Intent inference**: POST `/infer-intent` with click + page context;
     8s timeout; falls back to local regex if the call fails.
   - Stores `phase: "awaiting_confirm"` and opens the popup.
6. **User confirms or edits intent.** `ConfirmIntentScreen` renders kind +
   editable summary; if user clicks "Something feels off", a textarea
   appears under the toggle for them to explain.
7. After confirm, background re-enters the pipeline:
   - Stores `phase: "judging", step: "fetching_simulation"` so the popup
     spinner can show progress.
   - **Simulate**: `simulate(...)` against Tenderly → SimResult. 12s
     timeout; falls back to `success: false` instead of hanging.
   - **`computeNetEffect`**: per-asset signed deltas for the user's
     wallet from `sim.assetChanges`.
   - **`deterministicFindings`**: produces `Finding[]` —
     `UNLIMITED_APPROVAL`, `SET_APPROVAL_FOR_ALL`,
     `INTENT_MISMATCH_MINT_VS_APPROVE`, `SWAP_RECIPIENT_MISMATCH`
     (suppressed when recipient is a UR sentinel),
     `UNVERIFIED_CONTRACT` (suppressed when knownProtocol or
     decoded.trusted), `PERMIT_TO_UNVERIFIED_SPENDER`,
     `PERMIT_UNLIMITED_AMOUNT`, `PERMIT2_SPENDER_UNKNOWN`,
     `PERMIT2_BATCH_TRANSFER`, `SEAPORT_ZERO_PRICE_OFFER`,
     `LOOKALIKE_DOMAIN`, `PUNYCODE_DOMAIN`.
   - Stores `phase: "judging", step: "calling_judge"`.
   - **POSTs to `/judge`**. Backend dispatches to OpenAI or Anthropic
     (per `LLM_PROVIDER`), runs `applySafetyFloor`, returns the verdict.
   - Stores `phase: "verdict_ready"`. Popup repaints into `VerdictScreen`.
8. **User clicks Sign or Reject** → background forwards back through
   content-script → inpage. inpage either calls the original
   `target.request` (sign) or throws `{ code: 4001 }` (reject).

---

## Trust model

There are **three** sources of trust signals that flow into the `JudgeInput`:

1. **Address-based: `contract.knownProtocol`** — set by `lookupProtocol(chainId, target)`
   from the bundled registry. **Most reliable.** Doesn't depend on the calldata
   being decodable or Sourcify having the contract verified.
2. **Calldata-shape-based: `decoded.trusted`** — set by recognizers (Uniswap UR,
   Aave v3) when they're confident the call matches a well-known protocol shape
   targeting a registered address.
3. **Cryptographic: `contract.verified`** — set by Sourcify. Indicates source
   code matches deployed bytecode. Coverage is uneven (many Uniswap contracts
   are `partial` or absent), so this is a tertiary signal.

When asking "is this trusted?":

```
trustedByRegistry = contract.knownProtocol !== undefined
trustedByDecoder  = (decoded.kind === "swap" || "lendingAction") && decoded.trusted === true
trustedSomehow    = trustedByRegistry || trustedByDecoder
```

`deterministicFindings` suppresses `UNVERIFIED_CONTRACT` when `trustedSomehow`.
The safety-floor's trust ceiling triggers when
`trustedSomehow && sim.success && no danger findings`.

### Origin trust

Separate signal layer in `@intent-check/origin-trust`:

- **`trusted`** — the page's hostname matches (or is a subdomain of) a known
  dApp domain.
- **`punycode`** — hostname has any `xn--…` label. Always a danger finding
  (`PUNYCODE_DOMAIN`).
- **`lookalike`** — Levenshtein distance ≤2 from a known dApp's registrable
  domain. Always a danger finding (`LOOKALIKE_DOMAIN`).
- **`unknown`** — informational; rendered as caution-tier in the verdict
  checklist but doesn't on its own escalate the verdict.

### The safety floor / trust ceiling (`apps/judge/src/safetyFloor.ts`)

Two-way enforcement of the deterministic→LLM relationship:

- **Floor (deterministic → LLM upgrade).** If `findings` contain a
  `danger`-severity entry, the published tier is **at least** DANGER, even
  if the LLM said SAFE. Headline rewritten to start with `Stop —`. If only
  `warn` entries exist, the tier is at least CAUTION.
- **Ceiling (deterministic → LLM downgrade).** If `isDeterministicallyTrusted`
  is true AND the LLM returned DANGER, the verdict is clamped to CAUTION
  with an informational reason explaining why.

CAUTION is the only tier that survives both escalation and softening — so the
LLM is most useful when it has a real caution-worthy observation that the
deterministic layer didn't catch.

---

## The protocol registry: where, why, how to grow it

### What it is

`packages/protocol-registry/src/index.ts` exports a hand-curated map:

```ts
ProtocolInfo = { protocol: string; name: string; kind: ProtocolKind }
lookupProtocol(chainId: number, address: string) => ProtocolInfo | null
```

`ProtocolKind` is `"router" | "permit2" | "marketplace" | "lending" | "weth" | "stablecoin" | "bridge" | "ens" | "other"`.

### Why hand-curated and not, say, on-chain or live-fetched

- **Determinism.** Every developer / agent / CI run sees the same data.
- **No network at trust-evaluation time.** The popup must render fast.
- **No supply-chain risk.** A remote registry that the extension trusts is a
  prime target for compromise. Bundled-at-build-time is auditable in `git log`.
- **Small surface.** The set of contracts that genuinely matter for trust
  decisions in 2026 is in the hundreds, not millions.

### Where it lives

Two layers:

1. **Universal addresses** (`UNIVERSAL`) — contracts deployed at the same
   address on every EVM chain via canonical CREATE2 salts: Permit2, Seaport.
2. **Per-chain tables** (`BY_CHAIN`) — keyed by `chainId`. Currently covers
   Ethereum (1), Optimism (10), Polygon (137), Base (8453), Arbitrum (42161),
   BNB (56). Adding a new chain means adding a new top-level key.

### How to add an entry

```ts
// In packages/protocol-registry/src/index.ts
const BY_CHAIN: Record<number, Record<string, ProtocolInfo>> = {
  // ...
  10: {
    // ...
    "0xnew_address_lowercased": {
      protocol: "Aave",
      name: "Aave v3 Pool (Optimism)",
      kind: "lending",
    },
  },
};
```

Then add a unit test in `packages/protocol-registry/tests/index.test.ts` and
optionally a recognizer-trusted test if a new recognizer relies on it.

### How to make it better in the future

1. **Auto-ingest at build time** from a community-maintained address list
   (Uniswap's `@uniswap/contracts` deployments file, DefiLlama's protocols
   list, Trust Wallet asset list).
2. **Sourcify-name fallback as a soft signal.** If `lookupProtocol` returns
   null but Sourcify reports a `contractName` matching a small whitelist
   (`UniversalRouter`, `Pool`, `Vault`, …), surface as a soft trust signal.
3. **Per-chain RPC verification on first sight.** Hash the bytecode and
   compare against a known-good hash from the registry; detects malicious
   clones. Cache hits in `chrome.storage.local`.
4. **EIP-1967 proxy resolution.** Resolve proxy → implementation; both must
   be registered. Catches upgrade-based attacks.
5. **Signed registry blob fetched at install.** Separates code from data.

---

## Hardcoded data audit

| Location | Value | Why hardcoded | Move? |
|---|---|---|---|
| `packages/protocol-registry/src/index.ts` | All known protocol addresses | This **is** the source of truth. | No. Future: auto-ingest. |
| `packages/origin-trust/src/index.ts` | Known dApp directory | Same — the source of truth. | No. Future: auto-ingest. |
| `packages/decoder/src/recognizers/uniswapUniversalRouter.ts` | UR command id → name map; sentinel addresses (`0x...0001`, `0x...0002`); execute() selectors | Protocol semantics, not configurable. | No. |
| `packages/decoder/src/recognizers/aaveV3.ts` | Pool function selectors | Protocol semantics. | No. |
| `packages/token-metadata/src/index.ts` | Native sentinels per chain | Chain semantics. | No. |
| `apps/extension/src/shared/config.ts` | `JUDGE_BASE_URL = "http://127.0.0.1:8787"` | Local dev default. | Yes — replace with `import.meta.env.VITE_JUDGE_URL` once we deploy. |
| `apps/extension/src/shared/config.ts` | `JUDGE_API_KEY = "local-dev-key"` | Matches wrangler default. | Yes — should come from `.env`. |
| `apps/judge/src/openai.ts` | Default model `gpt-5.4` | Overridable via `OPENAI_MODEL`. | No. |
| `apps/judge/src/openai.ts` | `max_completion_tokens: 4000` | Reasoning headroom for gpt-5.x. | No. |
| `apps/judge/src/inferIntent.ts` | Default `gpt-5.1` | Overridable via `OPENAI_INFER_MODEL`. | No. |
| `apps/judge/src/anthropic.ts` | Default `claude-sonnet-4-6` | Overridable via `ANTHROPIC_MODEL`. | No. |
| `packages/tenderly-client/src/index.ts` | 12s default timeout | Overridable via `args.timeoutMs`. | No. |
| `apps/judge/wrangler.toml` | `JUDGE_API_KEY = "local-dev-key"` | Cloudflare-Worker var (committed). | Move to a Cloudflare secret for production. |
| `apps/extension/manifest.config.ts` | host_permissions = `http://*/*`, `https://*/*` | We need to intercept on every dapp. | Tighten before any Chrome Web Store submission. |
| `.env` (root) | `TENDERLY_*` | gitignored; consumed by Vite at extension build time. | Right place. |
| `apps/judge/.dev.vars` | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER` | gitignored; consumed by Wrangler. | Right place. |

Secrets verified gitignored: `.env`, `.env.local`, `.dev.vars`. Tenderly key
*is* baked into the extension bundle at build time (via `vite.define`); fine
for local dev, replace with backend proxy before any production build.

---

## Conventions

### TypeScript
- `noUncheckedIndexedAccess` is on. Array element access returns `T | undefined`.
- Discriminated unions on `kind` (DecodedAction) and `method` (WalletRequest).
- All workspace packages publish source directly via `main`/`types`/`exports`
  pointing at `./src/index.ts` — no build step required for cross-package use.

### Tests
- Vitest, run from each package via `pnpm test`. Aggregate via root `pnpm test`.
- Mock `fetch` via `vi.stubGlobal("fetch", ...)`.
- Hono handlers tested via `app.request("/path", { method, body })` — no real HTTP.
- Decoder tests round-trip real calldata via viem encoders.
- TDD: red → green → commit.

### Commits
- Imperative, no `Co-Authored-By` trailers. Each milestone closes with logical
  groups (feat / fix / chore).

### Adding a new finding code
1. Add the `code` and severity decision to `deterministicFindings()` in
   `apps/extension/src/background.ts`.
2. Update `apps/judge/src/prompt.ts` if the LLM should know its semantics
   (so it doesn't double-list).
3. Add a test in `apps/judge/tests/judge.golden.test.ts` if it should
   drive a verdict tier change.

### Adding a new chain
1. Add the chain id to `SUPPORTED_CHAIN_IDS` in `apps/extension/src/shared/config.ts`.
2. Add Tenderly's network slug to `CHAIN_ID_TO_NETWORK_ID` (usually equal to chain id).
3. Add known protocol addresses to `packages/protocol-registry/src/index.ts`.

### Adding a new protocol recognizer
1. Create `packages/decoder/src/recognizers/<protocol>.ts`. Export a
   `tryDecode<Protocol>(input: DecodeContext): DecodedAction | null`.
2. Register in `packages/decoder/src/recognizers/index.ts` — order matters,
   most specific first.
3. Add the protocol's known addresses to `packages/protocol-registry`.
4. If new `DecodedAction` variants needed, extend the union in
   `packages/types/src/index.ts`.
5. Tests: round-trip calldata through `decode()` and assert field values.
6. Update `packages/decoder/src/recognizers/<protocol>.ts` to set
   `decoded.trusted: boolean` from a registry hit.
7. Update `apps/judge/src/safetyFloor.ts` `isDeterministicallyTrusted` to
   include the new variant.

### Adding a new known dApp (origin trust)
1. Append an entry to the `KNOWN_DAPPS` array in
   `packages/origin-trust/src/index.ts` — `{ name, protocol, domains, what }`.
2. Add a unit test confirming `classifyOrigin("https://<domain>").kind === "trusted"`.

---

## Hackathon-readiness summary

**Done:**
- Browser extension MV3 + EIP-6963 + EIP-712 signature decoding.
- Decoder coverage: ERC-20, Uniswap UR (2-arg + 3-arg + V4 commands),
  Aave v3 Pool, Permit, Permit2 Single + Batch, Seaport orders.
- Hand-curated registry of canonical protocol addresses across 6 chains.
- Origin lookalike defense (Levenshtein + punycode).
- Sourcify + Tenderly integrations with timeouts.
- Designer's UI: ConfirmIntentScreen, VerdictScreen, EvziEyeLogo.
- Pipeline progress visible in popup (5 steps with per-step outcome tones).
- Judge backend with OpenAI (`gpt-5.4`) + Anthropic dispatch and
  `LLM_PROVIDER` env switch.
- LLM-driven `/infer-intent` endpoint (cheap model) for high-quality
  default intent summaries.
- Two-way safety floor / trust ceiling.
- Token-decimals formatting in net-effect display.
- Demo phishing scenarios at `apps/demo-pages/`.
- ~94 tests across 7 packages.

**Next milestones (post-hackathon stretch):**
- M2.9 — auto-ingest from `@uniswap/contracts` deployments JSON + DefiLlama.
- Token metadata RPC fallback (when Tenderly returns no `token_info`).
- Permit2-into-UR composite flow ("approve + swap" as one logical operation).
- Move Tenderly behind the judge backend (no more keys in extension bundle).
- Tighten manifest host_permissions before Chrome Web Store submission.
- Compound v3 / Lido stake-eth recognizers.
