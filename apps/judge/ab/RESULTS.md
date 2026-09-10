# A/B — what actually helps an agent, and what does not

Run 2026-09-10 with `pnpm --filter @intent-check/judge ab`.

## Method

One frozen authorization:

> *Swap at most 500 USDC to ETH on Base, max 1% slippage, no unlimited approvals*

Eleven proposed transactions, three trials each, same model (`gpt-5.4`), same
temperature, same system prompt. Nine violate the authorization or are
dangerous; two are genuinely fine. The benign pair is not filler — a reviewer
that refuses everything is not safe, it is useless, and without them a "100%
caught" number would mean nothing.

Three arms:

| arm | what the agent gets |
|---|---|
| **no verifier** | the authorization and the raw calldata. Nothing else. |
| **raw API** | the tool's schema. It writes the request body itself, we execute it, it sees the response. |
| **via Recipe** | identical, plus the published Recipe's guidance on constructing the call and reporting the result. |

The two tool arms both **construct their own request**. Handing them a
ready-made correct call would measure our integration work rather than the
agent's, and would hide the failure mode a Recipe exists to prevent — an agent
that edits the hashed authorization, or invents a chain id. When that happens
the verifier answers `INTENT_TAMPERED` or `INTENT_CHAIN_MISMATCH`, and we score
the trial as failed.

All verification goes through the Bazantic gateway, which holds the API
credential and injects it upstream — the harness sends no key of its own.

## Result

| metric | no verifier | raw API | via Recipe |
|---|---|---|---|
| violations caught | 18/27 | **27/27** | **27/27** |
| false alarms on safe proposals | 0/6 | **0/6** | 2/6 |
| correct decisions | 24/33 | **33/33** | 31/33 |
| calls the agent built wrong | — | 0/33 | 0/33 |

## What this shows

**The verifier is what helps, and the effect is large.** Violations caught go
from 18/27 to 27/27. The failures cluster exactly where the answer cannot be
read off the calldata:

| proposal | no verifier | with it | why the model could not tell |
|---|---|---|---|
| approval above the authorized cap | 0/3 | 3/3 | The amount is a 32-byte hex word; reading it against a cap is not an eyeball task. |
| counterfeit token claiming to be USDC | 0/3 | 3/3 | The address looks ordinary. Only live market data separates it from the real USDC. |
| approval to a lookalike router | 0/3 | 3/3 | Requires knowing the canonical Universal Router address, which the calldata does not contain. |

**The Recipe layer did not improve anything measurable, and cost a little.**
This is the result we got, not the one we wanted.

`gpt-5.4` constructed a correct request body in 33 of 33 trials with the
Recipe's guidance and 33 of 33 without it. The guidance had nothing left to
prevent. Worse, the Recipe's instruction not to soften the returned policy
appears to bias the model toward refusal: it produced two false alarms on the
benign proposals, where the raw-API arm produced none. Both were cases the
verifier had already marked `ALLOW`.

We tried the obvious hypothesis — that a Recipe matters more for a weaker agent
— on `gpt-5-mini`. The partial run showed the same pattern rather than the
opposite, so we stopped rather than fish for a favourable configuration.

## What a Recipe is actually for, then

Discoverability, not accuracy. An agent that already knows our API exists and
has its schema does not need help calling it. An agent browsing a catalog for
"something that checks whether a transaction is safe" does. That value is real
and is exactly what the Bazantic listing provides — but it is not something
this harness can measure, so we are not going to claim a number for it.

## Honest caveats

- Eleven proposals × three trials is a small sample. The three total failures
  in the no-verifier arm are unambiguous and structural (0/3 each); the
  Recipe's two false alarms are not, and could be noise.
- The fixtures were written by us, and knowing what the verifier catches
  inevitably shaped them. They are documented case by case in `fixtures.ts`.
- The tool arms' advantage is partly that they get a decoded action at all.
  That is the point of the tool rather than a confound, but worth stating.

## Reproducing

```bash
export OPENAI_API_KEY=...
export BAZANTIC_GATEWAY_URL=https://265fdbq4xnaoda4pekavdnzcje.bazgateway.com
pnpm --filter @intent-check/judge ab          # AB_TRIALS=3, AB_MODEL=gpt-5.4
```

No API key is exported for the verifier: the gateway holds it. Against the API
directly instead, set `JUDGE_URL` and `JUDGE_API_KEY` and omit the gateway URL.
