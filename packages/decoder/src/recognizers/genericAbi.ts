import { decodeFunctionData, type Abi, type AbiFunction } from "viem";
import type { DecodedAction } from "@intent-check/types";

export interface GenericAbiContext {
  /** Calldata bytes, 0x-prefixed. */
  calldata: string;
  /** Contract address being called. */
  to: string;
}

function stringifyArg(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return `[${v.map(stringifyArg).join(", ")}]`;
  if (typeof v === "object" && v !== null) {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  }
  if (typeof v === "string") return v;
  return String(v);
}

/** Build the canonical "name(type1,type2,...)" signature for the matched ABI fn. */
function canonicalSignature(fn: AbiFunction): string {
  const types = (fn.inputs ?? []).map((i) => i.type).join(",");
  return `${fn.name}(${types})`;
}

/**
 * Generic ABI fallback decoder. Used by the background after the regular
 * recognizer pipeline returns `{ kind: "unknown" }` and we have a Sourcify-
 * provided ABI for the target. This unlocks human-readable rendering for
 * verified contracts at zero per-protocol cost (no recognizer to write).
 *
 * Returns null when:
 *   - the ABI is empty,
 *   - the calldata is too short to contain a 4-byte selector,
 *   - viem can't match the calldata against any function in the ABI,
 *   - the matched function isn't actually present in the ABI array (defensive).
 */
export function tryDecodeWithAbi(ctx: GenericAbiContext, abi: Abi): DecodedAction | null {
  if (!abi || abi.length === 0) return null;
  if (!ctx.calldata || ctx.calldata.length < 10) return null;
  try {
    const decoded = decodeFunctionData({ abi, data: ctx.calldata as `0x${string}` });
    const fn = (abi as readonly any[]).find(
      (item): item is AbiFunction =>
        item.type === "function" && item.name === decoded.functionName
    );
    if (!fn) return null;
    const argNames = fn.inputs?.map((i) => i.name ?? "") ?? [];
    const args = (decoded.args ?? []).map(stringifyArg);
    return {
      kind: "generic",
      functionName: decoded.functionName,
      signature: canonicalSignature(fn),
      target: ctx.to.toLowerCase(),
      args,
      argNames,
      trusted: false, // background flips to true when registry hits
    };
  } catch {
    return null;
  }
}
