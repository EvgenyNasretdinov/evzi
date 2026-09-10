// Manual live check — not part of the test suite (tests never touch the network).
// Run: pnpm exec tsx packages/onchain-context/tests/live/check.ts
import { fetchOnchainContext } from "../../src/context";
import { graphFindings } from "../../src/findings";

const graphApiKey = process.env.GRAPH_API_KEY ?? "";
const tokenApiJwt = process.env.GRAPH_TOKEN_API_JWT ?? "";
const VITALIK = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

const cases: [string, number, string, string][] = [
  ["real USDC (mainnet)", 1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC"],
  ["real USDC (Base)", 8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC"],
  ["counterfeit 'USDC'", 1, "0x000000000000000000000000000000000000dead", "USDC"],
];

for (const [label, chainId, token, claimedSymbol] of cases) {
  const ctx = await fetchOnchainContext({ chainId, token, graphApiKey, tokenApiJwt });
  const fs = graphFindings(ctx, { claimedSymbol });
  console.log(
    label.padEnd(22),
    `canonical=${String(ctx.token?.canonical).padEnd(5)}`,
    `holders=${String(ctx.token?.holders ?? "-").padEnd(9)}`,
    `liquidityUsd=${ctx.token?.marketCapUsd ? Math.round(ctx.token.marketCapUsd).toLocaleString("en-US") : "-"}`,
    `degraded=${ctx.degraded}`,
  );
  for (const f of fs) console.log("   ->", f.severity.toUpperCase(), f.code, "|", f.text);
}

const w = await fetchOnchainContext({ chainId: 1, wallet: VITALIK, tokenApiJwt });
console.log("\nwallet balances:", w.wallet?.balances.length ?? 0, "rows, degraded =", w.degraded);
console.log(
  "top row:",
  w.wallet?.balances[0]?.symbol,
  w.wallet?.balances[0]?.quantity,
);

// Warm the slow Token API path, then re-read to show enrichment landing.
const { drainInflight } = await import("../../src/cache");
await drainInflight();
const warm = await fetchOnchainContext({
  chainId: 1,
  token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  graphApiKey,
  tokenApiJwt,
});
console.log("after warm-up:", `holders=${warm.token?.holders}`, `degraded=${warm.degraded}`);
