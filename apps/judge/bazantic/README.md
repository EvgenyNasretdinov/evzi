# Bazantic gateway and recipe

**Gateway:** `https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com`
**MCP:** `https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com/mcp/` — the trailing
slash is required; the CLI reports the path without it and that 404s.
**Slug:** `265fdbq4xnaoda4pekavdnzcje` · **Account:** evgeny.nasretdinov@gmail.com

Three tools are generated from our OpenAPI `operationId`s: `info`,
`planNextStep`, `verifyProposal`.

**Published recipe:** https://bazantic.com/recipes/on-chain-transaction-authorization-verifier

## The recipe

`recipe.json` mirrors the published recipe field for field. It is checked in so the
published recipe has a reviewable source, rather than existing only inside a
dashboard.

Two things about it are deliberate:

- **The authorization is an input, never something the recipe builds.** It is
  hashed over canonical JSON, so a recipe that assembled or edited one would
  produce something that fails its own integrity check. The prompt says so
  explicitly, because a helpful model will otherwise try to "fix" it.
- **The prompt forbids softening the policy.** The policy is derived from the
  human's own constraints, deterministically, without a model in the loop. A
  recipe that let the model talk itself past a `REJECT` would defeat the point
  of having the verifier at all — so the model may disagree out loud, but only
  after stating the verdict it was given.

`input_example` and `output_example` are real: the example authorization carries
a genuine hash, and the output is what the published recipe actually produced on
its test run, not an invented sample.

### What the wizard drafted, and what had to be corrected

The wizard drafts a recipe from a plain-language description. Three of its
guesses would have shipped a broken recipe:

- **A fabricated authorization example** with a made-up hash and fields our API
  does not have (`maxValue`, `allowedTargets`, `allowedFunctions`). Anyone
  testing with it would have got `INTENT_TAMPERED` and concluded the recipe was
  broken. Replaced with a real authorization and its genuine hash.
- **A fabricated gateway endpoint**, `https://firewall.evzi.io/api/v1/verifyProposal`
  — a domain that does not exist — added as a required caller input. Removed:
  the endpoint comes from the tool binding, not from whoever calls the recipe.
- **`proposed_calls` typed as an array of calldata strings.** Our verifier needs
  `{chainId, from, to, data}` objects; bare calldata would have forced the model
  to invent the chain and the addresses. The wizard's array item type only
  offers scalars, so the field is a JSON string instead.

None of these are visible without checking the drafted values against the API
they are supposed to call.

## Reproducing the A/B through the gateway

```bash
export OPENAI_API_KEY=...
export BAZANTIC_GATEWAY_URL=https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com
pnpm --filter @intent-check/judge ab
```

No API key is exported: the gateway holds the credential and injects it
upstream. Results are in [`../ab/RESULTS.md`](../ab/RESULTS.md).
