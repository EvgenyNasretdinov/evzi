# Intent-Check for Web3 Transactions — Design

**Date:** 2026-05-08
**Status:** Draft for implementation planning

## Summary

A Chromium browser extension that intercepts wallet requests on a dApp page, infers the user's intent from the page, runs deterministic safety checks plus a Tenderly simulation, asks an LLM to compare the inferred intent against the simulated outcome, and shows a one-sentence verdict (`SAFE` / `CAUTION` / `DANGER`) before the user signs. Sourcify provides contract verification, ABI, and source code for any contract not in our hardcoded recognizer set.

The MetaMask Snap form factor is explicitly out of scope for now; the extension is a standalone Chromium MV3 extension.

## Product scope (MVP)

**What it is.** When a dApp triggers `eth_sendTransaction`, `eth_signTypedData_v4`, `personal_sign`, or `wallet_sendCalls`, the extension intercepts before the wallet popup, decodes/simulates the request, infers user intent from the dApp DOM, asks the user to confirm the inferred intent, and renders a verdict.

**Chains in scope.** Ethereum mainnet and Base.

**Hardcoded recognizers (MVP set).** Uniswap Universal Router, Uniswap v3 Router, Permit2, Seaport, Aave v3 Pool, Across/Hop bridge, USDC, USDT, WETH, ENS Registrar.

**Fallback path.** Any contract not in the recognizer set is decoded via Sourcify ABI, then via 4byte directory as a last resort.

**Intent capture.** Auto-inferred from the dApp page (title, OG tags, visible button text near the active element, origin, favicon hash) with a "this looks like X — confirm or edit" step. No free-text entry path in v1.

**Out of scope (v2+).** MEV/slippage analysis, honeypot/fee-on-transfer detection, non-EVM chains, MetaMask Snap packaging, mobile wallets, multisig flows.

## Threat model

**Attacker model.** A motivated phisher controls some combination of: a malicious dApp page (own domain or lookalike), a malicious contract on-chain, a compromised front-end of a real dApp (DNS hijack, dependency injection), or a malicious typed-data signature request that drains via Permit2 / Seaport. We assume the user's wallet, browser, and the extension itself are not compromised. We assume the backend is honest-but-curious; the extension only sends abstracted `{intent, decodedAction, simResult, contractMeta, originSignals}` — never raw browsing.

**Attacks in scope and how we detect them.**

| Attack | Detection |
|---|---|
| Calldata claims one thing, does another | ABI decode + recognizer match against inferred intent |
| Unlimited / surprise approval | Recognizer flags `approve(_, MAX_UINT)` and `setApprovalForAll(true)` to non-whitelisted spenders |
| Drainer via Permit / Permit2 / Seaport signature | EIP-712 decoder; signature requests are first-class |
| Tx routes through unverified or freshly-deployed contract | Sourcify lookup + on-chain deployment-block age |
| Net asset flow doesn't match intent | Tenderly simulation diff vs intent |
| dApp page lies about identity | Origin-vs-claimed-protocol check |
| Lookalike domain | Punycode + Levenshtein vs known-dApp list |

**Out of scope (documented honestly in the UI).** Protocol-economic attacks (MEV, oracle manipulation, slippage params), honeypot tokens (can't sell, fee-on-transfer surprises), coordinated DOM-and-calldata lies whose malicious effect only triggers post-block via upgradeable-proxy mid-tx swaps. We mitigate the last by trusting simulation over page claims when they conflict.

**Trust ranking when sources disagree (load-bearing rule):** `simulation result > on-chain code/Sourcify > dApp page DOM > user's stated intent`. If the page says "swap" but the simulation shows pure outflow, side with simulation and flag `DANGER`.

## Architecture

Two deployables: a browser extension and a backend service.

### Extension (Manifest V3, Chromium)

- **`content-script.js`** — injected into every page; scrapes intent signals (title, OG tags, visible button text near active element, origin/URL, favicon hash) and posts a snapshot to the background worker on each wallet request.
- **`inpage.js`** — injected into the page's main world; wraps `window.ethereum.request` and intercepts `eth_sendTransaction`, `eth_signTypedData_v4`, `personal_sign`, `wallet_sendCalls` *before* forwarding. Holds the request in a Promise until the verdict UI resolves it.
- **`background.js` (service worker)** — orchestrates: receives `{request, pageSnapshot, origin}` from inpage, runs the local Decoder pipeline, calls `/judge`, returns verdict to popup.
- **Popup UI (React)** — traffic-light verdict, one-sentence summary, expandable details (decoded action, asset diff, contract-trust signals, intent-vs-action diff). Buttons: `Sign anyway`, `Reject`, `Edit intent`.

### Decoder pipeline (deterministic, in-extension)

1. Parse calldata: function selector (4byte) + ABI decode. Source ABI from (a) bundled recognizers, (b) Sourcify by `chainId+address`, (c) 4byte directory.
2. Recognizer match: if `to` is a known protocol contract, run protocol-specific handler producing a structured `DecodedAction` (e.g., `{kind: 'swap', tokenIn, amountIn, tokenOut, minAmountOut, recipient, router}`).
3. Typed-data decoder for EIP-712: detect Permit / Permit2 / Seaport schemas; extract `{spender, token(s), amount(s), deadline}`.
4. Contract-trust probe: Sourcify verified? Deployment-block age? Proxy? Implementation address?
5. Tenderly simulation: POST `{from, to, input, value, chainId}` → asset_changes, balance_changes, decoded events.
6. Origin check: compare `origin` to recognizer's known dApp domains; punycode/Levenshtein against known-dApp list.

### Backend `/judge` (single endpoint)

- **Input:** `{intent, decodedAction, simResult, contractMeta, originSignals}` — abstracted, no raw browsing.
- **Model:** Anthropic `claude-sonnet-4-6` with structured output; prompt caching on the system prompt and tool definitions.
- **Tools (optional, for edge cases):** `lookup_protocol_docs(name)`, `lookup_token_metadata(chainId, address)`, `get_dapp_reputation(domain)`.
- **Output:** `{verdict: SAFE|CAUTION|DANGER, headline: string, reasons: [{severity, text}], confidence: 0..1}`.
- **Stateless;** rate-limit by IP and a shared API key baked into the extension build.

### Safety floor (load-bearing invariant)

The LLM cannot *upgrade* a finding's severity beyond what the deterministic layer flagged, and cannot *downgrade* a `DANGER` finding to `SAFE`. We post-process the LLM output against the deterministic findings list. Concretely: the verdict tier returned to the user is `max(deterministic_tier, llm_tier)`. The LLM's job is summarization and weighing within the bounds the deterministic layer set.

### Data flow (happy path)

```
dApp page  ──tx request──►  inpage.js ──►  background.js
                                              │
                                              ├──► content-script: page snapshot
                                              ├──► Decoder pipeline:
                                              │      Sourcify  ──► ABI
                                              │      Tenderly  ──► sim result
                                              │      RPC       ──► code/age/proxy
                                              │
                                              └──► POST /judge ──► Anthropic
                                                                  │
                                              ◄────────verdict ───┘
                                              │
                                              ▼
                                         popup UI ─► user decides ─► resolve/reject promise
                                                                       │
dApp page ◄──result of original request────────────────────────────────┘
```

## Stack

- **TypeScript** end-to-end, **pnpm** workspaces.
- Extension: **Vite + @crxjs/vite-plugin**, **React 18** popup.
- **viem** for ABI encoding/decoding, RPC, address utilities.
- Backend: **Hono**, deployable to **Cloudflare Workers** (free hosting, zero cold start) or Node.
- **Anthropic SDK** with `claude-sonnet-4-6`; prompt caching on system prompt + tool defs.

## Repo layout

```
intent-check/
├── apps/
│   ├── extension/          # MV3 extension
│   └── judge/              # Hono backend
├── packages/
│   ├── decoder/            # ABI + recognizers + EIP-712
│   ├── sourcify-client/
│   ├── tenderly-client/
│   └── types/              # DecodedAction, SimResult, Verdict, JudgeInput
└── docs/
```

## Implementation milestones

**M1 — Skeleton + happy path on one recognizer.** Extension intercepts `eth_sendTransaction`, opens popup with raw decoded calldata. Single recognizer: Uniswap Universal Router `execute`. `/judge` returns hard-coded `SAFE` for swaps. End-to-end click-to-popup-to-verdict on a real Uniswap swap on Base.

**M2 — Real judgment + Tenderly.** Wire `/judge` to Anthropic with structured output. Tenderly simulation integrated; asset_changes shown in details. Sourcify lookup for unknown contracts. Auto-inferred intent + confirmation step.

**M3 — Threat coverage breadth.** Recognizers for Permit2, Seaport, Aave v3, ERC-20 `approve`/`setApprovalForAll`. EIP-712 decoder for `eth_signTypedData_v4`. Contract-trust probe. Origin check.

**M4 — Demo polish.** Three canned scenarios in fixture mode. Visual polish. Loom backup.

## Test strategy

- Unit tests on each recognizer with fixture calldata.
- Integration test on `/judge` with 10 fixture scenarios (5 SAFE, 3 CAUTION, 2 DANGER); assert verdict tier, not exact wording.
- Manual E2E via the demo scenarios.

## Hackathon demo flow

**Scene 1 — The green path (60s).** `app.uniswap.org` on Base, swap 100 USDC → ETH. Green chip, headline matches intent. Sign → real tx submitted.

**Scene 2 — The hidden approval (90s).** Prepared `fake-mint.demo` page styled as an NFT mint actually triggers `USDC.approve(0xEvilSpender, MAX_UINT256)`. Red chip, headline `"Stop — this is not a mint. It would let an unknown contract spend all your USDC, forever."` Reject.

**Scene 3 — The Permit2 drainer (90s).** Prepared "airdrop claim" page asks for `eth_signTypedData_v4` with a Permit2 batch transfer authorization. Red chip, headline names the spender and the tokens at risk. Reject. Killer point: no transaction is being sent — simulation alone wouldn't catch this.

**Closing (30s).** Threat-model coverage table; architecture pitch.

### Demo robustness

- **Fixture mode** (`VITE_DEMO=1`): all three scenarios run against bundled fixture responses for Sourcify, Tenderly, and the LLM. Network-independent.
- **Live mode**: same flow against real APIs.
- **Loom backup**: full 4-min recording.
- **Wallet**: fresh demo wallet on Base with $5 USDC and 0.001 ETH. Only Scene 1 executes; Scenes 2 and 3 hit Reject before MetaMask appears.

## Open questions for implementation planning

- Cloudflare Workers vs Node deploy target for `/judge` — pick at plan time based on whether we need long-running Tenderly streaming.
- Whether to ship a tiny "known-dApp list" in the extension or fetch at startup from the backend (signed JSON).
- Exact set of EIP-712 schemas covered in M3 vs deferred — at minimum Permit, Permit2 `PermitTransferFrom` + `PermitBatchTransferFrom`, Seaport `OrderComponents`.
