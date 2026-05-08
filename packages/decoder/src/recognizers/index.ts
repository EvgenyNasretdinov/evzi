import type { DecodedAction } from "@intent-check/types";
import { tryDecodeErc20 } from "./erc20";
import { tryDecodeUniversalRouter } from "./uniswapUniversalRouter";

export type DecodeContext = { chainId: number; to: string; data: string; value: string };
export type Recognizer = (ctx: DecodeContext) => DecodedAction | null | Promise<DecodedAction | null>;

export const recognizers: Recognizer[] = [tryDecodeUniversalRouter, tryDecodeErc20];
