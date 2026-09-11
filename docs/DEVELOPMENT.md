# Development

Prereqs: **Node 20+, pnpm 9, Chrome or Arc.**

```bash
pnpm install
```

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

## 1. Backend (judge + intent inference)

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

## 2. Extension

```bash
pnpm --filter @intent-check/extension build
# chrome://extensions → Developer mode ON → Load unpacked → apps/extension/dist
```

The build points at the deployed judge by default, so a freshly built
extension works without running a backend. It needs `JUDGE_API_KEY` in the
workspace `.env` to authenticate. To run against a local worker instead, add
`JUDGE_BASE_URL=http://127.0.0.1:8787` and rebuild.

Both are baked into the bundle at build time, so `dist/` contains whatever key
you built with — it is gitignored for that reason.

## 3. Tenderly simulation (optional)

Without Tenderly the extension still runs — the verdict just skips the
simulation row. To enable, put your creds in the workspace `.env`:

```
TENDERLY_ACCESS_KEY=<X-Access-Key>     # dashboard.tenderly.co/account/authorization
TENDERLY_ACCOUNT_SLUG=<account-slug>
TENDERLY_PROJECT_SLUG=<project-slug>
```

Vite injects them at extension build time.

## 4. UI preview (no extension reload needed)

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

- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) — it has explicit
  recipes for adding a new chain, protocol, finding code, recognizer, or
  known dApp.
- TDD discipline on decoders and findings: red → green → commit.
- Commits: imperative mood, no AI co-author trailers.

