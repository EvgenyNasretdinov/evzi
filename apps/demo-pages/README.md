# Demo pages

Static HTML scenarios that simulate phishing patterns the extension is designed to catch. Use to demo end-to-end without finding malicious sites in the wild.

## Pages

| File | Pattern | Expected verdict | Triggering finding |
|------|---------|-----------------:|--------------------|
| `index.html` | Landing — links to the others. | — | — |
| `fake-mint.html` | "Free NFT mint" page that actually calls `USDC.approve(0xdEaD…, MAX_UINT256)` on Base. | DANGER | `UNLIMITED_APPROVAL` |
| `airdrop-claim.html` | "Airdrop claim" page that requests a Permit2 `PermitBatchTransferFrom` signature authorizing `0xdEaD…` to move USDC/USDT/DAI on mainnet. | DANGER | `PERMIT2_SPENDER_UNKNOWN`, `PERMIT2_BATCH_TRANSFER` |

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
