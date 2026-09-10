# Bazantic gateway and recipe

**Gateway:** `https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com`
**MCP:** `https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com/mcp/` — the trailing
slash is required; the CLI reports the path without it and that 404s.
**Slug:** `265fdbq4xnaoda4pekavdnzcje` · **Account:** evgeny.nasretdinov@gmail.com

Three tools are generated from our OpenAPI `operationId`s: `info`,
`planNextStep`, `verifyProposal`.

## The recipe

`recipe.json` holds every field the web wizard asks for. It is checked in so the
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
a genuine hash, and the output is the actual response from the deployed gateway
for that exact input, not an invented one.

## Reproducing the A/B through the gateway

```bash
export OPENAI_API_KEY=...
export BAZANTIC_GATEWAY_URL=https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com
pnpm --filter @intent-check/judge ab
```

No API key is exported: the gateway holds the credential and injects it
upstream. Results are in [`../ab/RESULTS.md`](../ab/RESULTS.md).
