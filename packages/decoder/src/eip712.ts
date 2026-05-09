/**
 * EIP-712 typed-data decoder. Distinct from calldata recognizers because
 * eth_signTypedData_v4 carries a JSON payload (typed-data envelope) instead
 * of bytes — the user is signing a message that confers off-chain
 * authorization (Permit2 transfer, Seaport order, ERC-2612 permit).
 *
 * Coverage in this MVP:
 *  - ERC-2612 Permit (token allowance via signature)
 *  - Permit2 PermitTransferFrom + PermitBatchTransferFrom (Uniswap drainer surface)
 *  - Permit2 PermitSingle / PermitBatch (subscription-style allowance)
 *  - Seaport OrderComponents (NFT marketplace listings/offers)
 *
 * Anything else returns kind: "unknown" so the LLM can still summarize from
 * the raw envelope but no deterministic findings fire.
 */

import { getAddress } from "viem";
import { lookupProtocol } from "@intent-check/protocol-registry";
import type { DecodedAction, TokenAmount } from "@intent-check/types";

interface TypedDataEnvelope {
  domain?: {
    name?: string;
    version?: string;
    chainId?: number | string;
    verifyingContract?: string;
    salt?: string;
  };
  primaryType?: string;
  types?: Record<string, { name: string; type: string }[]>;
  message?: Record<string, unknown>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asAddr(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  try { return getAddress(s); } catch { return undefined; }
}

function asAmount(v: unknown): string | undefined {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  return undefined;
}

function asChainId(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Parse the JSON envelope produced by eth_signTypedData_v4. Wallets pass it
 * as a JSON string in params[1]; some pass it as a parsed object. We accept both.
 */
export function parseTypedData(raw: unknown): TypedDataEnvelope | null {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as TypedDataEnvelope; } catch { return null; }
  }
  if (raw && typeof raw === "object") return raw as TypedDataEnvelope;
  return null;
}

const MAX_UINT_FROM_HEX = (1n << 256n) - 1n;
function isUnlimitedAmount(amt: string): boolean {
  try {
    const n = BigInt(amt);
    return n >= (1n << 255n) || n === MAX_UINT_FROM_HEX;
  } catch {
    return false;
  }
}

/**
 * Top-level recognizer. Returns a DecodedAction (permit / permit2Transfer /
 * seaportOrder) or null if the envelope shape isn't one we handle.
 */
export function decodeTypedData(raw: unknown): DecodedAction | null {
  const env = parseTypedData(raw);
  if (!env || !env.primaryType || !env.message) return null;

  const chainId = asChainId(env.domain?.chainId) ?? 1;

  switch (env.primaryType) {
    case "Permit":
      return decodePermit(env, chainId);
    case "PermitTransferFrom":
      return decodePermit2TransferFrom(env, chainId);
    case "PermitBatchTransferFrom":
      return decodePermit2BatchTransferFrom(env, chainId);
    case "PermitSingle":
      return decodePermit2Single(env, chainId);
    case "PermitBatch":
      return decodePermit2Batch(env, chainId);
    case "OrderComponents":
      return decodeSeaportOrder(env, chainId);
    default:
      return null;
  }
}

// --- ERC-2612 Permit ---
// domain.verifyingContract is the token; message has owner, spender, value, deadline.
function decodePermit(env: TypedDataEnvelope, _chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const token = asAddr(env.domain?.verifyingContract);
  const owner = asAddr(m.owner);
  const spender = asAddr(m.spender);
  const amount = asAmount(m.value);
  const deadline = asAmount(m.deadline);
  if (!token || !owner || !spender || !amount || !deadline) return null;
  return { kind: "permit", token, owner, spender, amount, deadline };
}

// --- Permit2 PermitTransferFrom ---
// domain.verifyingContract = Permit2; message has permitted{token,amount}, spender, nonce, deadline.
function decodePermit2TransferFrom(env: TypedDataEnvelope, chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const permitted = m.permitted as { token?: unknown; amount?: unknown } | undefined;
  const token = asAddr(permitted?.token);
  const amount = asAmount(permitted?.amount);
  const spender = asAddr(m.spender);
  const deadline = asAmount(m.deadline);
  if (!token || !amount || !spender || !deadline) return null;
  return {
    kind: "permit2Transfer",
    permitted: [{ chainId, address: token, amount }],
    spender,
    deadline,
  };
}

// --- Permit2 PermitBatchTransferFrom ---
// message.permitted is an array of {token,amount}; same spender + deadline.
function decodePermit2BatchTransferFrom(env: TypedDataEnvelope, chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const list = Array.isArray(m.permitted) ? m.permitted : null;
  if (!list || list.length === 0) return null;
  const permitted: TokenAmount[] = [];
  for (const item of list) {
    const i = item as { token?: unknown; amount?: unknown };
    const token = asAddr(i.token);
    const amount = asAmount(i.amount);
    if (!token || !amount) return null;
    permitted.push({ chainId, address: token, amount });
  }
  const spender = asAddr(m.spender);
  const deadline = asAmount(m.deadline);
  if (!spender || !deadline) return null;
  return { kind: "permit2Transfer", permitted, spender, deadline };
}

// --- Permit2 PermitSingle ---
// Allowance-style: details{token,amount,expiration,nonce}, spender, sigDeadline.
function decodePermit2Single(env: TypedDataEnvelope, chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const details = m.details as { token?: unknown; amount?: unknown; expiration?: unknown } | undefined;
  const token = asAddr(details?.token);
  const amount = asAmount(details?.amount);
  const spender = asAddr(m.spender);
  const deadline = asAmount(m.sigDeadline);
  if (!token || !amount || !spender || !deadline) return null;
  return {
    kind: "permit2Transfer",
    permitted: [{ chainId, address: token, amount }],
    spender,
    deadline,
  };
}

// --- Permit2 PermitBatch ---
function decodePermit2Batch(env: TypedDataEnvelope, chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const list = Array.isArray(m.details) ? m.details : null;
  if (!list || list.length === 0) return null;
  const permitted: TokenAmount[] = [];
  for (const item of list) {
    const i = item as { token?: unknown; amount?: unknown };
    const token = asAddr(i.token);
    const amount = asAmount(i.amount);
    if (!token || !amount) return null;
    permitted.push({ chainId, address: token, amount });
  }
  const spender = asAddr(m.spender);
  const deadline = asAmount(m.sigDeadline);
  if (!spender || !deadline) return null;
  return { kind: "permit2Transfer", permitted, spender, deadline };
}

// --- Seaport OrderComponents ---
// Marketplace order. We extract offer + consideration as TokenAmount arrays;
// item types beyond ERC20/ERC721/ERC1155 collapse to address-only.
function decodeSeaportOrder(env: TypedDataEnvelope, chainId: number): DecodedAction | null {
  const m = env.message ?? {};
  const offerer = asAddr(m.offerer);
  const offerArr = Array.isArray(m.offer) ? m.offer : [];
  const considerationArr = Array.isArray(m.consideration) ? m.consideration : [];
  if (!offerer) return null;

  const toToken = (it: unknown): TokenAmount | null => {
    const i = it as { token?: unknown; startAmount?: unknown; identifierOrCriteria?: unknown };
    const token = asAddr(i.token);
    const amount = asAmount(i.startAmount) ?? "0";
    if (!token) return null;
    return { chainId, address: token, amount };
  };

  const offer = offerArr.map(toToken).filter((x): x is TokenAmount => x !== null);
  const consideration = considerationArr.map(toToken).filter((x): x is TokenAmount => x !== null);
  if (offer.length === 0 && consideration.length === 0) return null;

  return { kind: "seaportOrder", offerer, offer, consideration };
}

/**
 * Convenience: decode + immediately classify the verifying contract via the
 * registry. Useful for the background to pass `knownProtocol` info into the
 * judge alongside the decoded action.
 */
export function classifyVerifyingContract(env: TypedDataEnvelope): { protocol: string; name: string; kind: string } | null {
  const chainId = asChainId(env.domain?.chainId);
  const addr = asAddr(env.domain?.verifyingContract);
  if (!chainId || !addr) return null;
  const info = lookupProtocol(chainId, addr);
  if (!info) return null;
  return { protocol: info.protocol, name: info.name, kind: info.kind };
}

export { isUnlimitedAmount };
