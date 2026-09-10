<p align="center">
  <img src="./assets/Eye.png" alt="Evzi logo" width="120" />
</p>

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

![Evzi popup catching a fake "free NFT mint" that's actually an unlimited USDC approval](./assets/screenshots/popup-fake-mint.jpeg)

## Now also: a firewall for AI agents

Built during ETHOnline 2026. The question above is *"does this request match
what the dApp claims?"* — this is the harder one: **does this agent's proposed
action still match what the human actually authorized?**

You state a goal once. Evzi freezes it into an `AuthorizedIntent` — a hashed,
immutable record of what you agreed to, with machine-readable constraints
(chain, token, spend cap, recipients, whether unlimited approvals are allowed
at all). An agent then proposes transactions. Every proposal is checked back
against that frozen authorization and reduced to one of three outcomes:

```
ALLOW              stays inside what you authorized
REQUIRE_APPROVAL   a human needs to look at this
REJECT             violates an explicit constraint
```

The policy is derived from deterministic findings, not from the model. A
confident LLM verdict cannot talk the pipeline out of a rejection — there is a
test named for exactly that.

Watch it happen:

```
Agent, attempt 1:  approve(USDC, MAX_UINT256)
                   "so I don't have to ask again on later swaps"
Evzi:              REJECT · INTENT_UNLIMITED_APPROVAL_FORBIDDEN

Agent, attempt 2:  approve(USDC, 500000000)
                   "the verifier refused the unlimited allowance,
                    narrowing to exactly what you authorized"
Evzi:              ALLOW
```

The agent never sees the verifier's internals and cannot touch the
authorization. It only reads back the finding codes it was refused with.

The verifier is live at `https://intent-check-judge.evzi.workers.dev` (spec at `/openapi.json`).

Try it: `apps/demo-pages/agent-console.html`. The full submission write-up,
including what is and is not finished, is in [`HACKATHON.md`](./HACKATHON.md).

### What live on-chain data adds

Contract verification describes *code*. A counterfeit token's code is fine —
what gives it away is that no market exists behind it. Evzi asks The Graph:

```
real USDC (mainnet)   canonical=true    $1.03T volume, 8,787,430 holders
counterfeit "USDC"    canonical=false   → DANGER, and the verdict says why
```

Two Graph products are used together: the subgraph gateway answers in
200–500ms and is what the verdict waits on; the Token API answers in ~10s on
the free tier, so it runs in the background and enriches later checks from a
cache. A token is trusted if *either* can vouch for it.

### Hardware confirmation

`apps/ledger-signer` signs on a Ledger — but calls the verifier itself first,
rather than trusting whoever asked it to sign. A compromised extension cannot
obtain a signature for something your authorization forbids: on `REJECT` the
device is never even asked.

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
| **Proxy resolution** | Sourcify v2 detects EIP-1967, EIP-1822 UUPS, EIP-1167 minimal, Gnosis Safe, Diamond, etc., and resolves the implementation address. We treat the implementation's verification — not the proxy's — as trust. | Verified-proxy-with-malicious-impl backdoors. |
| **Deployment age** | Chain head (RPC) + Sourcify's `deployment.blockNumber` → contract age in days. | Brand-new rugpull contracts (< 24h flagged DANGER, < 7d flagged CAUTION). |
| **Author NatSpec** | Surfaces contract-author `userdoc.notice` strings (contract-level and per-function) into the verdict checklist. | Functions whose own NatSpec says *"this transfers ownership permanently"* while the dApp UI says *"claim airdrop"*. |
| **Generic ABI decoding** | When our specific recognizers miss but Sourcify has the ABI, we ABI-decode any verified function. | Going from "unknown call" → `swapExactTokensForTokens(…)` on Curve / GMX / Balancer for free, no per-protocol code needed. |
| **Simulation** | Tenderly runs the tx against a live fork; we extract per-asset signed deltas for the user's wallet. | Outcomes the user wouldn't expect — assets leaving the wallet, wrapping/unwrapping flows, reverts. |
| **Recipient resolution** | Resolves Uniswap UR sentinel addresses (`0x…0001` = msg.sender, `0x…0002` = router-self). | False positives that flag normal Uniswap routing as "third-party drain". |
| **Origin trust** | Bundled list of 15+ canonical dApp domains; Levenshtein distance check; punycode detection. | Lookalike sites (`unisvvap.org`), IDN-homograph attacks, page-title-impersonation. |
| **Click + form context** | Document-level click capture records the button text and the surrounding form values + section heading. | Pages that say one thing visually but trigger another in the wallet. |
| **Deterministic findings** | A list of explicit codes: `UNLIMITED_APPROVAL`, `PERMIT2_BATCH_TRANSFER`, `SEAPORT_ZERO_PRICE_OFFER`, `LOOKALIKE_DOMAIN`, etc. | Each finding has a name and an explanation; the agent can't soften them. |
| **Intent constraints** | Checks a proposal against the human's frozen authorization: chain, token, spend cap, recipients, unlimited approvals, expiry, and whether the authorization itself was edited after it was given. | An agent exceeding what it was actually allowed to do. |
| **Token market reality** | Asks The Graph whether a real market and a real holder population stand behind the token. | Counterfeit tokens carrying a blue-chip symbol — invisible to contract verification, since their code is fine. |
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
- **Verified proxy → fresh unverified implementation** — the upgrade-
  attack shape. The proxy's source is on Sourcify, looks legitimate, but
  it `delegatecall`s into a contract deployed an hour ago whose source
  nobody can read. Evzi recurses one hop, sees the impl is unverified
  (and brand-new), and escalates accordingly.
- **Author NatSpec contradicts the UI** — a function whose own
  `userdoc.notice` admits *"transfers ownership of the vault to the
  caller"* fired from a button labelled *"Claim rewards"*. Both strings
  end up in the checklist; the LLM judge calls out the divergence.

## Talk to Evzi (chat)

Every screen in the popup has a **Talk to Evzi** button. The chat overlay
is the teaching surface — it's where Evzi stops being a black-box "SAFE /
CAUTION / DANGER" oracle and starts being a personal Web3 analyst the user
can actually ask questions of.

It runs in two modes, and the popup picks automatically:

- **Verdict-aware mode** — opened from the verdict screen. Evzi receives the
  full `JudgeInput` (decoded action, simulation, findings, origin) and the
  verdict the user just saw. Replies cite the specific reasons: *"The
  Permit2 batch transfer would let `0xdEaD…` move 3 of your tokens with
  just a signature — no on-chain transaction. That's why it's DANGER."*
- **General mode** — opened from the idle screen. Evzi has no transaction
  context and answers as a Web3 safety teacher: *"What's an approval?"*,
  *"How do drainers usually work?"*, *"What does it mean that a contract
  isn't verified on Sourcify?"*

Why this matters: the verdict is one screen the user looks at for two
seconds before they sign. The chat is where they can learn *why* — once,
properly — and never make that class of mistake again. We treat security
as something to teach, not just gate.

The model has no live tools (no on-chain reads, no web search) and is told
not to recommend "sign / reject" — that's always the user's call.

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
│   │   └── ab/         # A/B experiment: agent with vs without the verifier
│   ├── ledger-signer/  # hardware signing daemon, gated by the verifier
│   └── demo-pages/     # static HTML scenarios, incl. the agent console
├── packages/
│   ├── types/             # shared TypeScript types, no runtime deps
│   ├── intent/            # frozen authorization, constraint verifier, policy
│   ├── onchain-context/   # The Graph: subgraph + Token API providers
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

Static scenarios live at `apps/demo-pages/` so you can demo Evzi end-to-end
without finding malicious sites in the wild.

```bash
python3 -m http.server 8765 --directory apps/demo-pages
# open http://localhost:8765
```

| Scenario | What it does | Expected verdict |
|---|---|---|
| `agent-console.html` | An AI agent proposes an unlimited allowance, is refused, reads the finding codes and corrects itself | REJECT then ALLOW |
| `fake-mint.html` | Pretty NFT mint page that actually calls `USDC.approve(MAX)` | DANGER · `UNLIMITED_APPROVAL` |
| `airdrop-claim.html` | Pretty airdrop page that asks for a Permit2 batch transfer signature | DANGER · `PERMIT2_SPENDER_UNKNOWN` |

The agent console talks to the judge worker, so start that first
(`pnpm --filter @intent-check/judge dev`).

Use a fresh test wallet. The pages don't actually move funds if you stop
at the Evzi popup — but signing blindly is bad muscle memory either way.

## Tests

```bash
pnpm test
```

287 tests. The largest suites are judge (80), intent (59), onchain-context
(48) and decoder (32); the rest cover origin-trust, sourcify-client,
token-metadata, protocol-registry, tenderly-client, the extension and the
Ledger signer.

No test touches the network. The provider tests use recorded fixtures, and the
live checks are separate scripts under `tests/live/` that are not part of the
suite.

## Contributing

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — it has explicit
  recipes for adding a new chain, protocol, finding code, recognizer, or
  known dApp.
- TDD discipline on decoders and findings: red → green → commit.
- Commits: imperative mood, no AI co-author trailers.
