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
export { decodeTypedData, parseTypedData, classifyVerifyingContract, isUnlimitedAmount } from "./eip712";
export { tryDecodeWithAbi, type GenericAbiContext } from "./recognizers/genericAbi";
