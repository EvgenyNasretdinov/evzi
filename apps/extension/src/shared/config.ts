export const JUDGE_BASE_URL = "http://127.0.0.1:8787";
export const JUDGE_URL = `${JUDGE_BASE_URL}/judge`;
export const JUDGE_INFO_URL = `${JUDGE_BASE_URL}/judge/info`;
export const INFER_INTENT_URL = `${JUDGE_BASE_URL}/infer-intent`;
export const CHAT_URL = `${JUDGE_BASE_URL}/chat`;
export const JUDGE_API_KEY = "local-dev-key";
export const SUPPORTED_CHAIN_IDS = [1, 8453, 10, 42161];

// Tenderly is called from the background. Two ways to configure:
//   1. At build time: set TENDERLY_* in the workspace root .env, then pnpm build.
//      Vite (vite.config.ts) injects them as VITE_TENDERLY_* via `define`.
//   2. At runtime: chrome.storage.local.set({ tenderly_key, tenderly_account, tenderly_project })
//      — overrides the build-time values.
// Embedding the key is OK for local dev; for production we'd proxy through the judge backend.
export const TENDERLY_ACCESS_KEY = import.meta.env.VITE_TENDERLY_ACCESS_KEY ?? "";
export const TENDERLY_ACCOUNT_SLUG = import.meta.env.VITE_TENDERLY_ACCOUNT_SLUG ?? "";
export const TENDERLY_PROJECT_SLUG = import.meta.env.VITE_TENDERLY_PROJECT_SLUG ?? "";

export const CHAIN_ID_TO_NETWORK_ID: Record<number, string> = {
  1: "1",
  10: "10",        // Optimism
  8453: "8453",    // Base
  42161: "42161",  // Arbitrum
};
