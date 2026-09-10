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
