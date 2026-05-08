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
