# intent-check

Tells you whether a Web3 transaction matches your stated intent before you sign it.

- Browser extension (Chromium MV3) intercepts wallet requests, decodes calldata locally, simulates via Tenderly, looks up source via Sourcify, and asks an LLM judge for a verdict.
- Backend (`apps/judge`) is a single `/judge` endpoint that wraps Anthropic with a safety-floor post-process.
- See `docs/superpowers/specs/2026-05-08-intent-check-design.md` for full design.

## Local dev

Prereqs: Node 20+, pnpm 9, Chrome.

```bash
pnpm install

# Terminal 1: judge backend
cp .env.example apps/judge/.dev.vars   # edit to add ANTHROPIC_API_KEY
pnpm --filter @intent-check/judge dev

# Terminal 2: build the extension once, then load it unpacked
pnpm --filter @intent-check/extension build
# Open chrome://extensions, enable Developer mode, "Load unpacked" -> apps/extension/dist
```

In any tab's DevTools console, set Tenderly creds for the extension:

```js
chrome.storage.local.set({
  tenderly_key: "<X-Access-Key>",
  tenderly_account: "<account-slug>",
  tenderly_project: "<project-slug>",
});
```

## Tests

```bash
pnpm test
```
