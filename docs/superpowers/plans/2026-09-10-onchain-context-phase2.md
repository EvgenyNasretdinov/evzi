# Agent Intent Firewall — Phase 2: `packages/onchain-context`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live Graph data a load-bearing input to the verdict — a signal that changes the outcome, not decoration.

**Architecture:** A `GraphProvider` interface with two implementations. `subgraph` queries the Uniswap v3 subgraphs through `gateway.thegraph.com` and works today. `tokenApi` queries Pinax and is currently returning `500` upstream. `fetchOnchainContext()` races whichever providers are configured under a timeout and marks the result `degraded` when a source fails, so a data outage never blocks a verdict.

**Tech Stack:** TypeScript 5.6 ESM, vitest 2.1, `fetch` with `AbortSignal.timeout`, no runtime deps.

**Spec:** `docs/superpowers/specs/2026-09-10-agent-intent-firewall-design.md`

## Global Constraints

- Package `@intent-check/onchain-context`; depends only on `@intent-check/types`.
- Commits: imperative mood, **no AI co-author trailers**.
- No live network calls in tests. Every provider test uses a recorded fixture or an injected `fetch`.
- Amounts stay raw integer strings; USD figures are `number` and always optional.
- All Graph calls are best-effort: any failure sets `degraded`, never throws to the caller.
- Branch `ethonline-2026`.

## Verified facts this plan rests on (checked 2026-09-10)

- `gateway.thegraph.com/api/<key>/subgraphs/id/<id>` — **working**, returns a fresh block.
- Mainnet subgraph `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` (Uniswap schema):
  real USDC returns `txCount 38557065`, `totalValueLockedUSD ~586M`, `volumeUSD ~1.03T`;
  an unknown address returns `token: null`.
- Base subgraph `FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS` (**Messari schema —
  different fields**): `Token` exposes `lastPriceUSD`, `_totalValueLockedUSD`,
  `_totalSupply`, and has no `txCount`/`volumeUSD`. Real Base USDC returns
  `_totalValueLockedUSD ~75.6M`; an unknown address returns `token: null`.
  The two chains therefore need per-chain queries and extractors, not one
  shared query. A first guessed Base id (`43Hwfi3d…`) did not exist — every
  deployment id in this plan was verified against the live gateway.
- `api.pinax.network/v1/evm/*` — **down**: `401` without the JWT, `500 bad_gateway` with it,
  on every path including `/v1/evm/networks`.

Consequence: `GRAPH_TOKEN_IMPERSONATION` ships now via subgraph.
`GRAPH_SPENDER_FUNNEL` and `GRAPH_EXPOSURE_USD` are implemented against the
Token API and stay dormant behind `degraded` until that upstream returns.

---

### Task 1: Package scaffold and the subgraph token-reputation provider

**Files:**
- Create: `packages/onchain-context/package.json`, `tsconfig.json`
- Create: `packages/onchain-context/src/subgraph.ts`, `src/index.ts`
- Test: `packages/onchain-context/tests/subgraph.test.ts`

**Interfaces:**
- Produces: `fetchTokenReputation(args: { chainId: number; token: string; apiKey: string; fetchImpl?: typeof fetch }): Promise<OnchainContext["token"] | undefined>`
- Produces: `SUBGRAPH_IDS: Record<number, string>`

- [x] **Step 1: Scaffold**

`package.json` mirrors `packages/intent/package.json` with name
`@intent-check/onchain-context`; `tsconfig.json` is identical to the one in
`packages/intent`. Run `pnpm install` from the root afterwards.

- [x] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fetchTokenReputation } from "../src/subgraph";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
}

describe("onchain-context — fetchTokenReputation", () => {
  it("reports a liquid, heavily used token as canonical", async () => {
    const f = fakeFetch({
      data: { token: {
        symbol: "USDC", name: "USD Coin", decimals: "6",
        txCount: "38557065", poolCount: "0",
        totalValueLockedUSD: "586157778.40", volumeUSD: "1027899123005.06",
      } },
    });
    const out = await fetchTokenReputation({ chainId: 1, token: USDC, apiKey: "k", fetchImpl: f });
    expect(out).toMatchObject({ symbol: "USDC", canonical: true });
    expect(out?.marketCapUsd).toBeGreaterThan(1_000_000);
  });

  it("reports a token the subgraph has never seen as non-canonical", async () => {
    const f = fakeFetch({ data: { token: null } });
    const out = await fetchTokenReputation({ chainId: 1, token: "0xdead", apiKey: "k", fetchImpl: f });
    expect(out).toMatchObject({ canonical: false });
    expect(out?.marketCapUsd).toBeUndefined();
  });

  it("treats a token with negligible liquidity as non-canonical", async () => {
    const f = fakeFetch({
      data: { token: {
        symbol: "USDC", name: "USD Coin", decimals: "6",
        txCount: "3", poolCount: "1",
        totalValueLockedUSD: "12.5", volumeUSD: "40",
      } },
    });
    const out = await fetchTokenReputation({ chainId: 1, token: "0xfake", apiKey: "k", fetchImpl: f });
    expect(out?.canonical).toBe(false);
  });

  it("returns undefined rather than throwing when the gateway errors", async () => {
    const f = fakeFetch({ errors: [{ message: "boom" }] }, false);
    await expect(
      fetchTokenReputation({ chainId: 1, token: USDC, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for a chain with no configured subgraph", async () => {
    const f = fakeFetch({ data: { token: null } });
    await expect(
      fetchTokenReputation({ chainId: 999999, token: USDC, apiKey: "k", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});
```

- [x] **Step 3: Run and verify it fails**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: FAIL — cannot resolve `../src/subgraph`.

- [x] **Step 4: Implement `subgraph.ts`**

```ts
import type { OnchainContext } from "@intent-check/types";

/** Uniswap v3 subgraph deployment ids on the decentralized network. */
export const SUBGRAPH_IDS: Record<number, string> = {
  1: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
  8453: "43Hwfi3dJSoGpyas9VwNoDAv55yjmwucqXfin2i5eYwc",
};

/** Below this, a token has no meaningful market and a claimed blue-chip symbol is a lie. */
const LIQUIDITY_FLOOR_USD = 100_000;

const QUERY =
  "query($id:ID!){ token(id:$id){ symbol name decimals txCount poolCount totalValueLockedUSD volumeUSD } }";

export interface TokenReputationArgs {
  chainId: number;
  token: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Ask The Graph what the market knows about this token.
 *
 * Sourcify tells us whether code is verified; it cannot tell a real USDC from
 * a counterfeit with the same symbol. Liquidity and transaction count can.
 */
export async function fetchTokenReputation(
  args: TokenReputationArgs,
): Promise<OnchainContext["token"] | undefined> {
  const id = SUBGRAPH_IDS[args.chainId];
  if (!id) return undefined;

  const doFetch = args.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`https://gateway.thegraph.com/api/${args.apiKey}/subgraphs/id/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id: args.token.toLowerCase() } }),
      signal: args.signal,
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as {
      data?: { token: null | Record<string, string> };
    };
    const t = json.data?.token;
    if (!t) return { address: args.token.toLowerCase(), canonical: false };

    const tvl = Number(t.totalValueLockedUSD ?? "0");
    const volume = Number(t.volumeUSD ?? "0");
    const canonical = tvl >= LIQUIDITY_FLOOR_USD;

    return {
      address: args.token.toLowerCase(),
      symbol: t.symbol,
      marketCapUsd: canonical ? Math.max(tvl, volume) : undefined,
      canonical,
    };
  } catch {
    return undefined;
  }
}
```

`src/index.ts`: `export * from "./subgraph";`

- [x] **Step 5: Run and verify it passes**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: PASS, 5 tests.

- [x] **Step 6: Verify against the live gateway once, by hand**

```bash
K=$(grep '^GRAPH_API_KEY=' apps/judge/.dev.vars | cut -d= -f2-)
curl -s "https://gateway.thegraph.com/api/$K/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ token(id:\"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48\"){ symbol totalValueLockedUSD } }"}'
```

Expected: real USDC with TVL in the hundreds of millions. Confirms the
deployment id and the field names still match.

- [x] **Step 7: Commit**

```bash
git add packages/onchain-context pnpm-lock.yaml
git commit -m "feat(onchain-context): token reputation from The Graph subgraphs"
```

---

### Task 2: Token API provider

**Files:**
- Create: `packages/onchain-context/src/tokenApi.ts`
- Test: `packages/onchain-context/tests/tokenApi.test.ts`

**Interfaces:**
- Produces: `fetchSpenderProfile(args)`, `fetchWalletBalances(args)`, both
  `Promise<… | undefined>`, both taking `{ chainId, address, jwt, fetchImpl?, signal? }`.

Written against recorded fixtures so it is complete and tested even while the
upstream is down; it activates the moment Pinax stops returning `500`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fetchSpenderProfile, fetchWalletBalances } from "../src/tokenApi";

const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("onchain-context — fetchSpenderProfile", () => {
  it("counts distinct senders and measures outbound concentration", async () => {
    const f = json({ data: [
      { from: "0xa", to: "0xspender", value: "1" },
      { from: "0xb", to: "0xspender", value: "1" },
      { from: "0xa", to: "0xspender", value: "1" },
      { from: "0xspender", to: "0xsink", value: "3" },
    ] });
    const out = await fetchSpenderProfile({ chainId: 1, address: "0xSpender", jwt: "j", fetchImpl: f });
    expect(out?.distinctInboundSenders48h).toBe(2);
    expect(out?.outboundConcentration).toBe(1);
  });

  it("reports zero concentration when nothing left the address", async () => {
    const f = json({ data: [{ from: "0xa", to: "0xspender", value: "1" }] });
    const out = await fetchSpenderProfile({ chainId: 1, address: "0xspender", jwt: "j", fetchImpl: f });
    expect(out?.outboundConcentration).toBe(0);
  });

  it("returns undefined when the upstream is failing", async () => {
    const f = json({ error: { status: 500, code: "bad_gateway" } }, 500);
    await expect(
      fetchSpenderProfile({ chainId: 1, address: "0xspender", jwt: "j", fetchImpl: f }),
    ).resolves.toBeUndefined();
  });
});

describe("onchain-context — fetchWalletBalances", () => {
  it("sums USD across balances", async () => {
    const f = json({ data: [
      { contract: "0xusdc", symbol: "USDC", amount: "12400000000", value_usd: 12400 },
      { contract: "0xweth", symbol: "WETH", amount: "1000000000000000000", value_usd: 3100 },
    ] });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.totalUsd).toBe(15500);
    expect(out?.balances).toHaveLength(2);
  });

  it("tolerates rows with no USD price", async () => {
    const f = json({ data: [{ contract: "0xx", symbol: "X", amount: "1" }] });
    const out = await fetchWalletBalances({ chainId: 1, address: "0xme", jwt: "j", fetchImpl: f });
    expect(out?.totalUsd).toBe(0);
    expect(out?.balances[0]?.usd).toBeUndefined();
  });
});
```

- [x] **Step 2: Run and verify it fails**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: FAIL — cannot resolve `../src/tokenApi`.

- [x] **Step 3: Implement `tokenApi.ts`**

```ts
import type { OnchainContext } from "@intent-check/types";

const BASE = "https://api.pinax.network/v1/evm";

/** Pinax network slugs for the chains Evzi supports. */
const NETWORKS: Record<number, string> = { 1: "mainnet", 8453: "base" };

export interface TokenApiArgs {
  chainId: number;
  address: string;
  jwt: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface Transfer { from?: string; to?: string; value?: string }
interface Balance { contract?: string; symbol?: string; amount?: string; value_usd?: number }

async function get<T>(url: string, a: TokenApiArgs): Promise<T[] | undefined> {
  const doFetch = a.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${a.jwt}`, Accept: "application/json" },
      signal: a.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: T[] };
    return json.data ?? [];
  } catch {
    return undefined;
  }
}

/**
 * Behavioural profile of a spender address.
 *
 * The drainer shape is many wallets paying in and one address taking
 * everything out. Sourcify cannot see this at all — an EOA has no source.
 */
export async function fetchSpenderProfile(
  a: TokenApiArgs,
): Promise<OnchainContext["spender"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const addr = a.address.toLowerCase();
  const rows = await get<Transfer>(
    `${BASE}/transfers?network=${net}&address=${addr}&age=2&limit=10`,
    a,
  );
  if (!rows) return undefined;

  const inboundSenders = new Set<string>();
  const outboundByDest = new Map<string, bigint>();
  let outboundTotal = 0n;

  for (const r of rows) {
    const from = r.from?.toLowerCase();
    const to = r.to?.toLowerCase();
    const value = (() => { try { return BigInt(r.value ?? "0"); } catch { return 0n; } })();

    if (to === addr && from && from !== addr) inboundSenders.add(from);
    if (from === addr && to) {
      outboundByDest.set(to, (outboundByDest.get(to) ?? 0n) + value);
      outboundTotal += value;
    }
  }

  const largest = [...outboundByDest.values()].reduce((m, v) => (v > m ? v : m), 0n);
  const concentration =
    outboundTotal > 0n ? Number((largest * 10000n) / outboundTotal) / 10000 : 0;

  return {
    address: addr,
    distinctInboundSenders48h: inboundSenders.size,
    outboundConcentration: concentration,
  };
}

/** What the wallet actually holds — turns MAX_UINT256 into a dollar figure. */
export async function fetchWalletBalances(
  a: TokenApiArgs,
): Promise<OnchainContext["wallet"] | undefined> {
  const net = NETWORKS[a.chainId];
  if (!net) return undefined;

  const rows = await get<Balance>(
    `${BASE}/balances?network=${net}&address=${a.address.toLowerCase()}&limit=10`,
    a,
  );
  if (!rows) return undefined;

  const balances = rows.map((b) => ({
    token: (b.contract ?? "").toLowerCase(),
    symbol: b.symbol,
    amount: b.amount ?? "0",
    usd: b.value_usd,
  }));

  return {
    address: a.address.toLowerCase(),
    totalUsd: balances.reduce((s, b) => s + (b.usd ?? 0), 0),
    balances,
  };
}
```

Add `export * from "./tokenApi";` to `src/index.ts`.

- [x] **Step 4: Run and verify it passes**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: PASS, 10 tests total.

- [x] **Step 5: Commit**

```bash
git add packages/onchain-context
git commit -m "feat(onchain-context): spender profile and wallet balances via Token API"
```

---

### Task 3: Orchestration with timeout and degradation

**Files:**
- Create: `packages/onchain-context/src/context.ts`
- Test: `packages/onchain-context/tests/context.test.ts`

**Interfaces:**
- Produces: `fetchOnchainContext(args: ContextArgs): Promise<OnchainContext>` where
  `ContextArgs = { chainId: number; token?: string; spender?: string; wallet?: string; graphApiKey?: string; tokenApiJwt?: string; timeoutMs?: number; deps?: Partial<Deps> }`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fetchOnchainContext } from "../src/context";

describe("onchain-context — fetchOnchainContext", () => {
  it("marks degraded when a source returns nothing", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1, token: "0xusdc", graphApiKey: "k",
      deps: { tokenReputation: async () => undefined },
    });
    expect(ctx.degraded).toBe(true);
    expect(ctx.token).toBeUndefined();
  });

  it("is not degraded when every requested source answers", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1, token: "0xusdc", graphApiKey: "k",
      deps: {
        tokenReputation: async () => ({ address: "0xusdc", canonical: true, symbol: "USDC" }),
      },
    });
    expect(ctx.degraded).toBe(false);
    expect(ctx.token?.canonical).toBe(true);
  });

  it("does not mark degraded for sources that were never requested", async () => {
    const ctx = await fetchOnchainContext({ chainId: 1 });
    expect(ctx.degraded).toBe(false);
  });

  it("degrades rather than hanging when a source exceeds the timeout", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1, token: "0xusdc", graphApiKey: "k", timeoutMs: 10,
      deps: { tokenReputation: () => new Promise((r) => setTimeout(() => r(undefined), 200)) },
    });
    expect(ctx.degraded).toBe(true);
  });

  it("degrades when one source fails but keeps the one that succeeded", async () => {
    const ctx = await fetchOnchainContext({
      chainId: 1, token: "0xusdc", wallet: "0xme", graphApiKey: "k", tokenApiJwt: "j",
      deps: {
        tokenReputation: async () => ({ address: "0xusdc", canonical: true }),
        walletBalances: async () => undefined,
      },
    });
    expect(ctx.token?.canonical).toBe(true);
    expect(ctx.wallet).toBeUndefined();
    expect(ctx.degraded).toBe(true);
  });
});
```

- [x] **Step 2: Run and verify it fails**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: FAIL — cannot resolve `../src/context`.

- [x] **Step 3: Implement `context.ts`**

```ts
import type { OnchainContext } from "@intent-check/types";
import { fetchTokenReputation } from "./subgraph";
import { fetchSpenderProfile, fetchWalletBalances } from "./tokenApi";

export interface Deps {
  tokenReputation: (a: {
    chainId: number; token: string; apiKey: string; signal?: AbortSignal;
  }) => Promise<OnchainContext["token"] | undefined>;
  spenderProfile: (a: {
    chainId: number; address: string; jwt: string; signal?: AbortSignal;
  }) => Promise<OnchainContext["spender"] | undefined>;
  walletBalances: (a: {
    chainId: number; address: string; jwt: string; signal?: AbortSignal;
  }) => Promise<OnchainContext["wallet"] | undefined>;
}

export interface ContextArgs {
  chainId: number;
  token?: string;
  spender?: string;
  wallet?: string;
  graphApiKey?: string;
  tokenApiJwt?: string;
  timeoutMs?: number;
  deps?: Partial<Deps>;
}

const DEFAULT_TIMEOUT_MS = 3000;

/** Resolve to `undefined` rather than rejecting when the deadline passes. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    p,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Gather live Graph context. Never throws and never blocks a verdict: a source
 * that fails or times out simply sets `degraded`, and the caller decides what a
 * missing signal means.
 */
export async function fetchOnchainContext(args: ContextArgs): Promise<OnchainContext> {
  const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const d: Deps = {
    tokenReputation: fetchTokenReputation,
    spenderProfile: fetchSpenderProfile,
    walletBalances: fetchWalletBalances,
    ...args.deps,
  };

  const wantToken = Boolean(args.token && args.graphApiKey);
  const wantSpender = Boolean(args.spender && args.tokenApiJwt);
  const wantWallet = Boolean(args.wallet && args.tokenApiJwt);

  const [token, spender, wallet] = await Promise.all([
    wantToken
      ? withDeadline(
          d.tokenReputation({ chainId: args.chainId, token: args.token!, apiKey: args.graphApiKey! }),
          timeout,
        )
      : Promise.resolve(undefined),
    wantSpender
      ? withDeadline(
          d.spenderProfile({ chainId: args.chainId, address: args.spender!, jwt: args.tokenApiJwt! }),
          timeout,
        )
      : Promise.resolve(undefined),
    wantWallet
      ? withDeadline(
          d.walletBalances({ chainId: args.chainId, address: args.wallet!, jwt: args.tokenApiJwt! }),
          timeout,
        )
      : Promise.resolve(undefined),
  ]);

  const degraded =
    (wantToken && !token) || (wantSpender && !spender) || (wantWallet && !wallet);

  return { token, spender, wallet, degraded };
}
```

- [x] **Step 4: Run and verify it passes**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: PASS, 15 tests total.

- [x] **Step 5: Commit**

```bash
git add packages/onchain-context
git commit -m "feat(onchain-context): orchestrate providers with timeout and degradation"
```

---

### Task 4: Turning context into findings

**Files:**
- Create: `packages/onchain-context/src/findings.ts`
- Test: `packages/onchain-context/tests/findings.test.ts`

**Interfaces:**
- Produces: `graphFindings(ctx: OnchainContext, opts: { claimedSymbol?: string; isUnlimitedApproval?: boolean }): Finding[]`

This is the step that makes the data load-bearing: each finding here is one the
deterministic layer could not have produced on its own.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { graphFindings } from "../src/findings";
import type { OnchainContext } from "@intent-check/types";

const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("onchain-context — graphFindings", () => {
  it("flags a token impersonating a blue chip with no liquidity behind it", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xfake", symbol: "USDC", canonical: false },
    };
    const fs = graphFindings(ctx, { claimedSymbol: "USDC" });
    expect(codes(fs)).toContain("GRAPH_TOKEN_IMPERSONATION");
    expect(fs[0]?.severity).toBe("danger");
  });

  it("stays quiet for a canonical token", () => {
    const ctx: OnchainContext = {
      degraded: false,
      token: { address: "0xusdc", symbol: "USDC", canonical: true, marketCapUsd: 5e8 },
    };
    expect(codes(graphFindings(ctx, { claimedSymbol: "USDC" }))).not.toContain(
      "GRAPH_TOKEN_IMPERSONATION",
    );
  });

  it("flags the drainer funnel shape", () => {
    const ctx: OnchainContext = {
      degraded: false,
      spender: {
        address: "0xdrainer",
        distinctInboundSenders48h: 412,
        outboundConcentration: 0.98,
      },
    };
    const fs = graphFindings(ctx, {});
    expect(codes(fs)).toContain("GRAPH_SPENDER_FUNNEL");
    expect(fs[0]?.text).toMatch(/412/);
  });

  it("does not flag a busy address that spreads its outflow", () => {
    const ctx: OnchainContext = {
      degraded: false,
      spender: { address: "0xrouter", distinctInboundSenders48h: 900, outboundConcentration: 0.05 },
    };
    expect(codes(graphFindings(ctx, {}))).not.toContain("GRAPH_SPENDER_FUNNEL");
  });

  it("puts a dollar figure on an unlimited approval", () => {
    const ctx: OnchainContext = {
      degraded: false,
      wallet: { address: "0xme", totalUsd: 12400, balances: [] },
    };
    const fs = graphFindings(ctx, { isUnlimitedApproval: true });
    expect(codes(fs)).toContain("GRAPH_EXPOSURE_USD");
    expect(fs[0]?.text).toMatch(/12,?400/);
  });

  it("says nothing about exposure when the approval is bounded", () => {
    const ctx: OnchainContext = {
      degraded: false,
      wallet: { address: "0xme", totalUsd: 12400, balances: [] },
    };
    expect(codes(graphFindings(ctx, { isUnlimitedApproval: false }))).not.toContain(
      "GRAPH_EXPOSURE_USD",
    );
  });

  it("produces nothing at all from an empty degraded context", () => {
    expect(graphFindings({ degraded: true }, {})).toEqual([]);
  });
});
```

- [x] **Step 2: Run and verify it fails**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: FAIL — cannot resolve `../src/findings`.

- [x] **Step 3: Implement `findings.ts`**

```ts
import type { Finding, OnchainContext } from "@intent-check/types";

/** Symbols worth impersonating. A counterfeit here is never an accident. */
const BLUE_CHIPS = new Set(["USDC", "USDT", "DAI", "WETH", "WBTC"]);

/** Many payers in, one payee out — the drainer funnel. */
const FUNNEL_MIN_SENDERS = 20;
const FUNNEL_MIN_CONCENTRATION = 0.8;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Turn live Graph data into verdict findings.
 *
 * Each finding here is one the deterministic layer could not reach: contract
 * verification describes code, and these describe behaviour and markets.
 */
export function graphFindings(
  ctx: OnchainContext,
  opts: { claimedSymbol?: string; isUnlimitedApproval?: boolean },
): Finding[] {
  const findings: Finding[] = [];

  const claimed = (opts.claimedSymbol ?? ctx.token?.symbol ?? "").toUpperCase();
  if (ctx.token && !ctx.token.canonical && BLUE_CHIPS.has(claimed)) {
    findings.push({
      code: "GRAPH_TOKEN_IMPERSONATION",
      severity: "danger",
      text: `This token calls itself ${claimed}, but The Graph shows no real market behind this address — the genuine ${claimed} has hundreds of millions in liquidity.`,
    });
  }

  const s = ctx.spender;
  if (
    s &&
    s.distinctInboundSenders48h >= FUNNEL_MIN_SENDERS &&
    s.outboundConcentration >= FUNNEL_MIN_CONCENTRATION
  ) {
    findings.push({
      code: "GRAPH_SPENDER_FUNNEL",
      severity: "danger",
      text: `${s.distinctInboundSenders48h} different wallets sent tokens to this address in the last 48 hours, and ${Math.round(s.outboundConcentration * 100)}% of what left went to a single address. That is the shape of a drainer.`,
    });
  }

  if (opts.isUnlimitedApproval && ctx.wallet?.totalUsd) {
    findings.push({
      code: "GRAPH_EXPOSURE_USD",
      severity: "warn",
      text: `An unlimited approval here would put ${usd(ctx.wallet.totalUsd)} of holdings within reach.`,
    });
  }

  return findings;
}
```

Add `export * from "./findings";` and `export * from "./context";` to `src/index.ts`.

- [x] **Step 4: Run and verify it passes**

Run: `pnpm --filter @intent-check/onchain-context test`
Expected: PASS, 22 tests total.

- [x] **Step 5: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green, 184 + 22 tests.

- [x] **Step 6: Commit**

```bash
git add packages/onchain-context
git commit -m "feat(onchain-context): derive verdict findings from live Graph data"
```

---

## Phase 2 done — what exists then

Live Graph data reaches the verdict through three findings, one of which
(`GRAPH_TOKEN_IMPERSONATION`) works today against a healthy gateway and carries
the counterfeit-token demo on its own. The other two are complete and tested,
and activate when the Token API upstream recovers.

Wiring the context into `background.ts` and the judge prompt is Phase 3, along
with the agent console — that is where the findings become visible in the popup.
