# Evzi

> **The agent who reads the wallet popup so you don't have to.**

Evzi is a browser extension that watches the dApp page, decodes the wallet
request, simulates the transaction, looks up the contract, checks the origin,
and asks an LLM judge to compare it all against what the user actually meant
to do — before the user signs.

The verdict is one of `SAFE`, `CAUTION`, or `DANGER`, with a one-sentence
headline and a checklist of every signal we considered.

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

## What Evzi catches today

- **Calldata-vs-intent mismatches**. "Free NFT mint" page actually calls
  `USDC.approve(0xdEaD…, MAX_UINT256)` → DANGER, headline names the spender.
- **Permit2 / Permit / Seaport drainers** off-chain via signature requests,
  not transactions. Most wallets don't even simulate these — Evzi does.
- **Lookalike domains** — `unisvvap.org` ≠ `uniswap.org`, `xn--…` punycode.
- **Unverified routers / fresh contracts**. Cross-checks Sourcify and a
  hand-curated registry of canonical Uniswap, Aave, Permit2, Seaport, ENS,
  WETH and stablecoin deployments.
- **Multi-asset wrap-swap-unwrap flows** that look "complex" but are normal
  Uniswap behavior — the agent knows the difference.

Threat classes explicitly out of scope today: protocol-economic attacks
(MEV, oracle manipulation), honeypot tokens, mobile/WalletConnect flows.

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
    ├── ARCHITECTURE.md         # ← read this first
    └── superpowers/specs/…     # original design + implementation plan
```

For the full architecture (component diagram, dataflow, trust model, registry
explainer, "how to add X" recipes), read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

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

Build it once, then load unpacked:

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

Vite injects them at extension build time. (For runtime override during
testing you can also paste into `chrome.storage.local`.)

### 4. UI preview (no extension reload needed)

For iterating on the popup in isolation with mock states:

```bash
pnpm --filter @intent-check/extension dev:preview
```

Scenario picker URL: `http://localhost:<port>?scenario=verdict_safe`. Variants:
`idle`, `awaiting_confirm`, `judging_sim`, `judging_llm`, `error`,
`verdict_safe`, `verdict_caution`, `verdict_danger`.

## Demo

Two static phishing scenarios live at `apps/demo-pages/` so you can demo Evzi
end-to-end without finding malicious sites in the wild.

```bash
python3 -m http.server 8765 --directory apps/demo-pages
# open http://localhost:8765
```

| Scenario | What it does | Expected verdict |
|---|---|---|
| `fake-mint.html` | Pretty NFT mint page that actually calls `USDC.approve(MAX)` | DANGER · `UNLIMITED_APPROVAL` |
| `airdrop-claim.html` | Pretty airdrop page that asks for a Permit2 batch transfer signature | DANGER · `PERMIT2_SPENDER_UNKNOWN` |

Use a fresh test wallet. The pages don't actually move funds if you stop at
the Evzi popup — but signing blindly is bad muscle memory either way.

## Tests

```bash
pnpm test
```

Roughly 100 tests across decoder, judge, origin-trust, protocol-registry,
sourcify-client, tenderly-client, token-metadata.

## Contributing

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — it has explicit
  recipes for adding a new chain, protocol, finding code, or recognizer.
- TDD discipline on decoders and findings: red → green → commit.
- Commits: imperative mood, no AI co-author trailers.
