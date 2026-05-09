# intent-check

Tells you whether a Web3 transaction matches your stated intent before you sign it.

- Browser extension (Chromium MV3) intercepts wallet requests, decodes calldata locally, simulates via Tenderly, looks up source via Sourcify, and asks an LLM judge for a verdict.
- Backend (`apps/judge`) is a single `/judge` endpoint that wraps either OpenAI (gpt-5.2 default) or Anthropic with a safety-floor post-process.
- See `docs/superpowers/specs/2026-05-08-intent-check-design.md` for full design.

## Local dev

Prereqs: Node 20+, pnpm 9, Chrome / Arc.

```bash
pnpm install

# Terminal 1: judge backend
# Create apps/judge/.dev.vars with at least one LLM key:
#   OPENAI_API_KEY=sk-...        # default: gpt-5.2
#   OPENAI_MODEL=gpt-5.4         # override (optional)
#   ANTHROPIC_API_KEY=sk-ant-... # used if OPENAI_API_KEY is not set
pnpm --filter @intent-check/judge dev

# Terminal 2: build the extension once, then load it unpacked
pnpm --filter @intent-check/extension build
# Open chrome://extensions, enable Developer mode, "Load unpacked" -> apps/extension/dist
```

### Optional: Tenderly simulation

Without Tenderly creds the extension still runs — the verdict just won't include
a simulation. The popup details show "Simulation skipped (Tenderly not configured)".

To enable, paste in any tab's DevTools console:

```js
chrome.storage.local.set({
  tenderly_key: "<X-Access-Key>",         // dashboard.tenderly.co/account/authorization
  tenderly_account: "<account-slug>",     // your username or team slug
  tenderly_project: "<project-slug>",     // project slug
});
```

### UI preview

For designing the popup in isolation with mock states (no extension reload needed):

```bash
pnpm --filter @intent-check/extension dev:preview
# opens a Vite dev server with a scenario picker (idle / awaiting confirm / safe / caution / danger)
```

## Tests

```bash
pnpm test
```
