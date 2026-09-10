# Uniswap developer feedback — ETHOnline 2026

Written from building [Evzi](./README.md), a transaction verifier that has to
decide whether an agent's proposed swap matches what a human authorized.

## What we integrate, honestly scoped

Evzi is not a trading app, so this is a consumer's view of the stack rather
than a builder's:

- **Universal Router recognition** (pre-existing): the decoder recognizes UR
  calldata and produces a structured swap action.
- **Canonical router addresses** (`packages/protocol-registry`, pre-existing):
  used during this event for a new rule — an allowance granted to a router in
  the registry is not treated as a transfer to a stranger, while a transfer to
  the same address still is. Without it, every legitimate swap approval read as
  a drain. See `packages/intent/src/verify.ts`.
- **Uniswap V3 subgraph** (new this event): the mainnet deployment is our
  liquidity source for deciding whether a token has a real market behind it.
  A counterfeit token carrying a blue-chip symbol has none, and that is how we
  catch it. See `packages/onchain-context/src/subgraph.ts`.

That is the whole of it. We did not deploy a hook, build a pool, or use the
Trading API.

## Friction we hit

### 1. The v3 subgraphs do not share a schema across chains

This cost the most time and is the feedback we would most want acted on.

The mainnet deployment `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` serves
the Uniswap schema:

```graphql
token(id: $id) { symbol name decimals txCount totalValueLockedUSD volumeUSD }
```

The Base deployment `FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS` serves a
Messari-style schema instead. `Token` exposes `lastPriceUSD`,
`_totalValueLockedUSD` and `_totalSupply` — the TVL field is **underscore
prefixed**, and there is no `txCount` or `volumeUSD` at all. The same query
against both returns:

```
Type `Token` has no field `totalValueLockedUSD`
```

Nothing in the naming suggests the two are different products. Both are listed
as Uniswap V3 subgraphs, both answer at the same gateway, both have a `token`
entity keyed by address. A developer writing one query and pointing it at two
chains will get a runtime error and no hint about why.

We ended up with per-chain query and extractor pairs
(`SUBGRAPH_SOURCES` in `subgraph.ts`) — which is the right shape once you know,
but only after introspecting the schema to find out.

**Suggestion:** either publish canonical per-chain deployments that share one
schema, or state the schema divergence prominently in the subgraph docs. A one
line "Base uses the Messari schema, see fields here" would have saved an hour.

### 2. Finding the right deployment id per chain is guesswork

There is no obvious authoritative list mapping *chain → current v3 subgraph
deployment id*. We first tried an id that looked plausible and got:

```json
{"errors":[{"message":"subgraph not found: 43Hwfi3dJSoGpyas9VwNoDAv55yjmwucqXfin2i5eYwc"}]}
```

Note that this arrives as **HTTP 200** with an `errors` array, so code that
checks only the status treats a nonexistent subgraph as a successful empty
result. We now check `errors` explicitly, but that is a trap worth documenting.

**Suggestion:** a maintained table of deployment ids per chain in the Uniswap
docs, next to the contract addresses that already have one.

### 3. Universal Router calldata is hard to decode defensively

The command-encoded design is good for gas and bad for anyone verifying a
transaction on the user's behalf. We handle the common shapes, but a
consumer has to track command byte meanings by hand, and a new command
silently degrades us to "unknown call".

The sentinel recipient addresses (`0x…0001` = msg.sender, `0x…0002` =
router-self) are a particular trap: read naively they look like a transfer to a
third party, which would make a plain swap look like a drain. We special-case
them.

**Suggestion:** a published, versioned machine-readable description of the
command set — even a JSON table of command byte → argument layout — would let
verifiers stay current without reverse-engineering each release.

## What worked well

- The gateway is fast and reliable. Every subgraph query in our path returned
  in 200–500ms, against ~10s for the other data provider we use. That
  difference decided our architecture: Uniswap subgraph data is what the
  verdict blocks on, everything slower is background enrichment.
- Registry-grade address stability. Canonical router addresses have been
  stable enough that a bundled whitelist is a viable trust signal, which is
  what lets us distinguish a real router from a lookalike.

## Where a verifier's interests differ from a trader's

Most Uniswap tooling assumes the caller *wants* the swap to happen. We are the
opposite: our job is to be able to say no. What that needs, which the current
stack does not really offer:

- A stable, machine-readable way to answer "is this address a canonical Uniswap
  deployment on this chain?" without shipping our own hardcoded list.
- Calldata decoding as a supported artifact rather than something each
  consumer reimplements.

Both are small compared to what the stack already publishes, and both would be
reused by every wallet, scanner and agent-safety tool, not just us.

---

# Bazantic developer feedback — ETHOnline 2026

Registering the Evzi verifier as a gateway, from `baz` CLI 0.8.0 plus the web
dashboard.

## The `mcpUrl` the CLI returns is not routable

`baz gateway add --json` returns:

```json
{"mcpUrl":"https://<slug>.bazgateway.com/mcp"}
```

That URL answers **404 page not found** for both GET and POST. The working
path is `/mcp/` — with a trailing slash. So the tool's own output cannot be
pasted into an MCP client without editing it, and there is no hint that a
slash is what is missing. We lost time probing path shapes before trying it.

**Suggestion:** return the trailing-slash form, or redirect `/mcp` → `/mcp/`.

## The CLI cannot set the upstream credential, so a CLI-created gateway 404s

`baz gateway add --auth-type api-key` accepts the auth *type* but there is no
flag for the credential itself, and no `baz gateway update`. The gateway is
created with `status: "active"`, which reads as ready — but every path returns
404 until the credential is filled in through the dashboard and saved.

Three things compounded here:

1. `status: "active"` on a gateway that cannot route is misleading. Something
   like `needs_credential` would have pointed straight at the problem.
2. **`SEND KEY AS` defaults to `URL path`.** Our API takes its key in a header,
   so the gateway was appending the key to the path and getting 404s from us.
   The dashboard's own **Test connection** correctly said "Test failed", but
   the failure reads as a URL problem rather than a key-placement one.
3. `deployedAt` does not change until Save is pressed, and nothing on the
   screen says the edits are unsaved. Checking `gateway list --json` was the
   only way we found to tell whether a change had taken effect.

**Suggestion:** either add `--api-key` / `--send-key-as` flags to
`gateway add`, or have the CLI print "credential required, finish setup at
<url>" instead of reporting a bare success.

## Docs describe commands the published CLI does not have

The Recipes documentation gives `baz recipe create <file>`,
`baz recipe update` and `baz recipe publish`. Version 0.8.0 — the latest on
npm at the time of writing — has no `recipe` command at all:

```
baz: unknown command: recipe. Try `baz --help`.
```

The session it issues does carry `recipe:read, recipe:write` scopes, so the
capability exists server-side. Recipes appear to be web-only for now.

**Suggestion:** mark the CLI recipe commands as unreleased in the docs.

## What worked well

- `--spec-url` fetching and parsing our OpenAPI document server-side was
  smooth, and the generated MCP tool names came straight from our
  `operationId`s — `verifyProposal`, `planNextStep` — which made the tool
  listing immediately legible to an agent.
- The x402 402 response is well formed and self-describing: scheme, network,
  amount, asset and `payTo` all present, so a client knows exactly what it is
  being asked to pay without out-of-band docs.
- Per-method pricing down to zero made it possible to leave the gateway open
  for judges to call without anyone needing a funded wallet.
