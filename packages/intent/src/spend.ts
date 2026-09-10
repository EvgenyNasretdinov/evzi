import type { DecodedAction } from "@intent-check/types";

export const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export interface Movement {
  token: string;
  amount: string;
  recipient?: string;
  isUnlimited: boolean;
  kind: "approve" | "transfer" | "swapIn";
}

export interface SpendShape {
  movements: Movement[];
  /** True when we cannot tell what leaves the wallet — never read as "nothing leaves". */
  unrecognized: boolean;
}

const lc = (s: string | undefined): string | undefined => s?.toLowerCase();

/**
 * Normalize a decoded action into "what leaves this wallet, and to whom".
 *
 * One normalizing layer so the constraint verifier does not carry a
 * nine-armed switch. `swapIn` is the token leaving the wallet in a swap; the
 * token arriving is not a spend and is deliberately not modelled.
 */
export function extractSpend(decoded: DecodedAction, _chainId: number): SpendShape {
  switch (decoded.kind) {
    case "approve":
      return {
        unrecognized: false,
        movements: [
          {
            token: decoded.token.toLowerCase(),
            amount: decoded.amount,
            recipient: lc(decoded.spender),
            isUnlimited: decoded.isUnlimited,
            kind: "approve",
          },
        ],
      };

    case "setApprovalForAll":
      return {
        unrecognized: false,
        movements: decoded.approved
          ? [
              {
                token: decoded.collection.toLowerCase(),
                amount: MAX_UINT256,
                recipient: lc(decoded.operator),
                isUnlimited: true,
                kind: "approve",
              },
            ]
          : [],
      };

    case "permit":
      return {
        unrecognized: false,
        movements: [
          {
            token: decoded.token.toLowerCase(),
            amount: decoded.amount,
            recipient: lc(decoded.spender),
            isUnlimited: decoded.amount === MAX_UINT256,
            kind: "approve",
          },
        ],
      };

    case "permit2Transfer":
      return {
        unrecognized: false,
        movements: decoded.permitted.map((p) => ({
          token: p.address.toLowerCase(),
          amount: p.amount,
          recipient: lc(decoded.spender),
          isUnlimited: p.amount === MAX_UINT256,
          kind: "approve" as const,
        })),
      };

    case "transfer":
      return {
        unrecognized: false,
        movements: [
          {
            token: decoded.token.toLowerCase(),
            amount: decoded.amount,
            recipient: lc(decoded.to),
            isUnlimited: false,
            kind: "transfer",
          },
        ],
      };

    case "swap":
      return {
        unrecognized: false,
        movements: [
          {
            token: decoded.tokenIn.address.toLowerCase(),
            amount: decoded.tokenIn.amount,
            recipient: lc(decoded.recipient),
            isUnlimited: false,
            kind: "swapIn",
          },
        ],
      };

    case "lendingAction":
      return {
        unrecognized: false,
        movements:
          decoded.verb === "supply" || decoded.verb === "repay"
            ? [
                {
                  token: decoded.asset.toLowerCase(),
                  amount: decoded.amount,
                  recipient: lc(decoded.onBehalfOf ?? decoded.pool),
                  isUnlimited: false,
                  kind: "transfer",
                },
              ]
            : [],
      };

    case "seaportOrder":
      return {
        unrecognized: false,
        movements: decoded.offer.map((o) => ({
          token: o.address.toLowerCase(),
          amount: o.amount,
          recipient: lc(decoded.offerer),
          isUnlimited: false,
          kind: "transfer" as const,
        })),
      };

    case "generic":
    case "unknown":
      return { movements: [], unrecognized: true };
  }
}
