import type { DecodedAction } from "@intent-check/types";

export interface AmountRow {
  amount: string;
  symbol: string;
}

const EMPTY: AmountRow = { amount: "—", symbol: "—" };

/** Best-effort human-readable amounts for the confirm UI; falls back to placeholders. */
export function amountsFromDecoded(decoded: DecodedAction | undefined): { from: AmountRow; to: AmountRow } {
  if (!decoded) return { from: EMPTY, to: EMPTY };

  switch (decoded.kind) {
    case "swap":
      return {
        from: {
          amount: decoded.tokenIn.amount,
          symbol: decoded.tokenIn.symbol ?? "TOKEN",
        },
        to: {
          amount: decoded.tokenOut.amount,
          symbol: decoded.tokenOut.symbol ?? "TOKEN",
        },
      };
    case "approve":
      return {
        from: { amount: decoded.amount, symbol: "allowance" },
        to: { amount: decoded.spender.slice(0, 8) + "…", symbol: "spender" },
      };
    case "transfer":
      return {
        from: { amount: decoded.amount, symbol: decoded.token.slice(0, 8) + "…" },
        to: { amount: decoded.to.slice(0, 8) + "…", symbol: "recipient" },
      };
    default:
      return { from: EMPTY, to: EMPTY };
  }
}
