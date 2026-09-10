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
  | { kind: "lendingAction"; protocol: string; verb: "supply" | "withdraw" | "borrow" | "repay"; asset: string; amount: string; onBehalfOf?: string; pool: string; trusted?: boolean }
  | {
      kind: "generic";
      /** Function name as it appears in the ABI, e.g. "swapExactTokensForTokens". */
      functionName: string;
      /** Canonical signature, e.g. "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)".
       * Used to look up userdoc.methods[<signature>].notice. */
      signature: string;
      /** Contract address being called. */
      target: string;
      /** Stringified arguments in declaration order. BigInts → string, addresses lowercased,
       * arrays → bracketed comma-separated, structs → JSON. */
      args: string[];
      /** Parameter names from the ABI, declaration order. May contain "" if a name was missing. */
      argNames?: string[];
      /** Protocol from the registry, when target hits the registry. */
      protocol?: string;
      /** True iff target is in the protocol-registry — same semantic as the swap/lendingAction trusted flags. */
      trusted: boolean;
    }
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

// Set when (chainId, address) hits the bundled protocol registry. This is a
// deterministic trust signal that's independent of whether Sourcify has the
// contract verified or whether the calldata decoded as a recognized shape.
// Defined here (rather than imported from @intent-check/protocol-registry) so
// the types package stays dependency-free.
export interface ProtocolInfo {
  protocol: string;
  name: string;
  kind: string;
}

// Contract trust signals.
export interface ContractMeta {
  address: string;
  chainId: number;
  verified: boolean;
  isProxy: boolean;
  matchType?: "exact_match" | "match" | "perfect" | "partial";
  contractName?: string;
  knownProtocol?: ProtocolInfo;

  // M4 additions
  proxyType?: string;
  /** Populated when isProxy && Sourcify resolved the implementation. */
  implementation?: ContractMeta;
  deployment?: {
    blockNumber?: number;
    deployer?: string;
    transactionHash?: string;
    /** Populated by background using a head-block lookup — added in T5. T3 leaves this undefined. */
    ageDays?: number;
  };
  /** NatSpec userdoc — populated in T6, leave undefined here. */
  authorIntent?: {
    contract?: string;
    method?: string;
  };
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
  /** The frozen human authorization an agent is acting under, when there is one. */
  authorization?: AuthorizedIntent;
  /** Live on-chain behavioural context, when available. */
  onchain?: OnchainContext;
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
  /** Present when an AuthorizedIntent was supplied. Binding in agent mode,
   *  advisory in the human flow. Derived deterministically — never by the LLM. */
  policy?: AgentPolicy;
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

// Sourcify v2 emits "exact_match" / "match"; v1 emitted "perfect" / "partial".
// Accept both so callers don't have to care which client populated ContractMeta.
export function isExactMatch(m: ContractMeta["matchType"]): boolean {
  return m === "exact_match" || m === "perfect";
}

export function isPartialMatch(m: ContractMeta["matchType"]): boolean {
  return m === "match" || m === "partial";
}

// ---------------------------------------------------------------------------
// Agent intent firewall (ETHOnline 2026).
//
// These describe an AI agent acting on a human's behalf: the human authorizes
// a goal once, the agent proposes transactions, and every proposal is checked
// back against that frozen authorization.
// ---------------------------------------------------------------------------

/** Machine-readable limits the human agreed to, parsed from their own words. */
export interface IntentConstraints {
  chainIds: number[];
  /** Per-token spend caps. Raw integer strings, same convention as TokenAmount. */
  maxSpend: { chainId: number; token: string; amount: string }[];
  /** Empty means: the user's own wallet is the only acceptable recipient. */
  allowedRecipients: string[];
  allowUnlimitedApproval: boolean;
  maxSlippageBps?: number;
  allowedProtocols?: string[];
  expiresAt?: number;
}

/**
 * A human authorization, frozen at confirmation time. `hash` covers every
 * other field via canonical JSON, so any later mutation is detectable.
 */
export interface AuthorizedIntent {
  id: string;
  /** The user's exact words. Kept verbatim so the verdict can quote them. */
  raw: string;
  goal: UserIntent;
  constraints: IntentConstraints;
  createdAt: number;
  hash: string;
}

/**
 * Live behavioural data from The Graph. Contract verification tells us about
 * code; this tells us about behaviour, which is the only way to say anything
 * about an EOA. Every field is optional: the upstream may be unavailable.
 */
export interface OnchainContext {
  spender?: {
    address: string;
    firstSeenDaysAgo?: number;
    distinctInboundSenders48h: number;
    /** 0..1 — share of outflow going to a single address. */
    outboundConcentration: number;
  };
  token?: {
    address: string;
    symbol?: string;
    holders?: number;
    marketCapUsd?: number;
    /** True when the protocol registry vouches for this exact address. */
    canonical: boolean;
  };
  wallet?: {
    address: string;
    totalUsd?: number;
    balances: { token: string; symbol?: string; amount: string; usd?: number }[];
  };
  /** True when any upstream call failed or timed out. */
  degraded: boolean;
}

/** What an agent is permitted to do with a proposal. */
export type AgentPolicy = "ALLOW" | "REQUIRE_APPROVAL" | "REJECT";
