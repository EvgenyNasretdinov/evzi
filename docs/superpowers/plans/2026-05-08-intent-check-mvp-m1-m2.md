# Intent-Check MVP (M1+M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Chromium extension that intercepts a Uniswap swap on Base, runs deterministic decoding + Tenderly simulation + Sourcify lookup, asks an LLM judge for a verdict, and shows a `SAFE` / `CAUTION` / `DANGER` chip with a one-sentence summary before the user signs.

**Architecture:** Monorepo (pnpm workspaces). Extension (MV3, Vite + CRXJS, React popup) does deterministic decoding locally; backend (Hono on Cloudflare Workers or Node) wraps Anthropic for the judgment layer. Trust ranking enforced via a safety floor that prevents the LLM from softening a deterministic `DANGER`.

**Tech Stack:** TypeScript, pnpm, Vite, @crxjs/vite-plugin, React 18, viem, Hono, Anthropic SDK (`claude-sonnet-4-6`), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-08-intent-check-design.md`.

---

## File Structure

```
intent-check/
├── package.json                              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── .env.example
├── apps/
│   ├── extension/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── manifest.config.ts                # MV3 manifest via CRXJS
│   │   ├── src/
│   │   │   ├── inpage.ts                     # window.ethereum proxy
│   │   │   ├── content-script.ts             # DOM scrape + bridge
│   │   │   ├── background.ts                 # orchestrator
│   │   │   ├── popup/
│   │   │   │   ├── index.html
│   │   │   │   ├── main.tsx
│   │   │   │   ├── App.tsx                   # verdict UI
│   │   │   │   └── components/
│   │   │   │       ├── VerdictChip.tsx
│   │   │   │       ├── DetailsPanel.tsx
│   │   │   │       └── IntentConfirm.tsx
│   │   │   └── shared/
│   │   │       ├── messaging.ts              # typed chrome.runtime messages
│   │   │       ├── pendingRequests.ts        # promise registry
│   │   │       └── config.ts                 # JUDGE_URL, RPC URLs
│   │   └── tests/
│   │       └── messaging.test.ts
│   └── judge/
│       ├── package.json
│       ├── tsconfig.json
│       ├── wrangler.toml                     # Cloudflare Workers config
│       ├── src/
│       │   ├── index.ts                      # Hono app
│       │   ├── judge.ts                      # /judge handler
│       │   ├── prompt.ts                     # system prompt + tool defs
│       │   ├── safetyFloor.ts                # post-process LLM tier
│       │   └── anthropic.ts                  # SDK wrapper
│       └── tests/
│           ├── judge.test.ts
│           └── fixtures/                     # 10 scenarios
├── packages/
│   ├── types/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts                      # all shared types
│   ├── decoder/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                      # public API: decode()
│   │   │   ├── selector.ts                   # 4byte selector parsing
│   │   │   ├── recognizers/
│   │   │   │   ├── index.ts                  # registry
│   │   │   │   ├── uniswapUniversalRouter.ts
│   │   │   │   └── erc20.ts                  # transfer, approve
│   │   │   └── eip712.ts                     # (stub for M3)
│   │   └── tests/
│   │       ├── erc20.test.ts
│   │       └── uniswapUniversalRouter.test.ts
│   ├── sourcify-client/
│   │   ├── package.json
│   │   ├── src/
│   │   │   └── index.ts                      # fetchAbi(chainId, address)
│   │   └── tests/
│   │       ├── index.test.ts
│   │       └── fixtures/
│   └── tenderly-client/
│       ├── package.json
│       ├── src/
│       │   └── index.ts                      # simulate(req)
│       └── tests/
│           ├── index.test.ts
│           └── fixtures/
└── docs/
    └── superpowers/
        ├── specs/2026-05-08-intent-check-design.md
        └── plans/2026-05-08-intent-check-mvp-m1-m2.md  # this file
```

**Boundary rationale.** `packages/types` has no runtime deps; everything imports from it. `packages/decoder` is pure functions over hex strings + ABIs; no network. `sourcify-client` and `tenderly-client` are thin network wrappers that return shapes from `types`. The extension and the judge backend depend only on these packages — never on each other.

---

# M1 — Skeleton + happy path on one recognizer

## Task 1: Initialize monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "intent-check",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:extension": "pnpm --filter ./apps/extension dev",
    "dev:judge": "pnpm --filter ./apps/judge dev"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "packageManager": "pnpm@9.12.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ES2022", "DOM"]
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
.wrangler/
.dev.vars
*.log
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```
ANTHROPIC_API_KEY=
TENDERLY_ACCESS_KEY=
TENDERLY_ACCOUNT_SLUG=
TENDERLY_PROJECT_SLUG=
ALCHEMY_API_KEY=
JUDGE_API_KEY=local-dev-key
```

- [ ] **Step 6: Install root deps**

Run: `pnpm install`
Expected: `Done` and a `pnpm-lock.yaml` generated.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example pnpm-lock.yaml
git commit -m "chore: initialize pnpm monorepo"
```

---

## Task 2: Define shared types in `packages/types`

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@intent-check/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "test": "echo no tests"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/types/src/index.ts` with the full shared type surface**

```ts
// Verdict tiers, ordered worst-first for max() comparisons.
export type VerdictTier = "DANGER" | "CAUTION" | "SAFE";

// Severity for individual findings.
export type Severity = "info" | "warn" | "danger";

export interface Finding {
  code: string;          // stable id, e.g. "UNLIMITED_APPROVAL"
  severity: Severity;
  text: string;          // human-readable
}

// Inferred / confirmed user intent.
export interface UserIntent {
  kind: "swap" | "approve" | "deposit" | "mint" | "bridge" | "transfer" | "sign" | "other";
  summary: string;       // "swap 100 USDC for ETH on Uniswap"
  tokensIn?: TokenAmount[];
  tokensOut?: TokenAmount[];
  protocol?: string;
  confidence: number;    // 0..1, how sure auto-inference is
}

export interface TokenAmount {
  chainId: number;
  address: string;       // 0x... or "ETH"
  symbol?: string;
  decimals?: number;
  amount: string;        // raw integer string
}

// Decoded structured action from calldata.
export type DecodedAction =
  | { kind: "swap"; tokenIn: TokenAmount; tokenOut: TokenAmount; minAmountOut: string; recipient: string; router: string; protocol: string }
  | { kind: "approve"; token: string; spender: string; amount: string; isUnlimited: boolean }
  | { kind: "setApprovalForAll"; collection: string; operator: string; approved: boolean }
  | { kind: "transfer"; token: string; to: string; amount: string }
  | { kind: "permit"; token: string; owner: string; spender: string; amount: string; deadline: string }
  | { kind: "permit2Transfer"; permitted: TokenAmount[]; spender: string; deadline: string }
  | { kind: "seaportOrder"; offerer: string; offer: TokenAmount[]; consideration: TokenAmount[] }
  | { kind: "unknown"; selector: string; functionName?: string; rawArgs?: unknown[] };

// Tenderly simulation result, normalized.
export interface SimResult {
  success: boolean;
  failureReason?: string;
  assetChanges: AssetChange[];
  balanceChanges: BalanceChange[];
  gasUsed: string;
  logs: SimLog[];
}

export interface AssetChange {
  type: "transfer" | "mint" | "burn";
  from: string;
  to: string;
  token: TokenAmount;
}

export interface BalanceChange {
  address: string;
  delta: string;         // signed integer string in wei
}

export interface SimLog {
  address: string;
  topics: string[];
  data: string;
  decoded?: { name: string; args: Record<string, unknown> };
}

// Contract trust signals.
export interface ContractMeta {
  address: string;
  chainId: number;
  verified: boolean;
  sourceProvider?: "sourcify" | "etherscan";
  contractName?: string;
  isProxy: boolean;
  implementation?: string;
  deploymentBlock?: number;
  ageHours?: number;
}

// Origin / page signals.
export interface OriginSignals {
  url: string;
  origin: string;
  pageTitle?: string;
  ogTitle?: string;
  ogSiteName?: string;
  visibleButtonText?: string;
  faviconHash?: string;
  knownDappMatch?: { name: string; expectedDomains: string[]; matched: boolean };
  punycode?: boolean;
  lookalikeOf?: string;
}

// Wallet request as captured from the dApp.
export type WalletRequest =
  | { method: "eth_sendTransaction"; params: [TxParams] }
  | { method: "eth_signTypedData_v4"; params: [string, string] }   // address, JSON
  | { method: "personal_sign"; params: [string, string] }
  | { method: "wallet_sendCalls"; params: [SendCallsParams] };

export interface TxParams {
  from: string;
  to: string;
  value?: string;
  data?: string;
  chainId?: string;
  gas?: string;
}

export interface SendCallsParams {
  version: string;
  from: string;
  chainId: string;
  calls: { to: string; data: string; value?: string }[];
}

// Input to the /judge endpoint.
export interface JudgeInput {
  intent: UserIntent;
  decoded: DecodedAction;
  sim?: SimResult;
  contract: ContractMeta;
  origin: OriginSignals;
  findings: Finding[];   // deterministic findings already computed
  request: WalletRequest;
}

// Output of /judge.
export interface JudgeVerdict {
  tier: VerdictTier;
  headline: string;
  reasons: { severity: Severity; text: string }[];
  confidence: number;
}

// Tier ordering helper.
export const TIER_ORDER: Record<VerdictTier, number> = {
  SAFE: 0,
  CAUTION: 1,
  DANGER: 2,
};

export function maxTier(a: VerdictTier, b: VerdictTier): VerdictTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @intent-check/types typecheck`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/types
git commit -m "feat(types): define shared types for intent-check"
```

---

## Task 3: Decoder — selector parsing + ERC-20 recognizer (TDD)

**Files:**
- Create: `packages/decoder/package.json`
- Create: `packages/decoder/tsconfig.json`
- Create: `packages/decoder/src/index.ts`
- Create: `packages/decoder/src/selector.ts`
- Create: `packages/decoder/src/recognizers/index.ts`
- Create: `packages/decoder/src/recognizers/erc20.ts`
- Create: `packages/decoder/tests/erc20.test.ts`

- [ ] **Step 1: Create `packages/decoder/package.json`**

```json
{
  "name": "@intent-check/decoder",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@intent-check/types": "workspace:*",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/decoder/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Install deps**

Run: `pnpm install`
Expected: viem installed.

- [ ] **Step 4: Write the failing test for ERC-20 `transfer`**

Create `packages/decoder/tests/erc20.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import { decode } from "../src/index";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const ERC20_ABI = [
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

describe("erc20 recognizer", () => {
  it("decodes transfer(address,uint256)", async () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [RECIPIENT, 100_000000n] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    expect(result.kind).toBe("transfer");
    if (result.kind !== "transfer") throw new Error();
    expect(result.token.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.amount).toBe("100000000");
  });

  it("decodes approve and flags unlimited", async () => {
    const MAX = (1n << 256n) - 1n;
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [RECIPIENT, MAX] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    expect(result.kind).toBe("approve");
    if (result.kind !== "approve") throw new Error();
    expect(result.isUnlimited).toBe(true);
    expect(result.amount).toBe(MAX.toString());
  });

  it("decodes approve with bounded amount as not unlimited", async () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [RECIPIENT, 100n] });
    const result = await decode({ chainId: 8453, to: USDC, data, value: "0x0" });
    if (result.kind !== "approve") throw new Error();
    expect(result.isUnlimited).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test, see it fail**

Run: `pnpm --filter @intent-check/decoder test`
Expected: FAIL — `decode` is not defined / module not found.

- [ ] **Step 6: Implement `selector.ts`**

Create `packages/decoder/src/selector.ts`:

```ts
import { slice, type Hex } from "viem";

export function selectorOf(data: Hex | string): Hex {
  if (!data || data === "0x") return "0x" as Hex;
  return slice(data as Hex, 0, 4);
}
```

- [ ] **Step 7: Implement `recognizers/erc20.ts`**

Create `packages/decoder/src/recognizers/erc20.ts`:

```ts
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { DecodedAction } from "@intent-check/types";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

const ERC20_SELECTORS = new Set(["0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0xa22cb465"]);

export function tryDecodeErc20(input: { to: string; data: string }): DecodedAction | null {
  const sel = (input.data ?? "").slice(0, 10).toLowerCase();
  if (!ERC20_SELECTORS.has(sel)) return null;

  const decoded = decodeFunctionData({ abi: ERC20_ABI, data: input.data as `0x${string}` });
  const token = getAddress(input.to);

  switch (decoded.functionName) {
    case "transfer":
      return { kind: "transfer", token, to: getAddress(decoded.args[0]), amount: decoded.args[1].toString() };
    case "transferFrom":
      return { kind: "transfer", token, to: getAddress(decoded.args[1]), amount: decoded.args[2].toString() };
    case "approve": {
      const amount = decoded.args[1];
      const MAX = (1n << 256n) - 1n;
      // Treat anything >= 2^255 as effectively unlimited.
      const isUnlimited = amount >= (1n << 255n) || amount === MAX;
      return { kind: "approve", token, spender: getAddress(decoded.args[0]), amount: amount.toString(), isUnlimited };
    }
    case "setApprovalForAll":
      return { kind: "setApprovalForAll", collection: token, operator: getAddress(decoded.args[0]), approved: decoded.args[1] };
  }
  return null;
}
```

- [ ] **Step 8: Implement `recognizers/index.ts`**

Create `packages/decoder/src/recognizers/index.ts`:

```ts
import type { DecodedAction } from "@intent-check/types";
import { tryDecodeErc20 } from "./erc20";

export type DecodeContext = { chainId: number; to: string; data: string; value: string };
export type Recognizer = (ctx: DecodeContext) => DecodedAction | null | Promise<DecodedAction | null>;

export const recognizers: Recognizer[] = [tryDecodeErc20];
```

- [ ] **Step 9: Implement `src/index.ts`**

Create `packages/decoder/src/index.ts`:

```ts
import type { DecodedAction } from "@intent-check/types";
import { recognizers, type DecodeContext } from "./recognizers";
import { selectorOf } from "./selector";

export async function decode(ctx: DecodeContext): Promise<DecodedAction> {
  for (const r of recognizers) {
    const result = await r(ctx);
    if (result) return result;
  }
  return { kind: "unknown", selector: selectorOf(ctx.data) };
}

export { selectorOf };
```

- [ ] **Step 10: Run the test, see it pass**

Run: `pnpm --filter @intent-check/decoder test`
Expected: 3 passed.

- [ ] **Step 11: Commit**

```bash
git add packages/decoder pnpm-lock.yaml
git commit -m "feat(decoder): erc20 transfer/approve recognizer with unlimited-approval flag"
```

---

## Task 4: Decoder — Uniswap Universal Router recognizer (TDD)

**Files:**
- Create: `packages/decoder/src/recognizers/uniswapUniversalRouter.ts`
- Modify: `packages/decoder/src/recognizers/index.ts`
- Create: `packages/decoder/tests/uniswapUniversalRouter.test.ts`

**Background.** Universal Router exposes `execute(bytes commands, bytes[] inputs, uint256 deadline)`. Each byte in `commands` is a command id; we care about `V3_SWAP_EXACT_IN` (`0x00`), `V3_SWAP_EXACT_OUT` (`0x01`), `V2_SWAP_EXACT_IN` (`0x08`), `V2_SWAP_EXACT_OUT` (`0x09`), `WRAP_ETH` (`0x0b`), `UNWRAP_WETH` (`0x0c`). For MVP we decode `V3_SWAP_EXACT_IN` only and treat any other commands present as `kind:'swap'` with reduced confidence (we still surface the action).

**Universal Router on Base:** `0x6fF5693b99212Da76ad316178A184AB56D299b43`.

- [ ] **Step 1: Write the failing test**

Create `packages/decoder/tests/uniswapUniversalRouter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeFunctionData, encodeAbiParameters, encodePacked } from "viem";
import { decode } from "../src/index";

const ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const UR_ABI = [
  { type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function buildV3SwapExactInInput(recipient: string, amountIn: bigint, amountOutMin: bigint, path: `0x${string}`, payerIsUser: boolean): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
    ],
    [recipient as `0x${string}`, amountIn, amountOutMin, path, payerIsUser]
  );
}

describe("uniswap universal router", () => {
  it("decodes V3_SWAP_EXACT_IN as a swap", async () => {
    const path = encodePacked(["address", "uint24", "address"], [USDC, 500, WETH]);
    const input = buildV3SwapExactInInput(RECIPIENT, 100_000000n, 28_000_000_000_000_000n, path, true);
    const data = encodeFunctionData({
      abi: UR_ABI, functionName: "execute",
      args: ["0x00", [input], BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
    const result = await decode({ chainId: 8453, to: ROUTER, data, value: "0x0" });
    expect(result.kind).toBe("swap");
    if (result.kind !== "swap") throw new Error();
    expect(result.protocol).toBe("Uniswap");
    expect(result.tokenIn.address.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.tokenOut.address.toLowerCase()).toBe(WETH.toLowerCase());
    expect(result.tokenIn.amount).toBe("100000000");
    expect(result.minAmountOut).toBe("28000000000000000");
    expect(result.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.router.toLowerCase()).toBe(ROUTER.toLowerCase());
  });
});
```

- [ ] **Step 2: Run, see it fail**

Run: `pnpm --filter @intent-check/decoder test`
Expected: FAIL on the new test — recognizer returns `unknown`.

- [ ] **Step 3: Implement the Universal Router recognizer**

Create `packages/decoder/src/recognizers/uniswapUniversalRouter.ts`:

```ts
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, slice, type Hex } from "viem";
import type { DecodedAction } from "@intent-check/types";

const ROUTERS: Record<number, string> = {
  1: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",         // ethereum mainnet UR v2
  8453: "0x6fF5693b99212Da76ad316178A184AB56D299b43",      // base
};

const UR_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);

const CMD_V3_SWAP_EXACT_IN = 0x00;
const CMD_V3_SWAP_EXACT_OUT = 0x01;
const CMD_V2_SWAP_EXACT_IN = 0x08;
const CMD_V2_SWAP_EXACT_OUT = 0x09;

function isSwapCommand(c: number): boolean {
  return c === CMD_V3_SWAP_EXACT_IN || c === CMD_V3_SWAP_EXACT_OUT
      || c === CMD_V2_SWAP_EXACT_IN || c === CMD_V2_SWAP_EXACT_OUT;
}

function firstAndLastTokenInV3Path(path: Hex): { first: string; last: string } {
  // Path layout: address (20) + fee (3) + address (20) + ...
  const bytes = path.slice(2);
  const first = "0x" + bytes.slice(0, 40);
  const last = "0x" + bytes.slice(bytes.length - 40);
  return { first: getAddress(first), last: getAddress(last) };
}

export function tryDecodeUniversalRouter(input: { chainId: number; to: string; data: string }): DecodedAction | null {
  const expected = ROUTERS[input.chainId];
  if (!expected || expected.toLowerCase() !== input.to.toLowerCase()) return null;
  if (!input.data || input.data.length < 10) return null;
  if (input.data.slice(0, 10).toLowerCase() !== "0x3593564c") return null; // execute selector

  const { args } = decodeFunctionData({ abi: UR_ABI, data: input.data as Hex });
  const [commandsHex, inputs] = args as [Hex, Hex[], bigint];
  const commands = Array.from(commandsHex.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16) & 0x3f);

  const swapIdx = commands.findIndex(isSwapCommand);
  if (swapIdx === -1) return null;
  const cmd = commands[swapIdx]!;
  const swapInput = inputs[swapIdx]!;

  if (cmd === CMD_V3_SWAP_EXACT_IN) {
    const [recipient, amountIn, amountOutMin, path] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
      swapInput
    );
    const { first, last } = firstAndLastTokenInV3Path(path as Hex);
    return {
      kind: "swap",
      tokenIn:  { chainId: input.chainId, address: first, amount: (amountIn as bigint).toString() },
      tokenOut: { chainId: input.chainId, address: last,  amount: "0" },
      minAmountOut: (amountOutMin as bigint).toString(),
      recipient: getAddress(recipient as string),
      router: getAddress(input.to),
      protocol: "Uniswap",
    };
  }

  // Other swap commands: surface a low-confidence swap pointing at the router.
  return {
    kind: "swap",
    tokenIn:  { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
    tokenOut: { chainId: input.chainId, address: "0x0000000000000000000000000000000000000000", amount: "0" },
    minAmountOut: "0",
    recipient: getAddress(input.to),
    router: getAddress(input.to),
    protocol: "Uniswap",
  };
}
```

- [ ] **Step 4: Register the recognizer**

Modify `packages/decoder/src/recognizers/index.ts`:

```ts
import type { DecodedAction } from "@intent-check/types";
import { tryDecodeErc20 } from "./erc20";
import { tryDecodeUniversalRouter } from "./uniswapUniversalRouter";

export type DecodeContext = { chainId: number; to: string; data: string; value: string };
export type Recognizer = (ctx: DecodeContext) => DecodedAction | null | Promise<DecodedAction | null>;

export const recognizers: Recognizer[] = [tryDecodeUniversalRouter, tryDecodeErc20];
```

- [ ] **Step 5: Run the tests, see them pass**

Run: `pnpm --filter @intent-check/decoder test`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/decoder
git commit -m "feat(decoder): Uniswap Universal Router recognizer (V3 exact-in)"
```

---

## Task 5: Judge backend — Hono skeleton with hardcoded SAFE

**Files:**
- Create: `apps/judge/package.json`
- Create: `apps/judge/tsconfig.json`
- Create: `apps/judge/wrangler.toml`
- Create: `apps/judge/src/index.ts`
- Create: `apps/judge/src/judge.ts`
- Create: `apps/judge/tests/judge.test.ts`

- [ ] **Step 1: Create `apps/judge/package.json`**

```json
{
  "name": "@intent-check/judge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@intent-check/types": "workspace:*",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240924.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `apps/judge/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/judge/wrangler.toml`**

```toml
name = "intent-check-judge"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
JUDGE_API_KEY = "local-dev-key"
```

- [ ] **Step 4: Install deps**

Run: `pnpm install`

- [ ] **Step 5: Write the failing test**

Create `apps/judge/tests/judge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput } from "@intent-check/types";

function makeApp() {
  const app = new Hono();
  mountJudge(app, { stubVerdict: true });
  return app;
}

const baseInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
  decoded: {
    kind: "swap",
    tokenIn:  { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" },
    tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" },
    minAmountOut: "28000000000000000",
    recipient: "0x000000000000000000000000000000000000dEaD",
    router:    "0x6fF5693b99212Da76ad316178A184AB56D299b43",
    protocol:  "Uniswap",
  },
  contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false },
  origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
  findings: [],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x6fF5693b99212Da76ad316178A184AB56D299b43" }] },
};

describe("/judge stub", () => {
  it("returns SAFE for a recognized swap intent", async () => {
    const app = makeApp();
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "local-dev-key" },
      body: JSON.stringify(baseInput),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("SAFE");
    expect(typeof body.headline).toBe("string");
  });

  it("rejects requests without an API key", async () => {
    const app = makeApp();
    const res = await app.request("/judge", { method: "POST", body: JSON.stringify(baseInput), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run, see it fail**

Run: `pnpm --filter @intent-check/judge test`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `judge.ts` with the stub branch**

Create `apps/judge/src/judge.ts`:

```ts
import type { Hono } from "hono";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  apiKey?: string;
}

export function mountJudge(app: Hono, opts: JudgeOptions) {
  app.post("/judge", async (c) => {
    const apiKey = opts.apiKey ?? "local-dev-key";
    if (c.req.header("x-api-key") !== apiKey) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const input = (await c.req.json()) as JudgeInput;

    if (opts.stubVerdict) {
      const verdict: JudgeVerdict = {
        tier: "SAFE",
        headline: stubHeadline(input),
        reasons: [{ severity: "info", text: "Stubbed verdict (M1)." }],
        confidence: 0.5,
      };
      return c.json(verdict);
    }

    // M2 path will replace this branch.
    return c.json({ error: "llm path not implemented" }, 501);
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") {
    return `Looks fine — ${input.intent.summary}`;
  }
  return `Verdict for ${input.decoded.kind}`;
}
```

- [ ] **Step 8: Implement `index.ts`**

Create `apps/judge/src/index.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountJudge } from "./judge";

export interface Env {
  ANTHROPIC_API_KEY: string;
  JUDGE_API_KEY: string;
  STUB_VERDICT?: string;
}

// Build the app once per Worker instance; read env on first request via a lazy mount.
const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "x-api-key"] }));
app.get("/", (c) => c.text("intent-check judge ok"));

let mounted = false;
app.use("*", async (c, next) => {
  if (!mounted) {
    mountJudge(app, {
      stubVerdict: c.env.STUB_VERDICT === "1",
      anthropicApiKey: c.env.ANTHROPIC_API_KEY,
      apiKey: c.env.JUDGE_API_KEY,
    });
    mounted = true;
  }
  await next();
});

export default app;
```

Note: For Node-deploy you can swap the export for `serve({ fetch: app.fetch })` from `@hono/node-server`. Tests bypass `index.ts` entirely and call `mountJudge` directly, so the Worker bootstrap is not on the test path.

- [ ] **Step 9: Run, see tests pass**

Run: `pnpm --filter @intent-check/judge test`
Expected: 2 passed.

- [ ] **Step 10: Smoke-test live**

Run (background): `pnpm --filter @intent-check/judge dev`
In another terminal:
```bash
curl -s -X POST http://127.0.0.1:8787/judge \
  -H 'content-type: application/json' \
  -H 'x-api-key: local-dev-key' \
  -d '{"intent":{"kind":"swap","summary":"x","confidence":0.5},"decoded":{"kind":"unknown","selector":"0x"},"contract":{"address":"0x0","chainId":8453,"verified":false,"isProxy":false},"origin":{"url":"x","origin":"x"},"findings":[],"request":{"method":"eth_sendTransaction","params":[{"from":"0x0","to":"0x0"}]}}'
```

In `wrangler.toml`, temporarily set `STUB_VERDICT = "1"` for this smoke test, then revert.
Expected: JSON with `"tier":"SAFE"`.

- [ ] **Step 11: Commit**

```bash
git add apps/judge pnpm-lock.yaml
git commit -m "feat(judge): Hono skeleton with stubbed SAFE verdict"
```

---

## Task 6: Extension — Vite + CRXJS skeleton + manifest

**Files:**
- Create: `apps/extension/package.json`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/vite.config.ts`
- Create: `apps/extension/manifest.config.ts`
- Create: `apps/extension/src/popup/index.html`
- Create: `apps/extension/src/popup/main.tsx`
- Create: `apps/extension/src/popup/App.tsx`
- Create: `apps/extension/src/background.ts` (placeholder)
- Create: `apps/extension/src/content-script.ts` (placeholder)
- Create: `apps/extension/src/inpage.ts` (placeholder)
- Create: `apps/extension/src/shared/config.ts`

- [ ] **Step 1: Create `apps/extension/package.json`**

```json
{
  "name": "@intent-check/extension",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@intent-check/decoder": "workspace:*",
    "@intent-check/types": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.28",
    "@types/chrome": "^0.0.270",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/extension/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["chrome", "vite/client"],
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts", "manifest.config.ts"]
}
```

- [ ] **Step 3: Create `apps/extension/manifest.config.ts`**

```ts
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Intent Check",
  description: "Tells you whether a Web3 transaction matches your intent.",
  version: "0.0.1",
  action: { default_popup: "src/popup/index.html", default_title: "Intent Check" },
  background: { service_worker: "src/background.ts", type: "module" },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content-script.ts"],
      run_at: "document_start",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    { resources: ["src/inpage.ts", "assets/*"], matches: ["http://*/*", "https://*/*"] },
  ],
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["http://*/*", "https://*/*"],
});
```

- [ ] **Step 4: Create `apps/extension/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: { rollupOptions: { input: { popup: "src/popup/index.html" } } },
});
```

- [ ] **Step 5: Create popup files**

`apps/extension/src/popup/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Intent Check</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`apps/extension/src/popup/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

`apps/extension/src/popup/App.tsx`:

```tsx
export function App() {
  return (
    <div style={{ width: 320, padding: 12, fontFamily: "system-ui" }}>
      <h2>Intent Check</h2>
      <p>No active request.</p>
    </div>
  );
}
```

- [ ] **Step 6: Create placeholder background/content/inpage**

`apps/extension/src/background.ts`:

```ts
console.log("[intent-check] background loaded");
```

`apps/extension/src/content-script.ts`:

```ts
console.log("[intent-check] content script loaded on", location.href);
```

`apps/extension/src/inpage.ts`:

```ts
console.log("[intent-check] inpage loaded");
```

- [ ] **Step 7: Create config**

`apps/extension/src/shared/config.ts`:

```ts
export const JUDGE_URL = "http://127.0.0.1:8787/judge";
export const JUDGE_API_KEY = "local-dev-key";
export const SUPPORTED_CHAIN_IDS = [1, 8453];
```

- [ ] **Step 8: Build the extension**

Run: `pnpm install && pnpm --filter @intent-check/extension build`
Expected: `dist/` folder produced; no errors.

- [ ] **Step 9: Manual load**

Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `apps/extension/dist`. Open any page; check the service-worker console shows `background loaded`.

- [ ] **Step 10: Commit**

```bash
git add apps/extension pnpm-lock.yaml
git commit -m "feat(extension): MV3 skeleton with Vite + CRXJS, popup placeholder"
```

---

## Task 7: Extension — inpage proxy + content-script bridge + pending-request registry

**Files:**
- Create: `apps/extension/src/shared/messaging.ts`
- Create: `apps/extension/src/shared/pendingRequests.ts`
- Modify: `apps/extension/src/inpage.ts`
- Modify: `apps/extension/src/content-script.ts`

- [ ] **Step 1: Create `messaging.ts` with the typed message contract**

`apps/extension/src/shared/messaging.ts`:

```ts
import type { JudgeInput, JudgeVerdict, WalletRequest } from "@intent-check/types";

// Inpage <-> content-script messages travel via window.postMessage with a marker.
export const IC_PORT = "intent-check";

export type InpageToContent =
  | { kind: "wallet_request"; id: string; origin: string; request: WalletRequest }
  | { kind: "ping" };

export type ContentToInpage =
  | { kind: "verdict"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "error"; id: string; message: string };

// Content-script <-> background messages use chrome.runtime.
export type ContentToBackground =
  | { kind: "judge_request"; id: string; tabId?: number; payload: { request: WalletRequest; origin: string; pageSnapshot: PageSnapshot } };

export type BackgroundToContent =
  | { kind: "judge_result"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "judge_error"; id: string; message: string };

export interface PageSnapshot {
  url: string;
  origin: string;
  title?: string;
  ogTitle?: string;
  ogSiteName?: string;
  visibleButtonText?: string;
}
```

- [ ] **Step 2: Create the pending-request registry**

`apps/extension/src/shared/pendingRequests.ts`:

```ts
type Resolver = (decision: "approve" | "reject") => void;

const registry = new Map<string, Resolver>();

export function register(id: string, resolve: Resolver) {
  registry.set(id, resolve);
}

export function settle(id: string, decision: "approve" | "reject") {
  const fn = registry.get(id);
  if (!fn) return;
  registry.delete(id);
  fn(decision);
}

export function size() { return registry.size; }
```

- [ ] **Step 3: Implement `inpage.ts` (window.ethereum proxy)**

Replace `apps/extension/src/inpage.ts`:

```ts
import { IC_PORT, type ContentToInpage, type InpageToContent } from "./shared/messaging";

(function install() {
  const target = (window as any).ethereum;
  if (!target) {
    // Wait for injection: most wallets define window.ethereum after page load.
    const i = setInterval(() => {
      if ((window as any).ethereum) { clearInterval(i); install(); }
    }, 100);
    return;
  }

  const interceptedMethods = new Set([
    "eth_sendTransaction",
    "eth_signTypedData_v4",
    "personal_sign",
    "wallet_sendCalls",
  ]);

  const originalRequest = target.request.bind(target);

  target.request = async function patched(args: { method: string; params?: unknown[] }) {
    if (!interceptedMethods.has(args.method)) {
      return originalRequest(args);
    }

    const id = crypto.randomUUID();
    const msg: InpageToContent = {
      kind: "wallet_request",
      id,
      origin: location.origin,
      request: { method: args.method, params: (args.params as any) ?? [] } as any,
    };
    window.postMessage({ port: IC_PORT, payload: msg }, "*");

    const decision = await new Promise<"approve" | "reject">((resolve) => {
      function onMessage(ev: MessageEvent) {
        if (ev.source !== window) return;
        const data = (ev.data ?? {}) as { port?: string; payload?: ContentToInpage };
        if (data.port !== IC_PORT || !data.payload) return;
        const p = data.payload;
        if ("id" in p && p.id !== id) return;
        if (p.kind === "verdict") { window.removeEventListener("message", onMessage); resolve(p.userDecision); }
        if (p.kind === "error")   { window.removeEventListener("message", onMessage); resolve("reject"); }
      }
      window.addEventListener("message", onMessage);
    });

    if (decision === "reject") {
      throw { code: 4001, message: "User rejected the request (intent-check)." };
    }
    return originalRequest(args);
  };

  console.log("[intent-check] window.ethereum patched");
})();
```

- [ ] **Step 4: Implement the content script bridge**

Replace `apps/extension/src/content-script.ts`:

```ts
import { IC_PORT, type InpageToContent, type ContentToInpage, type ContentToBackground, type BackgroundToContent, type PageSnapshot } from "./shared/messaging";

// Inject inpage script into the page's main world.
const s = document.createElement("script");
s.src = chrome.runtime.getURL("src/inpage.ts");
s.type = "module";
(document.head || document.documentElement).appendChild(s);

function snapshot(): PageSnapshot {
  const og = (k: string) => document.querySelector<HTMLMetaElement>(`meta[property="og:${k}"]`)?.content;
  const visibleBtn = document.activeElement instanceof HTMLElement ? document.activeElement.innerText?.trim().slice(0, 80) : undefined;
  return {
    url: location.href,
    origin: location.origin,
    title: document.title,
    ogTitle: og("title"),
    ogSiteName: og("site_name"),
    visibleButtonText: visibleBtn,
  };
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = (ev.data ?? {}) as { port?: string; payload?: InpageToContent };
  if (data.port !== IC_PORT || !data.payload) return;
  if (data.payload.kind !== "wallet_request") return;
  const { id, request, origin } = data.payload;
  const msg: ContentToBackground = { kind: "judge_request", id, payload: { request, origin, pageSnapshot: snapshot() } };
  chrome.runtime.sendMessage(msg).catch((e) => {
    const reply: ContentToInpage = { kind: "error", id, message: String(e) };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  });
});

chrome.runtime.onMessage.addListener((msg: BackgroundToContent) => {
  if (msg.kind === "judge_result") {
    const reply: ContentToInpage = { kind: "verdict", id: msg.id, verdict: msg.verdict, userDecision: msg.userDecision };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  } else if (msg.kind === "judge_error") {
    const reply: ContentToInpage = { kind: "error", id: msg.id, message: msg.message };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  }
});
```

- [ ] **Step 5: Smoke test build**

Run: `pnpm --filter @intent-check/extension build`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src
git commit -m "feat(extension): inpage proxy + content-script bridge"
```

---

## Task 8: Extension — background orchestrator + popup verdict UI (M1 wiring)

**Files:**
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/src/popup/App.tsx`
- Create: `apps/extension/src/popup/components/VerdictChip.tsx`
- Modify: `apps/extension/src/shared/pendingRequests.ts` (already exists, no changes)

**Background flow.** Receive `judge_request` → run `decode()` → POST to `/judge` → store the verdict + the original `judge_request` keyed by `id` in `chrome.storage.session` → open popup. The popup reads the latest pending request from session storage, lets the user click `Sign` or `Reject`, then sends the decision back to the original tab via `chrome.tabs.sendMessage`.

- [ ] **Step 1: Implement background**

Replace `apps/extension/src/background.ts`:

```ts
import { decode } from "@intent-check/decoder";
import type { JudgeInput, JudgeVerdict, WalletRequest, ContractMeta, OriginSignals, UserIntent } from "@intent-check/types";
import type { ContentToBackground, BackgroundToContent, PageSnapshot } from "./shared/messaging";
import { JUDGE_URL, JUDGE_API_KEY } from "./shared/config";

interface PendingItem {
  id: string;
  tabId: number;
  request: WalletRequest;
  origin: string;
  pageSnapshot: PageSnapshot;
  verdict: JudgeVerdict;
  decoded: JudgeInput["decoded"];
}

async function setPending(item: PendingItem) {
  await chrome.storage.session.set({ [`pending:${item.id}`]: item, lastPendingId: item.id });
}

async function getPending(id: string): Promise<PendingItem | undefined> {
  const r = await chrome.storage.session.get([`pending:${id}`]);
  return r[`pending:${id}`];
}

async function clearPending(id: string) {
  await chrome.storage.session.remove([`pending:${id}`]);
}

function inferIntent(snapshot: PageSnapshot): UserIntent {
  const text = [snapshot.title, snapshot.ogTitle, snapshot.ogSiteName, snapshot.visibleButtonText].filter(Boolean).join(" | ").toLowerCase();
  if (/swap/.test(text))      return { kind: "swap",   summary: snapshot.title ?? "Swap on this dApp",      confidence: 0.6 };
  if (/approve/.test(text))   return { kind: "approve",summary: snapshot.title ?? "Approve token",          confidence: 0.5 };
  if (/mint/.test(text))      return { kind: "mint",   summary: snapshot.title ?? "Mint NFT",               confidence: 0.5 };
  if (/deposit|stake/.test(text)) return { kind: "deposit", summary: snapshot.title ?? "Deposit",           confidence: 0.5 };
  if (/bridge/.test(text))    return { kind: "bridge", summary: snapshot.title ?? "Bridge",                 confidence: 0.5 };
  return { kind: "other", summary: snapshot.title ?? "Unknown action", confidence: 0.2 };
}

async function callJudge(input: JudgeInput): Promise<JudgeVerdict> {
  const res = await fetch(JUDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": JUDGE_API_KEY },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`judge ${res.status}`);
  return (await res.json()) as JudgeVerdict;
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender, sendResponse) => {
  if (msg.kind !== "judge_request") return;
  (async () => {
    try {
      const tabId = sender.tab?.id;
      if (tabId === undefined) throw new Error("no tab id");
      const { request, origin, pageSnapshot } = msg.payload;

      // Only handle eth_sendTransaction in M1; signature paths land in M3.
      if (request.method !== "eth_sendTransaction") {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: "method not supported in M1" };
        chrome.tabs.sendMessage(tabId, reply);
        return;
      }
      const tx = request.params[0];
      const chainIdHex = tx.chainId ?? "0x2105"; // default base
      const chainId = parseInt(chainIdHex, 16);

      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });

      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = { address: tx.to, chainId, verified: false, isProxy: false };
      const originSig: OriginSignals = { url: pageSnapshot.url, origin, pageTitle: pageSnapshot.title, ogTitle: pageSnapshot.ogTitle, ogSiteName: pageSnapshot.ogSiteName, visibleButtonText: pageSnapshot.visibleButtonText };

      const judgeInput: JudgeInput = { intent, decoded, contract, origin: originSig, findings: [], request };
      const verdict = await callJudge(judgeInput);

      await setPending({ id: msg.id, tabId, request, origin, pageSnapshot, verdict, decoded });
      await chrome.action.openPopup().catch(() => { /* user gesture required; popup will be opened by user clicking the action */ });
    } catch (e) {
      const tabId = sender.tab?.id;
      const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) };
      if (tabId !== undefined) chrome.tabs.sendMessage(tabId, reply);
    }
  })();
  return false;
});

// Popup → background: user decision.
chrome.runtime.onMessage.addListener((msg: { kind: "user_decision"; id: string; decision: "approve" | "reject" }) => {
  if (msg.kind !== "user_decision") return;
  (async () => {
    const item = await getPending(msg.id);
    if (!item) return;
    const reply: BackgroundToContent = { kind: "judge_result", id: msg.id, verdict: item.verdict, userDecision: msg.decision };
    chrome.tabs.sendMessage(item.tabId, reply);
    await clearPending(msg.id);
  })();
  return false;
});
```

- [ ] **Step 2: Create the verdict chip component**

`apps/extension/src/popup/components/VerdictChip.tsx`:

```tsx
import type { VerdictTier } from "@intent-check/types";

const colors: Record<VerdictTier, string> = {
  SAFE: "#1a7f37",
  CAUTION: "#9a6700",
  DANGER: "#cf222e",
};

export function VerdictChip({ tier }: { tier: VerdictTier }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      background: colors[tier], color: "white", fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
    }}>
      {tier}
    </span>
  );
}
```

- [ ] **Step 3: Wire the popup**

Replace `apps/extension/src/popup/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { VerdictChip } from "./components/VerdictChip";
import type { JudgeVerdict, DecodedAction } from "@intent-check/types";

interface PendingItem {
  id: string;
  verdict: JudgeVerdict;
  decoded: DecodedAction;
  origin: string;
  pageSnapshot: { title?: string };
}

export function App() {
  const [item, setItem] = useState<PendingItem | null>(null);

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.session.get(["lastPendingId"]);
      const id = r.lastPendingId as string | undefined;
      if (!id) return;
      const r2 = await chrome.storage.session.get([`pending:${id}`]);
      setItem(r2[`pending:${id}`] ?? null);
    })();
  }, []);

  async function decide(decision: "approve" | "reject") {
    if (!item) return;
    await chrome.runtime.sendMessage({ kind: "user_decision", id: item.id, decision });
    window.close();
  }

  if (!item) {
    return <div style={{ width: 320, padding: 12, fontFamily: "system-ui" }}><h3>Intent Check</h3><p>No active request.</p></div>;
  }

  return (
    <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <VerdictChip tier={item.verdict.tier} />
      </div>
      <p style={{ marginTop: 8 }}>{item.verdict.headline}</p>
      <details>
        <summary>Details</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(item.decoded, null, 2)}</pre>
        <p style={{ fontSize: 11, color: "#555" }}>Origin: {item.origin}</p>
      </details>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => decide("reject")} style={{ flex: 1 }}>Reject</button>
        <button onClick={() => decide("approve")} style={{ flex: 1, background: "#1a7f37", color: "white" }}>Sign</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build the extension**

Run: `pnpm --filter @intent-check/extension build`
Expected: clean build.

- [ ] **Step 5: Manual end-to-end smoke test**

1. Start the judge: `pnpm --filter @intent-check/judge dev` (set `STUB_VERDICT = "1"` in `wrangler.toml` for now).
2. Reload the extension in `chrome://extensions`.
3. Visit `https://app.uniswap.org/swap?chain=base`, connect MetaMask on Base.
4. Initiate a swap (any small amount). When MetaMask would normally pop up, the Intent Check popup should appear instead. Click the extension icon if it doesn't auto-open (Chrome restricts auto-popup to user gestures).
5. Verify: green `SAFE` chip, headline mentions the inferred swap, details show the decoded swap structure, "Sign" forwards to MetaMask, "Reject" cancels.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src
git commit -m "feat(extension): background orchestrator + popup verdict UI (M1 wiring)"
```

---

# M2 — Real LLM judgment + Tenderly + Sourcify + intent confirmation

## Task 9: Sourcify client (TDD)

**Files:**
- Create: `packages/sourcify-client/package.json`
- Create: `packages/sourcify-client/tsconfig.json`
- Create: `packages/sourcify-client/src/index.ts`
- Create: `packages/sourcify-client/tests/index.test.ts`
- Create: `packages/sourcify-client/tests/fixtures/usdc-base.json`

**Sourcify API.** `GET https://sourcify.dev/server/files/any/{chainId}/{address}` returns `{ "status": "perfect"|"partial", "files": [{ name, content }, ...] }`. The ABI is in the `metadata.json` file's content (JSON-encoded; parse `output.abi`). For "not verified" Sourcify returns 404.

- [ ] **Step 1: Create package boilerplate**

`packages/sourcify-client/package.json`:

```json
{
  "name": "@intent-check/sourcify-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@intent-check/types": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`packages/sourcify-client/tsconfig.json` — same as decoder's.

- [ ] **Step 2: Add a fixture**

Create `packages/sourcify-client/tests/fixtures/usdc-base.json` with a minimal Sourcify response shape:

```json
{
  "status": "perfect",
  "files": [
    {
      "name": "metadata.json",
      "content": "{\"output\":{\"abi\":[{\"type\":\"function\",\"name\":\"transfer\",\"inputs\":[{\"name\":\"to\",\"type\":\"address\"},{\"name\":\"amount\",\"type\":\"uint256\"}],\"outputs\":[{\"type\":\"bool\"}],\"stateMutability\":\"nonpayable\"}]},\"settings\":{\"compilationTarget\":{\"contracts/USDC.sol\":\"USDC\"}}}"
    }
  ]
}
```

- [ ] **Step 3: Write the failing test**

`packages/sourcify-client/tests/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/usdc-base.json";
import { fetchVerifiedContract } from "../src/index";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("sourcify-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes(USDC.toLowerCase())) {
        return new Response(JSON.stringify(fixture), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns ABI and contract name for a verified contract", async () => {
    const r = await fetchVerifiedContract({ chainId: 8453, address: USDC });
    expect(r.verified).toBe(true);
    expect(r.contractName).toBe("USDC");
    expect(Array.isArray(r.abi)).toBe(true);
    expect(r.abi[0].name).toBe("transfer");
  });

  it("returns verified=false for unknown contract", async () => {
    const r = await fetchVerifiedContract({ chainId: 8453, address: "0x000000000000000000000000000000000000dEaD" });
    expect(r.verified).toBe(false);
    expect(r.abi).toEqual([]);
  });
});
```

- [ ] **Step 4: Run, see fail**

Run: `pnpm --filter @intent-check/sourcify-client test`
Expected: FAIL.

- [ ] **Step 5: Implement**

`packages/sourcify-client/src/index.ts`:

```ts
export interface VerifiedContract {
  verified: boolean;
  contractName?: string;
  abi: any[];
  matchType?: "perfect" | "partial";
}

export async function fetchVerifiedContract(args: { chainId: number; address: string; baseUrl?: string }): Promise<VerifiedContract> {
  const baseUrl = args.baseUrl ?? "https://sourcify.dev/server";
  const url = `${baseUrl}/files/any/${args.chainId}/${args.address.toLowerCase()}`;
  const res = await fetch(url);
  if (res.status === 404) return { verified: false, abi: [] };
  if (!res.ok) return { verified: false, abi: [] };
  const body = await res.json() as { status: "perfect" | "partial"; files: { name: string; content: string }[] };

  const meta = body.files.find((f) => f.name === "metadata.json");
  if (!meta) return { verified: true, abi: [], matchType: body.status };
  const parsed = JSON.parse(meta.content) as { output?: { abi?: any[] }; settings?: { compilationTarget?: Record<string, string> } };

  const target = parsed.settings?.compilationTarget;
  const contractName = target ? Object.values(target)[0] : undefined;

  return { verified: true, abi: parsed.output?.abi ?? [], matchType: body.status, contractName };
}
```

- [ ] **Step 6: Run, see pass**

Run: `pnpm --filter @intent-check/sourcify-client test`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/sourcify-client pnpm-lock.yaml
git commit -m "feat(sourcify-client): fetch ABI + contract name with verified flag"
```

---

## Task 10: Tenderly client (TDD)

**Files:**
- Create: `packages/tenderly-client/package.json`
- Create: `packages/tenderly-client/tsconfig.json`
- Create: `packages/tenderly-client/src/index.ts`
- Create: `packages/tenderly-client/tests/index.test.ts`
- Create: `packages/tenderly-client/tests/fixtures/usdc-transfer.json`

**Tenderly API.** `POST https://api.tenderly.co/api/v1/account/{slug}/project/{slug}/simulate` with body `{network_id, from, to, input, value, save:false, simulation_type:"quick"}`. Auth via `X-Access-Key` header. Response includes `transaction.transaction_info.asset_changes` and `.balance_changes`. We normalize that into our `SimResult`.

- [ ] **Step 1: Create package boilerplate**

`packages/tenderly-client/package.json`:

```json
{
  "name": "@intent-check/tenderly-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@intent-check/types": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Add a fixture (trimmed)**

`packages/tenderly-client/tests/fixtures/usdc-transfer.json`:

```json
{
  "transaction": {
    "status": true,
    "gas_used": 51234,
    "transaction_info": {
      "asset_changes": [
        {
          "type": "Transfer",
          "from": "0xaaa0000000000000000000000000000000000001",
          "to":   "0xbbb0000000000000000000000000000000000002",
          "raw_amount": "100000000",
          "token_info": { "contract_address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "symbol": "USDC", "decimals": 6 }
        }
      ],
      "balance_changes": [
        { "address": "0xaaa0000000000000000000000000000000000001", "delta": "0" }
      ],
      "logs": []
    }
  }
}
```

- [ ] **Step 3: Write the failing test**

`packages/tenderly-client/tests/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "./fixtures/usdc-transfer.json";
import { simulate } from "../src/index";

describe("tenderly-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes asset_changes into SimResult.assetChanges", async () => {
    const r = await simulate({
      accessKey: "fake", accountSlug: "a", projectSlug: "p",
      network_id: "8453",
      from: "0xaaa0000000000000000000000000000000000001",
      to:   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      input: "0x", value: "0x0",
    });
    expect(r.success).toBe(true);
    expect(r.assetChanges).toHaveLength(1);
    expect(r.assetChanges[0].token.symbol).toBe("USDC");
    expect(r.assetChanges[0].token.amount).toBe("100000000");
  });
});
```

- [ ] **Step 4: Run, see fail**

Run: `pnpm --filter @intent-check/tenderly-client test`
Expected: FAIL.

- [ ] **Step 5: Implement**

`packages/tenderly-client/src/index.ts`:

```ts
import type { SimResult, AssetChange } from "@intent-check/types";

export interface SimulateArgs {
  accessKey: string;
  accountSlug: string;
  projectSlug: string;
  network_id: string;
  from: string;
  to: string;
  input: string;
  value: string;
  baseUrl?: string;
}

interface RawAssetChange {
  type: string;
  from: string;
  to: string;
  raw_amount: string;
  token_info?: { contract_address: string; symbol?: string; decimals?: number };
}

export async function simulate(args: SimulateArgs): Promise<SimResult> {
  const baseUrl = args.baseUrl ?? "https://api.tenderly.co";
  const url = `${baseUrl}/api/v1/account/${args.accountSlug}/project/${args.projectSlug}/simulate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Access-Key": args.accessKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      network_id: args.network_id, from: args.from, to: args.to, input: args.input, value: args.value,
      save: false, simulation_type: "quick",
    }),
  });
  if (!res.ok) {
    return { success: false, failureReason: `tenderly ${res.status}`, assetChanges: [], balanceChanges: [], gasUsed: "0", logs: [] };
  }
  const body = await res.json() as { transaction: { status: boolean; gas_used: number; transaction_info: { asset_changes?: RawAssetChange[]; balance_changes?: { address: string; delta: string }[]; logs?: any[] } } };
  const tx = body.transaction;
  const info = tx.transaction_info;

  const assetChanges: AssetChange[] = (info.asset_changes ?? []).map((c): AssetChange => ({
    type: c.type === "Mint" ? "mint" : c.type === "Burn" ? "burn" : "transfer",
    from: c.from, to: c.to,
    token: {
      chainId: parseInt(args.network_id, 10),
      address: c.token_info?.contract_address ?? args.to,
      symbol: c.token_info?.symbol,
      decimals: c.token_info?.decimals,
      amount: c.raw_amount,
    },
  }));

  return {
    success: tx.status,
    assetChanges,
    balanceChanges: (info.balance_changes ?? []).map((b) => ({ address: b.address, delta: b.delta })),
    gasUsed: String(tx.gas_used),
    logs: [],
  };
}
```

- [ ] **Step 6: Run, see pass**

Run: `pnpm --filter @intent-check/tenderly-client test`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/tenderly-client pnpm-lock.yaml
git commit -m "feat(tenderly-client): simulate() normalizing asset_changes"
```

---

## Task 11: Judge — Anthropic-backed verdict + safety floor (TDD)

**Files:**
- Create: `apps/judge/src/anthropic.ts`
- Create: `apps/judge/src/prompt.ts`
- Create: `apps/judge/src/safetyFloor.ts`
- Modify: `apps/judge/src/judge.ts`
- Modify: `apps/judge/package.json` (add `@anthropic-ai/sdk`)
- Create: `apps/judge/tests/safetyFloor.test.ts`
- Create: `apps/judge/tests/judge.live-stub.test.ts`

- [ ] **Step 1: Add Anthropic SDK**

Edit `apps/judge/package.json` — add `"@anthropic-ai/sdk": "^0.30.0"` to `dependencies`. Then `pnpm install`.

- [ ] **Step 2: Write the safety-floor test (TDD)**

`apps/judge/tests/safetyFloor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applySafetyFloor } from "../src/safetyFloor";
import type { JudgeVerdict, Finding } from "@intent-check/types";

const llm: JudgeVerdict = { tier: "SAFE", headline: "looks fine", reasons: [], confidence: 0.9 };

describe("safety floor", () => {
  it("upgrades SAFE to DANGER when a danger finding exists", () => {
    const findings: Finding[] = [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "unlimited approval" }];
    const r = applySafetyFloor(llm, findings);
    expect(r.tier).toBe("DANGER");
    expect(r.reasons.some((x) => x.text.includes("unlimited approval"))).toBe(true);
  });

  it("upgrades SAFE to CAUTION when only warn findings", () => {
    const findings: Finding[] = [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "contract is not verified" }];
    expect(applySafetyFloor(llm, findings).tier).toBe("CAUTION");
  });

  it("never downgrades a higher LLM tier", () => {
    const danger: JudgeVerdict = { ...llm, tier: "DANGER" };
    expect(applySafetyFloor(danger, []).tier).toBe("DANGER");
  });
});
```

- [ ] **Step 3: Run, see fail**

Run: `pnpm --filter @intent-check/judge test`
Expected: FAIL on safetyFloor test.

- [ ] **Step 4: Implement `safetyFloor.ts`**

`apps/judge/src/safetyFloor.ts`:

```ts
import { maxTier, type Finding, type JudgeVerdict, type VerdictTier } from "@intent-check/types";

function findingsTier(findings: Finding[]): VerdictTier {
  if (findings.some((f) => f.severity === "danger")) return "DANGER";
  if (findings.some((f) => f.severity === "warn"))   return "CAUTION";
  return "SAFE";
}

export function applySafetyFloor(llm: JudgeVerdict, findings: Finding[]): JudgeVerdict {
  const floor = findingsTier(findings);
  const tier = maxTier(llm.tier, floor);
  if (tier === llm.tier) return llm;

  const extraReasons = findings
    .filter((f) => (tier === "DANGER" && f.severity === "danger") || (tier === "CAUTION" && f.severity !== "info"))
    .map((f) => ({ severity: f.severity, text: f.text }));

  return {
    ...llm,
    tier,
    reasons: [...extraReasons, ...llm.reasons],
    headline: tier === "DANGER" ? `Stop — ${extraReasons[0]?.text ?? llm.headline}` : llm.headline,
  };
}
```

- [ ] **Step 5: Run, see pass**

Run: `pnpm --filter @intent-check/judge test`
Expected: 5 passed (3 new + 2 stub).

- [ ] **Step 6: Implement the prompt**

`apps/judge/src/prompt.ts`:

```ts
export const SYSTEM_PROMPT = `You are an intent-check judge for Web3 transactions.

Inputs you receive:
- intent: what the user says (or what we inferred) they want to do
- decoded: the structured action that the calldata actually performs
- sim: the simulated on-chain effect (asset transfers, balance deltas)
- contract: trust signals (verified, age, proxy, etc.)
- origin: signals about the dApp page (URL, title, lookalike checks)
- findings: deterministic findings already identified by our local checks

Your job:
1. Compare intent vs decoded vs sim. Are they consistent?
2. Produce a single-sentence headline that a non-technical user can act on.
3. Choose a tier:
   - SAFE: action matches intent, no concerning signals.
   - CAUTION: minor mismatches, surprising-but-not-clearly-malicious patterns.
   - DANGER: action contradicts intent OR clear phishing/drainer pattern.

Output JSON only with shape: { tier, headline, reasons: [{severity, text}], confidence }.
Severity values are "info" | "warn" | "danger".

Important rules:
- The headline is one short sentence in plain English.
- Reasons should be 2-4 short bullet points.
- If sim and decoded contradict each other, trust sim.
- You cannot soften a deterministic danger finding; explain it instead.`;

export const TOOL_DEFS: any[] = []; // M2: no tools; M3 may add lookup_token_metadata.
```

- [ ] **Step 7: Implement `anthropic.ts`**

`apps/judge/src/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { SYSTEM_PROMPT } from "./prompt";

export async function llmJudge(input: JudgeInput, apiKey: string): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey });
  const userPayload = JSON.stringify(input);

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPayload }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  // The model is instructed to output JSON only. Extract the first {...} block defensively.
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const blob = text.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(blob) as JudgeVerdict;
  if (parsed.tier !== "SAFE" && parsed.tier !== "CAUTION" && parsed.tier !== "DANGER") {
    throw new Error("invalid tier from LLM: " + parsed.tier);
  }
  return parsed;
}
```

- [ ] **Step 8: Wire LLM path into `judge.ts`**

Replace `apps/judge/src/judge.ts`:

```ts
import type { Hono } from "hono";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";
import { applySafetyFloor } from "./safetyFloor";
import { llmJudge } from "./anthropic";

export interface JudgeOptions {
  stubVerdict?: boolean;
  anthropicApiKey?: string;
  apiKey?: string;
  llmOverride?: (input: JudgeInput) => Promise<JudgeVerdict>; // for tests
}

export function mountJudge(app: Hono, opts: JudgeOptions) {
  app.post("/judge", async (c) => {
    const apiKey = opts.apiKey ?? "local-dev-key";
    if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);

    const input = (await c.req.json()) as JudgeInput;

    if (opts.stubVerdict) {
      const v: JudgeVerdict = { tier: "SAFE", headline: stubHeadline(input), reasons: [{ severity: "info", text: "Stubbed verdict." }], confidence: 0.5 };
      return c.json(applySafetyFloor(v, input.findings));
    }

    if (!opts.anthropicApiKey && !opts.llmOverride) return c.json({ error: "ANTHROPIC_API_KEY missing" }, 500);

    try {
      const llm = opts.llmOverride
        ? await opts.llmOverride(input)
        : await llmJudge(input, opts.anthropicApiKey!);
      return c.json(applySafetyFloor(llm, input.findings));
    } catch (e) {
      return c.json({ error: "llm_failed", message: String((e as Error).message ?? e) }, 502);
    }
  });
}

function stubHeadline(input: JudgeInput): string {
  if (input.decoded.kind === "swap") return `Looks fine — ${input.intent.summary}`;
  return `Verdict for ${input.decoded.kind}`;
}
```

- [ ] **Step 9: Add live-stub integration test**

`apps/judge/tests/judge.live-stub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict } from "@intent-check/types";

const baseInput: JudgeInput = {
  intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
  decoded: { kind: "swap", tokenIn: { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" }, tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" }, minAmountOut: "28000000000000000", recipient: "0x0", router: "0x6fF5693b99212Da76ad316178A184AB56D299b43", protocol: "Uniswap" },
  contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false },
  origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
  findings: [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "contract is not verified" }],
  request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x0" }] },
};

describe("/judge with llmOverride applies safety floor", () => {
  it("upgrades SAFE LLM verdict to CAUTION because of warn finding", async () => {
    const app = new Hono();
    mountJudge(app, {
      apiKey: "k",
      llmOverride: async (): Promise<JudgeVerdict> => ({ tier: "SAFE", headline: "fine", reasons: [], confidence: 0.9 }),
    });
    const res = await app.request("/judge", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "k" },
      body: JSON.stringify(baseInput),
    });
    const body = await res.json();
    expect(body.tier).toBe("CAUTION");
  });
});
```

- [ ] **Step 10: Run all judge tests**

Run: `pnpm --filter @intent-check/judge test`
Expected: 6 passed.

- [ ] **Step 11: Commit**

```bash
git add apps/judge pnpm-lock.yaml
git commit -m "feat(judge): Anthropic-backed verdict with safety-floor enforcement"
```

---

## Task 12: Extension — wire Sourcify, Tenderly, deterministic findings into background

**Files:**
- Modify: `apps/extension/src/background.ts`
- Modify: `apps/extension/package.json` (add the new client deps)
- Modify: `apps/extension/src/shared/config.ts`

- [ ] **Step 1: Add deps**

Edit `apps/extension/package.json`, add to dependencies:
```
"@intent-check/sourcify-client": "workspace:*",
"@intent-check/tenderly-client": "workspace:*",
```
Then `pnpm install`.

- [ ] **Step 2: Extend config with Tenderly settings**

Replace `apps/extension/src/shared/config.ts`:

```ts
export const JUDGE_URL = "http://127.0.0.1:8787/judge";
export const JUDGE_API_KEY = "local-dev-key";
export const SUPPORTED_CHAIN_IDS = [1, 8453];

// Tenderly is called from the background using a public, throwaway access key
// (free tier). For production we'd proxy through the judge backend.
export const TENDERLY_ACCESS_KEY = "";   // set per-developer in localStorage at runtime, see README
export const TENDERLY_ACCOUNT_SLUG = "";
export const TENDERLY_PROJECT_SLUG = "";

export const CHAIN_ID_TO_NETWORK_ID: Record<number, string> = {
  1: "1",
  8453: "8453",
};
```

Note: For the demo we'll move Tenderly to the backend in a later task to avoid embedding keys; the M2 acceptance is that the simulation flows end-to-end. We accept the embedded-key compromise for the milestone.

- [ ] **Step 3: Extend background to gather full JudgeInput**

Replace `apps/extension/src/background.ts`:

```ts
import { decode } from "@intent-check/decoder";
import { fetchVerifiedContract } from "@intent-check/sourcify-client";
import { simulate } from "@intent-check/tenderly-client";
import type { JudgeInput, JudgeVerdict, WalletRequest, ContractMeta, OriginSignals, UserIntent, Finding, SimResult } from "@intent-check/types";
import type { ContentToBackground, BackgroundToContent, PageSnapshot } from "./shared/messaging";
import {
  JUDGE_URL, JUDGE_API_KEY,
  TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT_SLUG, TENDERLY_PROJECT_SLUG,
  CHAIN_ID_TO_NETWORK_ID,
} from "./shared/config";

interface PendingItem {
  id: string;
  tabId: number;
  request: WalletRequest;
  origin: string;
  pageSnapshot: PageSnapshot;
  judgeInput: JudgeInput;
  verdict: JudgeVerdict;
}

async function setPending(item: PendingItem) {
  await chrome.storage.session.set({ [`pending:${item.id}`]: item, lastPendingId: item.id });
}
async function getPending(id: string): Promise<PendingItem | undefined> {
  const r = await chrome.storage.session.get([`pending:${id}`]);
  return r[`pending:${id}`];
}
async function clearPending(id: string) {
  await chrome.storage.session.remove([`pending:${id}`]);
}

function inferIntent(snapshot: PageSnapshot): UserIntent {
  const text = [snapshot.title, snapshot.ogTitle, snapshot.ogSiteName, snapshot.visibleButtonText].filter(Boolean).join(" | ").toLowerCase();
  if (/swap/.test(text))           return { kind: "swap",    summary: snapshot.title ?? "Swap on this dApp",    confidence: 0.6 };
  if (/approve/.test(text))        return { kind: "approve", summary: snapshot.title ?? "Approve token",        confidence: 0.5 };
  if (/mint/.test(text))           return { kind: "mint",    summary: snapshot.title ?? "Mint NFT",             confidence: 0.5 };
  if (/deposit|stake/.test(text))  return { kind: "deposit", summary: snapshot.title ?? "Deposit",              confidence: 0.5 };
  if (/bridge/.test(text))         return { kind: "bridge",  summary: snapshot.title ?? "Bridge",               confidence: 0.5 };
  return { kind: "other", summary: snapshot.title ?? "Unknown action", confidence: 0.2 };
}

function deterministicFindings(input: { decoded: JudgeInput["decoded"]; contract: ContractMeta; intent: UserIntent }): Finding[] {
  const out: Finding[] = [];
  if (input.decoded.kind === "approve" && input.decoded.isUnlimited) {
    out.push({ code: "UNLIMITED_APPROVAL", severity: "danger", text: `Unlimited approval to ${input.decoded.spender}` });
  }
  if (input.decoded.kind === "setApprovalForAll" && input.decoded.approved) {
    out.push({ code: "SET_APPROVAL_FOR_ALL", severity: "danger", text: `setApprovalForAll on ${input.decoded.collection}` });
  }
  if (!input.contract.verified) {
    out.push({ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "Target contract is not verified on Sourcify." });
  }
  if (input.intent.kind === "mint" && input.decoded.kind === "approve") {
    out.push({ code: "INTENT_MISMATCH_MINT_VS_APPROVE", severity: "danger", text: "Page looks like a mint but tx is an approval." });
  }
  return out;
}

async function loadTenderlySettings(): Promise<{ key: string; account: string; project: string } | null> {
  const r = await chrome.storage.local.get(["tenderly_key", "tenderly_account", "tenderly_project"]);
  const key = r.tenderly_key ?? TENDERLY_ACCESS_KEY;
  const account = r.tenderly_account ?? TENDERLY_ACCOUNT_SLUG;
  const project = r.tenderly_project ?? TENDERLY_PROJECT_SLUG;
  if (!key || !account || !project) return null;
  return { key, account, project };
}

async function maybeSimulate(chainId: number, tx: { from: string; to: string; value?: string; data?: string }): Promise<SimResult | undefined> {
  const t = await loadTenderlySettings();
  if (!t) return undefined;
  const network_id = CHAIN_ID_TO_NETWORK_ID[chainId];
  if (!network_id) return undefined;
  try {
    return await simulate({
      accessKey: t.key, accountSlug: t.account, projectSlug: t.project,
      network_id, from: tx.from, to: tx.to, input: tx.data ?? "0x", value: tx.value ?? "0x0",
    });
  } catch {
    return undefined;
  }
}

async function callJudge(input: JudgeInput): Promise<JudgeVerdict> {
  const res = await fetch(JUDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": JUDGE_API_KEY },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`judge ${res.status}`);
  return (await res.json()) as JudgeVerdict;
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender) => {
  if (msg.kind !== "judge_request") return;
  (async () => {
    const tabId = sender.tab?.id;
    try {
      if (tabId === undefined) throw new Error("no tab id");
      const { request, origin, pageSnapshot } = msg.payload;

      if (request.method !== "eth_sendTransaction") {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: "method not supported in M2" };
        chrome.tabs.sendMessage(tabId, reply);
        return;
      }
      const tx = request.params[0];
      const chainIdHex = tx.chainId ?? "0x2105";
      const chainId = parseInt(chainIdHex, 16);

      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });
      const verifiedContract = await fetchVerifiedContract({ chainId, address: tx.to });
      const sim = await maybeSimulate(chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data });

      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = {
        address: tx.to, chainId,
        verified: verifiedContract.verified,
        sourceProvider: verifiedContract.verified ? "sourcify" : undefined,
        contractName: verifiedContract.contractName,
        isProxy: false,
      };
      const originSig: OriginSignals = {
        url: pageSnapshot.url, origin,
        pageTitle: pageSnapshot.title, ogTitle: pageSnapshot.ogTitle, ogSiteName: pageSnapshot.ogSiteName,
        visibleButtonText: pageSnapshot.visibleButtonText,
      };
      const findings = deterministicFindings({ decoded, contract, intent });
      const judgeInput: JudgeInput = { intent, decoded, sim, contract, origin: originSig, findings, request };

      const verdict = await callJudge(judgeInput);
      await setPending({ id: msg.id, tabId, request, origin, pageSnapshot, judgeInput, verdict });
      await chrome.action.openPopup().catch(() => {});
    } catch (e) {
      if (tabId !== undefined) {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) };
        chrome.tabs.sendMessage(tabId, reply);
      }
    }
  })();
  return false;
});

chrome.runtime.onMessage.addListener((msg: { kind: "user_decision"; id: string; decision: "approve" | "reject" }) => {
  if (msg.kind !== "user_decision") return;
  (async () => {
    const item = await getPending(msg.id);
    if (!item) return;
    const reply: BackgroundToContent = { kind: "judge_result", id: msg.id, verdict: item.verdict, userDecision: msg.decision };
    chrome.tabs.sendMessage(item.tabId, reply);
    await clearPending(msg.id);
  })();
  return false;
});
```

- [ ] **Step 4: Build and load**

Run: `pnpm --filter @intent-check/extension build`
Expected: clean build.

- [ ] **Step 5: Smoke test**

Set `STUB_VERDICT = ""` in `wrangler.toml` (or remove the var) so the judge uses the LLM. Set `ANTHROPIC_API_KEY` in `apps/judge/.dev.vars`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Run judge: `pnpm --filter @intent-check/judge dev`. In Chrome DevTools console for any tab, set Tenderly creds for the extension:
```js
chrome.storage.local.set({ tenderly_key: "...", tenderly_account: "...", tenderly_project: "..." });
```
Reload extension; trigger a Uniswap swap on Base. Verify the popup now shows an LLM-generated headline.

- [ ] **Step 6: Commit**

```bash
git add apps/extension pnpm-lock.yaml
git commit -m "feat(extension): integrate Sourcify + Tenderly + deterministic findings into JudgeInput"
```

---

## Task 13: Extension — intent confirmation step before judging

**Files:**
- Create: `apps/extension/src/popup/components/IntentConfirm.tsx`
- Modify: `apps/extension/src/popup/App.tsx`
- Modify: `apps/extension/src/background.ts` (split flow into two phases)
- Modify: `apps/extension/src/shared/messaging.ts` (add user-edit message)

**Why a phased flow.** M2 spec says: auto-infer intent, ask user to confirm, then judge. We split background flow into two phases:
1. Decode + infer intent → store as "awaiting confirmation" → open popup.
2. User confirms (or edits) the intent → background gathers Sourcify+Tenderly+findings → calls `/judge` → updates pending with verdict → popup re-renders.

- [ ] **Step 1: Extend messaging types**

Modify `apps/extension/src/shared/messaging.ts` — add to the union types:

```ts
// Append to ContentToBackground union (already present types unchanged):
//   | { kind: "user_intent_confirmed"; id: string; intent: UserIntent }
```

Concretely, replace the `ContentToBackground` union with:

```ts
import type { UserIntent } from "@intent-check/types";

export type ContentToBackground =
  | { kind: "judge_request"; id: string; tabId?: number; payload: { request: WalletRequest; origin: string; pageSnapshot: PageSnapshot } }
  | { kind: "user_intent_confirmed"; id: string; intent: UserIntent }
  | { kind: "user_decision"; id: string; decision: "approve" | "reject" };
```

(Move `user_decision` into this union so the contract is one type.)

- [ ] **Step 2: Refactor background into two phases**

Replace the message-handling section of `apps/extension/src/background.ts` (the two `chrome.runtime.onMessage.addListener` blocks) with a single dispatcher and a phased pipeline. Add at the bottom of the file (replace the previous listeners):

```ts
type PhaseState =
  | { phase: "awaiting_confirm"; baseDraft: { request: WalletRequest; origin: string; pageSnapshot: PageSnapshot; chainId: number; decoded: JudgeInput["decoded"]; contract: ContractMeta; intent: UserIntent }; tabId: number }
  | { phase: "verdict_ready"; tabId: number; request: WalletRequest; origin: string; pageSnapshot: PageSnapshot; judgeInput: JudgeInput; verdict: JudgeVerdict };

async function setState(id: string, s: PhaseState) {
  await chrome.storage.session.set({ [`pending:${id}`]: s, lastPendingId: id });
}
async function getState(id: string): Promise<PhaseState | undefined> {
  const r = await chrome.storage.session.get([`pending:${id}`]);
  return r[`pending:${id}`];
}
async function clearState(id: string) {
  await chrome.storage.session.remove([`pending:${id}`]);
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender) => {
  (async () => {
    if (msg.kind === "judge_request") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const { request, origin, pageSnapshot } = msg.payload;

      if (request.method !== "eth_sendTransaction") {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: "method not supported in M2" } as BackgroundToContent);
        return;
      }
      const tx = request.params[0];
      const chainId = parseInt(tx.chainId ?? "0x2105", 16);
      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });
      const v = await fetchVerifiedContract({ chainId, address: tx.to });
      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = { address: tx.to, chainId, verified: v.verified, sourceProvider: v.verified ? "sourcify" : undefined, contractName: v.contractName, isProxy: false };

      await setState(msg.id, { phase: "awaiting_confirm", tabId, baseDraft: { request, origin, pageSnapshot, chainId, decoded, contract, intent } });
      await chrome.action.openPopup().catch(() => {});
      return;
    }

    if (msg.kind === "user_intent_confirmed") {
      const s = await getState(msg.id);
      if (!s || s.phase !== "awaiting_confirm") return;
      const { baseDraft, tabId } = s;
      const tx = baseDraft.request.method === "eth_sendTransaction" ? baseDraft.request.params[0] : null;
      if (!tx) return;

      const sim = await maybeSimulate(baseDraft.chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data });
      const findings = deterministicFindings({ decoded: baseDraft.decoded, contract: baseDraft.contract, intent: msg.intent });
      const originSig: OriginSignals = {
        url: baseDraft.pageSnapshot.url, origin: baseDraft.origin,
        pageTitle: baseDraft.pageSnapshot.title, ogTitle: baseDraft.pageSnapshot.ogTitle, ogSiteName: baseDraft.pageSnapshot.ogSiteName,
        visibleButtonText: baseDraft.pageSnapshot.visibleButtonText,
      };
      const judgeInput: JudgeInput = { intent: msg.intent, decoded: baseDraft.decoded, sim, contract: baseDraft.contract, origin: originSig, findings, request: baseDraft.request };
      try {
        const verdict = await callJudge(judgeInput);
        await setState(msg.id, { phase: "verdict_ready", tabId, request: baseDraft.request, origin: baseDraft.origin, pageSnapshot: baseDraft.pageSnapshot, judgeInput, verdict });
      } catch (e) {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) } as BackgroundToContent);
        await clearState(msg.id);
      }
      return;
    }

    if (msg.kind === "user_decision") {
      const s = await getState(msg.id);
      if (!s || s.phase !== "verdict_ready") return;
      chrome.tabs.sendMessage(s.tabId, { kind: "judge_result", id: msg.id, verdict: s.verdict, userDecision: msg.decision } as BackgroundToContent);
      await clearState(msg.id);
      return;
    }
  })();
  return false;
});
```

Remove the previous two listeners and the previous `PendingItem` shape; the `PhaseState` above replaces them. Keep the imports and helpers (`decode`, `fetchVerifiedContract`, `maybeSimulate`, `inferIntent`, `deterministicFindings`, `callJudge`) from the prior task.

- [ ] **Step 3: Add the IntentConfirm component**

`apps/extension/src/popup/components/IntentConfirm.tsx`:

```tsx
import { useState } from "react";
import type { UserIntent } from "@intent-check/types";

const KINDS: UserIntent["kind"][] = ["swap", "approve", "deposit", "mint", "bridge", "transfer", "sign", "other"];

export function IntentConfirm({ initial, onConfirm }: { initial: UserIntent; onConfirm: (i: UserIntent) => void }) {
  const [kind, setKind] = useState(initial.kind);
  const [summary, setSummary] = useState(initial.summary);
  return (
    <div>
      <h4 style={{ margin: "8px 0" }}>Looks like you're trying to:</h4>
      <select value={kind} onChange={(e) => setKind(e.target.value as UserIntent["kind"])}>
        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input style={{ width: "100%", marginTop: 8 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <button style={{ marginTop: 8, width: "100%" }} onClick={() => onConfirm({ ...initial, kind, summary, confidence: 1 })}>
        That's right — check it
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update the popup to handle both phases**

Replace `apps/extension/src/popup/App.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import { VerdictChip } from "./components/VerdictChip";
import { IntentConfirm } from "./components/IntentConfirm";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput } from "@intent-check/types";

interface AwaitingConfirm { phase: "awaiting_confirm"; baseDraft: { decoded: DecodedAction; intent: UserIntent; pageSnapshot: { title?: string }; origin: string }; }
interface VerdictReady   { phase: "verdict_ready"; verdict: JudgeVerdict; judgeInput: JudgeInput; origin: string; pageSnapshot: { title?: string }; }
type State = AwaitingConfirm | VerdictReady;

export function App() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);

  const refresh = useCallback(async () => {
    const r = await chrome.storage.session.get(["lastPendingId"]);
    const newId = r.lastPendingId as string | undefined;
    if (!newId) return;
    setId(newId);
    const r2 = await chrome.storage.session.get([`pending:${newId}`]);
    setState(r2[`pending:${newId}`] ?? null);
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 500); return () => clearInterval(i); }, [refresh]);

  if (!state || !id) return <div style={{ width: 320, padding: 12, fontFamily: "system-ui" }}><h3>Intent Check</h3><p>No active request.</p></div>;

  if (state.phase === "awaiting_confirm") {
    return (
      <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <p style={{ fontSize: 12, color: "#555" }}>{state.baseDraft.origin}</p>
        <IntentConfirm
          initial={state.baseDraft.intent}
          onConfirm={(intent) => chrome.runtime.sendMessage({ kind: "user_intent_confirmed", id, intent })}
        />
      </div>
    );
  }

  return (
    <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <VerdictChip tier={state.verdict.tier} />
      </div>
      <p style={{ marginTop: 8 }}>{state.verdict.headline}</p>
      <ul style={{ paddingLeft: 18, fontSize: 12 }}>
        {state.verdict.reasons.map((r, i) => <li key={i} style={{ color: r.severity === "danger" ? "#cf222e" : r.severity === "warn" ? "#9a6700" : "#444" }}>{r.text}</li>)}
      </ul>
      <details>
        <summary>Details</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(state.judgeInput.decoded, null, 2)}</pre>
        {state.judgeInput.sim && <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(state.judgeInput.sim.assetChanges, null, 2)}</pre>}
        <p style={{ fontSize: 11, color: "#555" }}>Origin: {state.origin}</p>
      </details>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => chrome.runtime.sendMessage({ kind: "user_decision", id, decision: "reject" })} style={{ flex: 1 }}>Reject</button>
        <button onClick={() => chrome.runtime.sendMessage({ kind: "user_decision", id, decision: "approve" })} style={{ flex: 1, background: "#1a7f37", color: "white" }} disabled={state.verdict.tier === "DANGER"}>
          {state.verdict.tier === "DANGER" ? "Blocked" : "Sign"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build & smoke test**

Run: `pnpm --filter @intent-check/extension build`
Reload extension, trigger a Uniswap swap on Base. Expect the popup to show:
1. Inferred intent ("swap …") with a confirm button.
2. After clicking confirm, the popup briefly shows "No active request" and then the verdict (because the popup polls storage every 500ms).
3. Verdict has a colored chip, headline, reasons list, and a Sign/Reject pair.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src
git commit -m "feat(extension): two-phase flow — confirm intent, then judge"
```

---

## Task 14: M2 acceptance — golden-path integration test + README run-instructions

**Files:**
- Create: `apps/judge/tests/judge.golden.test.ts`
- Create: `README.md`

- [ ] **Step 1: Write a golden-path integration test for `/judge` with `llmOverride`**

`apps/judge/tests/judge.golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mountJudge } from "../src/judge";
import type { JudgeInput, JudgeVerdict, Finding } from "@intent-check/types";

function makeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  const base: JudgeInput = {
    intent: { kind: "swap", summary: "swap 100 USDC for ETH on Uniswap", confidence: 0.9 },
    decoded: { kind: "swap", tokenIn: { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000000" }, tokenOut: { chainId: 8453, address: "0x4200000000000000000000000000000000000006", amount: "0" }, minAmountOut: "28000000000000000", recipient: "0x0", router: "0x6fF5693b99212Da76ad316178A184AB56D299b43", protocol: "Uniswap" },
    contract: { address: "0x6fF5693b99212Da76ad316178A184AB56D299b43", chainId: 8453, verified: true, isProxy: false, contractName: "UniversalRouter" },
    origin: { url: "https://app.uniswap.org/", origin: "https://app.uniswap.org" },
    findings: [],
    request: { method: "eth_sendTransaction", params: [{ from: "0x0", to: "0x6fF5693b99212Da76ad316178A184AB56D299b43" }] },
  };
  return { ...base, ...overrides } as JudgeInput;
}

describe("/judge golden scenarios", () => {
  function app(stub: JudgeVerdict) {
    const a = new Hono();
    mountJudge(a, { apiKey: "k", llmOverride: async () => stub });
    return a;
  }
  async function call(a: Hono, input: JudgeInput) {
    return a.request("/judge", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "k" }, body: JSON.stringify(input) });
  }

  it("matched-swap stays SAFE", async () => {
    const a = app({ tier: "SAFE", headline: "Looks safe — swap matches.", reasons: [], confidence: 0.9 });
    const r = await call(a, makeInput());
    expect((await r.json()).tier).toBe("SAFE");
  });

  it("unverified contract upgrades to CAUTION via floor", async () => {
    const a = app({ tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 });
    const findings: Finding[] = [{ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "not verified" }];
    const r = await call(a, makeInput({ findings }));
    expect((await r.json()).tier).toBe("CAUTION");
  });

  it("unlimited approval gets DANGER even if LLM says SAFE", async () => {
    const a = app({ tier: "SAFE", headline: "ok", reasons: [], confidence: 0.9 });
    const findings: Finding[] = [{ code: "UNLIMITED_APPROVAL", severity: "danger", text: "unlimited approval to 0xabc" }];
    const r = await call(a, makeInput({ findings }));
    const body = await r.json();
    expect(body.tier).toBe("DANGER");
    expect(body.headline.toLowerCase()).toContain("stop");
  });
});
```

- [ ] **Step 2: Run, see pass**

Run: `pnpm --filter @intent-check/judge test`
Expected: 9 passed.

- [ ] **Step 3: Write `README.md`**

`README.md`:

````markdown
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
````

- [ ] **Step 4: Commit**

```bash
git add apps/judge/tests/judge.golden.test.ts README.md
git commit -m "test(judge): golden-path scenarios + README run instructions"
```

---

## M2 acceptance criteria

- `pnpm test` passes across all packages (decoder, sourcify-client, tenderly-client, judge).
- Loading the unpacked extension and triggering a swap on `app.uniswap.org` (Base) shows: inferred intent → user confirms → popup with `SAFE` chip and an LLM-generated headline.
- Forcing an unlimited-approval call (e.g., calling `USDC.approve(0xdEaD…, MAX_UINT)` from a test page) shows a `DANGER` verdict with a `Stop —` headline, regardless of what the LLM returned.
- Rejecting in the popup throws `4001` to the dApp; signing forwards to MetaMask.

---

## Out of scope for this plan (deferred to M3+)

- EIP-712 typed-data decoding (`eth_signTypedData_v4`, `personal_sign`).
- Permit, Permit2, Seaport recognizers.
- Aave v3 supply/borrow recognizer.
- Contract age / proxy detection.
- Origin lookalike check (punycode + Levenshtein vs known-dApp list).
- Demo fixture mode (`VITE_DEMO=1`).
- Tenderly proxied through the judge backend (key currently lives in `chrome.storage.local`).

These are listed in the spec under "Out of scope (v2+)" / M3 / M4 and will be planned next.
