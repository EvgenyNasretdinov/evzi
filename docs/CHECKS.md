# What Evzi checks, and why

This is the detail behind the summary in the [README](../README.md). Nothing
here is new — it is the same material, moved out so the entry point stays
readable.

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

