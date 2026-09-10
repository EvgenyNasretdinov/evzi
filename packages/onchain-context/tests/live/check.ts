// Manual live check — not part of the test suite (no network calls in tests).
// Run: GRAPH_API_KEY=... pnpm --filter @intent-check/onchain-context exec vitest run tests/live/check.ts
import { fetchTokenReputation } from "../../src/subgraph";

const K = process.env.GRAPH_API_KEY ?? "";
const cases: [number, string, string][] = [
  [1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "real USDC (mainnet)"],
  [8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "real USDC (Base)"],
  [1, "0x000000000000000000000000000000000000dead", "counterfeit (mainnet)"],
  [8453, "0x000000000000000000000000000000000000dead", "counterfeit (Base)"],
];

for (const [chainId, token, label] of cases) {
  const r = await fetchTokenReputation({ chainId, token, apiKey: K });
  console.log(
    label.padEnd(26),
    r === undefined
      ? "LOOKUP FAILED"
      : `canonical=${String(r.canonical).padEnd(5)} symbol=${r.symbol ?? "-"} usd=${
          r.marketCapUsd ? Math.round(r.marketCapUsd).toLocaleString("en-US") : "-"
        }`,
  );
}
