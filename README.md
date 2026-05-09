# Evzi

> **Understands what you're trying to do, runs every safety check that matters, and explains why — before you sign.**

Most wallet popups ask you a question you can't actually answer: "approve this
transaction?" — when you have no way to know what the bytes mean, whether
the contract is real, whether the website is who it claims to be, or what
will actually happen if you sign.

Evzi closes that loop. The user types (or just confirms) what they're trying
to do in plain English. Evzi reads the dApp page, decodes the calldata or
signature, looks the contract up in a curated registry, queries Sourcify for
verification, simulates the transaction against a live fork, classifies the
domain against known phishing patterns, and asks an LLM judge to compare
everything against the stated intent. The verdict is one sentence + a
checklist of every signal we considered:

```
┌─────────────────────────────────────────┐
│ All looks good                          │
│ This looks like a normal Uniswap swap.  │
│                                         │
│ ✓ Decoded as Uniswap swap               │
│   V3_SWAP_EXACT_IN → UNWRAP_WETH        │
│ ✓ Trusted Uniswap UniversalRouter v2    │
│ ✓ Simulation succeeded · 5 changes      │
│   Net effect: −0.0007 ETH, +8.65 OP     │
│ ✓ Output goes to your wallet            │
│ ✓ Origin: Uniswap (verified)            │
│                                         │
│ [ Continue signing ]   [ Reject ]       │
│                                         │
│ Judge: openai · gpt-5.4                 │
└─────────────────────────────────────────┘
```

## Why a checklist, not a verdict

You can build a wallet that just says **DANGER, blocked**. We chose not to.

Two reasons:

1. **Users learn from seeing the work.** Every row in the checklist names a
   specific check, what it found, and why it matters. After a few sessions,
   users start recognizing the patterns themselves — "wait, this is a
   Permit2 signature to an unknown spender" — without needing the agent.
2. **The agent will sometimes be wrong.** When the deterministic checks
   disagree with the LLM, both sides are visible. The user can see the raw
   evidence and decide. Trust isn't a black box.

## The user-intent loop

Evzi infers intent in three places, each with rising specificity:

1. **From the dApp page.** Click context capture records what the user
   actually clicked ("Swap" button in the "Swap" panel) plus visible form
   inputs and surrounding text — the moment the wallet request fires. A
   small LLM (`gpt-5.1`) turns that snapshot into a concrete summary like
   *"Swap 0.0007 ETH for 8.65 OP on Uniswap"* — not "Approve transaction".
2. **From the user.** The popup shows the inferred intent and lets the user
   edit it or pick a different kind. If something feels off, a textarea
   appears under the toggle so the user can tell the agent *what* feels
   wrong — that note flows into the judgment as additional context.
3. **From the calldata.** The deterministic decoder produces a structured
   `DecodedAction` (swap / approve / permit / Permit2 transfer / Seaport
   order / Aave supply…). This is the ground truth the LLM compares the
   stated intent against.

When intent and decoded action disagree — "I'm minting an NFT" vs "the
calldata is `USDC.approve(MAX)`" — the verdict is DANGER and the headline
names the mismatch. This is the canonical drainer pattern: a friendly UI
for one thing, a wallet request for something else.

## Every check we run

Evzi runs each of these on every transaction or signature, sequentially,
and surfaces the outcome in the popup so the user sees what happened.

| Layer | What it does | Catches |
|---|---|---|
| **Decoder** | Recognizes ERC-20, Uniswap UR, Aave v3, Permit, Permit2 (single & batch), Seaport. Unknown calldata is flagged. | Hidden approvals, mislabeled actions, signature drainers. |
| **Protocol registry** | Hand-curated cross-chain whitelist of canonical Uniswap, Aave, Permit2, Seaport, ENS, WETH, stablecoin addresses. | Spoof contracts that look like real ones; trust signals that don't depend on Sourcify. |
| **Sourcify** | Queries the verified-source database for the target. | Fresh, unverified, or partial-match contracts. |
| **Simulation** | Tenderly runs the tx against a live fork; we extract per-asset signed deltas for the user's wallet. | Outcomes the user wouldn't expect — assets leaving the wallet, wrapping/unwrapping flows, reverts. |
| **Recipient resolution** | Resolves Uniswap UR sentinel addresses (`0x…0001` = msg.sender, `0x…0002` = router-self). | False positives that flag normal Uniswap routing as "third-party drain". |
| **Origin trust** | Bundled list of 15+ canonical dApp domains; Levenshtein distance check; punycode detection. | Lookalike sites (`unisvvap.org`), IDN-homograph attacks, page-title-impersonation. |
| **Click + form context** | Document-level click capture records the button text and the surrounding form values + section heading. | Pages that say one thing visually but trigger another in the wallet. |
| **Deterministic findings** | A list of explicit codes: `UNLIMITED_APPROVAL`, `PERMIT2_BATCH_TRANSFER`, `SEAPORT_ZERO_PRICE_OFFER`, `LOOKALIKE_DOMAIN`, etc. | Each finding has a name and an explanation; the agent can't soften them. |
| **LLM judgment** | Compares stated intent against decoded action + simulation + findings. | Subtle mismatches the deterministic layer can't articulate. |
| **Safety floor + trust ceiling** | Two-way constraint: the LLM can't soften a deterministic DANGER, and can't escalate a vetted protocol to DANGER on a hunch. | False positives on real flows; false negatives that look benign to the LLM. |

## What Evzi explicitly catches today

- **"Free NFT mint" → `USDC.approve(0xdEaD…, MAX_UINT256)`** — the page
  description doesn't match the calldata. DANGER.
- **Permit2 batch transfer to an unknown spender** — the off-chain
  signature drainer most users don't even realize is dangerous because
  it bypasses simulation entirely. DANGER, headline names the spender
  and the tokens at risk.
- **Lookalike origin** — `unisvvap.org`, `xn--…` punycode, `aavve.com`.
  DANGER, headline calls out the visual deception.
- **Unverified-but-known router** — Uniswap deploys faster than Sourcify
  verifies. The registry trumps Sourcify; the verdict explains why.
- **Multi-asset wrap-swap-unwrap on Uniswap** — looks "complex" to a
  naïve LLM but is the most common Uniswap flow. The agent knows.

## What's out of scope

- Protocol-economic attacks (MEV, oracle manipulation, slippage parameter
  abuse). Different problem; better served by Rabby / Blockaid.
- Honeypot tokens (can't sell, fee-on-transfer surprises). Specialized
  on-chain analysis, not in our threat model.
- Mobile / WalletConnect flows. Evzi is a browser extension that hooks
  the in-page provider; WalletConnect bypasses that entirely.

## Repo layout

```
intent-check/
├── apps/
│   ├── extension/      # MV3 Chromium extension (popup, content-script, background)
│   ├── judge/          # Hono backend on Cloudflare Workers (or Node)
│   └── demo-pages/     # static HTML scenarios for the hackathon demo
├── packages/
│   ├── types/             # shared TypeScript types, no runtime deps
│   ├── decoder/           # ERC-20, Uniswap UR, Aave v3, EIP-712 typed-data
│   ├── protocol-registry/ # hand-curated cross-chain known-address book
│   ├── origin-trust/      # known-dApps + Levenshtein/punycode lookalike check
│   ├── sourcify-client/   # contract-verification lookup
│   ├── tenderly-client/   # transaction simulation
│   └── token-metadata/    # ERC-20 symbol/decimals + amount formatting
└── docs/
    ├── ARCHITECTURE.md         # ← read this for the full system
    └── superpowers/specs/…     # original design + implementation plan
```

## Local dev

Prereqs: **Node 20+, pnpm 9, Chrome or Arc.**

```bash
pnpm install
```

### 1. Backend (judge + intent inference)

Create `apps/judge/.dev.vars` with at least one LLM key:

```
# Default: OpenAI. Latest model used is gpt-5.4 (override with OPENAI_MODEL).
OPENAI_API_KEY=sk-...

# Optional: Anthropic. Use only if you set LLM_PROVIDER=anthropic too.
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Force which provider /judge uses regardless of which keys are set.
LLM_PROVIDER=openai

# Optional: a different model for the cheap /infer-intent endpoint.
OPENAI_INFER_MODEL=gpt-5.1   # default
```

Then start it:

```bash
pnpm --filter @intent-check/judge dev
```

The Worker exposes:

- `GET  /judge/info`     — `{ provider, model }` (unauthenticated)
- `POST /judge`          — main verdict endpoint
- `POST /infer-intent`   — LLM-driven intent inference for the confirm screen

### 2. Extension

```bash
pnpm --filter @intent-check/extension build
# chrome://extensions → Developer mode ON → Load unpacked → apps/extension/dist
```

### 3. Tenderly simulation (optional)

Without Tenderly the extension still runs — the verdict just skips the
simulation row. To enable, put your creds in the workspace `.env`:

```
TENDERLY_ACCESS_KEY=<X-Access-Key>     # dashboard.tenderly.co/account/authorization
TENDERLY_ACCOUNT_SLUG=<account-slug>
TENDERLY_PROJECT_SLUG=<project-slug>
```

Vite injects them at extension build time.

### 4. UI preview (no extension reload needed)

For iterating on the popup in isolation with mock states:

```bash
pnpm --filter @intent-check/extension dev:preview
```

Scenario picker: `http://localhost:<port>?scenario=verdict_safe`. Variants:
`idle`, `awaiting_confirm`, `judging_sim`, `judging_llm`, `error`,
`verdict_safe`, `verdict_caution`, `verdict_danger`.

## Demo

Two static phishing scenarios live at `apps/demo-pages/` so you can demo
Evzi end-to-end without finding malicious sites in the wild.

```bash
python3 -m http.server 8765 --directory apps/demo-pages
# open http://localhost:8765
```

| Scenario | What it does | Expected verdict |
|---|---|---|
| `fake-mint.html` | Pretty NFT mint page that actually calls `USDC.approve(MAX)` | DANGER · `UNLIMITED_APPROVAL` |
| `airdrop-claim.html` | Pretty airdrop page that asks for a Permit2 batch transfer signature | DANGER · `PERMIT2_SPENDER_UNKNOWN` |

Use a fresh test wallet. The pages don't actually move funds if you stop
at the Evzi popup — but signing blindly is bad muscle memory either way.

## Tests

```bash
pnpm test
```

Roughly 100 tests across decoder, judge, origin-trust, protocol-registry,
sourcify-client, tenderly-client, token-metadata.

## Contributing

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — it has explicit
  recipes for adding a new chain, protocol, finding code, recognizer, or
  known dApp.
- TDD discipline on decoders and findings: red → green → commit.
- Commits: imperative mood, no AI co-author trailers.
