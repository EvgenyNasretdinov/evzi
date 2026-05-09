import type { DecodedAction } from "@intent-check/types";
import { tryDecodeAaveV3 } from "./aaveV3";
import { tryDecodeErc20 } from "./erc20";
import { tryDecodeUniversalRouter } from "./uniswapUniversalRouter";

export type DecodeContext = { chainId: number; to: string; data: string; value: string; from?: string };
export type Recognizer = (ctx: DecodeContext) => DecodedAction | null | Promise<DecodedAction | null>;

// Order: most-specific protocol-shape recognizers first; ERC-20 fallback last.
export const recognizers: Recognizer[] = [tryDecodeUniversalRouter, tryDecodeAaveV3, tryDecodeErc20];
