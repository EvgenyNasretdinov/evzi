# Demo video script — 3 minutes

Target 2:45–3:00. The Graph and Bazantic both require 2–4 minutes.

**Before recording, have these ready:**

```bash
# 1. demo pages
python3 -m http.server 8765 --directory apps/demo-pages

# 2. point the console at the deployed verifier (browser console, once):
localStorage.setItem("evzi.judge", "https://intent-check-judge.evzi.workers.dev");
localStorage.setItem("evzi.key", "<contents of .judge-prod-key>");

# 3. hardware signer, in a visible terminal
export JUDGE_URL=https://intent-check-judge.evzi.workers.dev
export JUDGE_API_KEY=$(cat .judge-prod-key)
pnpm --filter @intent-check/ledger-signer start
```

Nano S: unlocked, **Ethereum app open**, **blind signing enabled**, Ledger Live
closed. Warm the Graph cache by loading the console once before recording —
otherwise the first verdict shows `degraded` and the holder count is missing.

---

## 0:00–0:20 · The problem

**Show:** the agent console, empty.

> Agents are getting wallets. The moment one has a key, the security question
> changes. It stops being "is this website lying to me" and becomes: "is this
> agent still doing what I actually asked?"
>
> Evzi was a transaction firewall for humans. This is what we built during
> ETHOnline: the same verifier, pointed at agents.

## 0:20–0:45 · Freezing the authorization

**Do:** the goal is pre-filled. Click **Freeze authorization**.
**Show:** the constraints line and `authorization #…` appearing.

> The human says what they want, once. Evzi turns it into machine-readable
> constraints — chain, token, a spend cap, and explicitly: no unlimited
> approvals. Then it hashes the whole thing.
>
> That hash is the point. From here on, nobody can quietly widen what was
> agreed to — not the agent, not the page, not us.

## 0:45–1:25 · The agent overreaches

**Do:** click **Let the agent act**. Let attempt 1 and the verdict render.
**Show:** the REJECT row and its finding.

> The agent does what a great many real agents do: it asks for an unlimited
> allowance, so it never has to ask again. Perfectly reasonable from where it
> sits.
>
> The verifier says no. Not because a model felt uneasy — because the human
> ruled unlimited approvals out, and this is exactly that. The policy is
> derived from the constraints, deterministically. A confident model can't talk
> the pipeline out of it. There's a test named for that.

## 1:25–1:50 · The agent corrects itself

**Show:** attempt 2 and ALLOW.

> The agent reads back the finding code it was refused with, narrows to exactly
> the amount authorized, and now it passes.
>
> It never saw the verifier's internals. It can't edit the authorization. It
> only learned that one specific thing was not allowed.

## 1:50–2:20 · What the live data adds

**Do:** switch to the terminal, run the live check:

```bash
pnpm exec tsx packages/onchain-context/tests/live/check.ts
```

**Show:** real USDC canonical, counterfeit flagged DANGER.

> Contract verification describes code. A counterfeit token's code is fine —
> that's the whole trick.
>
> So we ask The Graph what the market knows. Real USDC: a trillion in volume,
> nearly nine million holders. A counterfeit calling itself USDC: nothing
> behind it. That's a DANGER the old pipeline could not reach.
>
> Two Graph products, deliberately. The subgraph answers in a few hundred
> milliseconds and is the only thing the verdict waits on. The Token API takes
> about ten seconds on the free tier, so it enriches from cache instead of
> making anyone wait.

## 2:20–2:50 · The hardware gate

**Do:** show the signer terminal. Fire the refused transaction, then the
allowed one.

> Signing runs through a Ledger. The daemon calls the verifier itself rather
> than trusting whoever asked it to sign.
>
> Watch the device on the refused one. Nothing happens. It's never contacted.
> A compromised caller can't even *show* you a prompt for something your
> authorization forbids.
>
> The allowed one reaches the device, and that signature recovers to the
> device's own address.

## 2:50–3:00 · Close

**Show:** the Bazantic recipe page, then the repo.

> The verifier is also a public API — a Bazantic gateway with a published
> recipe. We measured it: the same model, the same prompt, with and without
> Evzi. Violations caught went from seventeen out of twenty-seven to
> twenty-seven out of twenty-seven.
>
> Everything from this hackathon is one `git diff` from a tagged baseline.

---

## Things worth saying if you have room

- The proposer is scripted on purpose. The interesting behaviour belongs to the
  verifier, and a deterministic proposer keeps the demo and the A/B honest.
- A Nano S can't clear-sign calldata — its screen shows a hash. That's the
  argument *for* explaining the transaction before the device is asked.

## Don't claim

- That the agent is an LLM. It isn't; it's a scripted proposer.
- That the spender-funnel check exists. It was designed and dropped — the Token
  API can't filter transfers by recipient on this tier.
- Any number not on screen. Every figure above is reproducible from the repo.
