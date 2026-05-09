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
  | { kind: "swap"; tokenIn: TokenAmount; tokenOut: TokenAmount; minAmountOut: string; recipient: string; recipientKind?: "wallet" | "router_self" | "third_party"; router: string; protocol: string; trusted?: boolean; commands?: string[] }
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
  matchType?: "perfect" | "partial";
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
  // Net token deltas for the user's wallet, derived from sim.assetChanges.
  // Positive amounts = received; negative = sent. Empty when sim is absent.
  netEffect?: { wallet: string; deltas: NetDelta[] };
}

export interface NetDelta {
  chainId: number;
  token: string;     // 0x... address; "ETH" sentinel if native
  symbol?: string;
  decimals?: number;
  amount: string;    // signed integer string (raw)
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
