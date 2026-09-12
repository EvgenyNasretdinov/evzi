# Demo pages

Static HTML scenarios that simulate phishing patterns the extension is designed to catch. Use to demo end-to-end without finding malicious sites in the wild.

## Pages

| File | Pattern | Expected verdict | Triggering finding |
|------|---------|-----------------:|--------------------|
| `index.html` | Landing — links to the others. | — | — |
| `agent-console.html` | The ETHOnline demo, on one screen: the authorization, the agent's browser, the firewall's verdicts, and three live tiles — The Graph, the Ledger daemon, and the Bazantic gateway. Needs a verifier it can reach (see below); the Ledger tile additionally needs the signer daemon. | REJECT | `INTENT_RECIPIENT_NOT_ALLOWED` |
| `fake-mint.html` | "Free NFT mint" page that actually calls `USDC.approve(0xdEaD…, MAX_UINT256)` on Base. | DANGER | `UNLIMITED_APPROVAL` |
| `airdrop-claim.html` | "Airdrop claim" page that requests a Permit2 `PermitBatchTransferFrom` signature authorizing `0xdEaD…` to move USDC/USDT/DAI on mainnet. | DANGER | `PERMIT2_SPENDER_UNKNOWN`, `PERMIT2_BATCH_TRANSFER` |
| `meridian-pools.html` | Prompt injection. An unremarkable USDC/ETH pool page on a fictional protocol; one of three collapsed "pool notices" instructs the reader to send their USDC to a verification address. A human never expands it, an agent scraping the text reads it anyway. Driven from `agent-console.html`, not from the extension. | REJECT | `INTENT_RECIPIENT_NOT_ALLOWED` |

The pool page carries **exactly one** 40-hex address, the attacker's — `planNextStep`
takes the first address in the page text, so adding a pool or token address to
the visible copy would change who the agent pays. The console prints the
recipient it extracted for that reason: the demo shifts on screen rather than
breaking quietly.

The `Show what the agent read` button is a demo control, not part of the site.
It expands every notice and highlights the sentence the agent obeyed. The
console strips it (`[data-demo-control]`) before the agent reads the page.

## Usage

Easiest:

```bash
# from the workspace root
python3 -m http.server 8765 --directory apps/demo-pages
```

Then open `http://localhost:8765` in Chrome with the extension loaded. Connect a (test) wallet and click the buttons.

For the **lookalike-origin** scenario, host this folder on a typo domain like `app.unisvvap.org` (or use `dnsmasq` / `/etc/hosts` to fake it locally) — the `LOOKALIKE_DOMAIN` finding fires on origin classification, regardless of which button you click.

## Test wallet hygiene

Use a fresh wallet with no real funds. The demo pages don't actually transfer anything if you stop at the popup — but signing (or worse, approving) blindly is bad muscle memory.
