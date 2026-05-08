import { slice, type Hex } from "viem";

export function selectorOf(data: Hex | string): Hex {
  if (!data || data === "0x") return "0x" as Hex;
  return slice(data as Hex, 0, 4);
}
