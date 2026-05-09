import { describe, it, expect } from "vitest";
import { encodeFunctionData } from "viem";
import { tryDecodeWithAbi } from "../src/recognizers/genericAbi";

const CURVE_EXCHANGE_ABI = [{
  type: "function",
  name: "exchange",
  inputs: [
    { name: "i", type: "int128" },
    { name: "j", type: "int128" },
    { name: "dx", type: "uint256" },
    { name: "min_dy", type: "uint256" },
  ],
  outputs: [{ type: "uint256" }],
  stateMutability: "nonpayable",
}] as const;

describe("tryDecodeWithAbi", () => {
  it("decodes a function call against its ABI", () => {
    const calldata = encodeFunctionData({
      abi: CURVE_EXCHANGE_ABI,
      functionName: "exchange",
      args: [0n, 1n, 100_000_000n, 99_500_000n],
    });
    const result = tryDecodeWithAbi({ calldata, to: "0xCurvePool" }, CURVE_EXCHANGE_ABI as any);
    expect(result?.kind).toBe("generic");
    if (result?.kind === "generic") {
      expect(result.functionName).toBe("exchange");
      expect(result.signature).toBe("exchange(int128,int128,uint256,uint256)");
      expect(result.argNames).toEqual(["i", "j", "dx", "min_dy"]);
      expect(result.args).toEqual(["0", "1", "100000000", "99500000"]);
      expect(result.target).toBe("0xcurvepool");
      expect(result.trusted).toBe(false);
    }
  });

  it("returns null when calldata doesn't match any function in the ABI", () => {
    const result = tryDecodeWithAbi(
      { calldata: "0xdeadbeef00000000000000000000000000000000000000000000000000000000", to: "0xPool" },
      CURVE_EXCHANGE_ABI as any
    );
    expect(result).toBeNull();
  });

  it("returns null on empty ABI", () => {
    expect(tryDecodeWithAbi({ calldata: "0xa9059cbb", to: "0x" }, [])).toBeNull();
  });

  it("returns null on too-short calldata", () => {
    expect(tryDecodeWithAbi({ calldata: "0xa9", to: "0x" }, CURVE_EXCHANGE_ABI as any)).toBeNull();
  });

  it("stringifies bigint args correctly", () => {
    const calldata = encodeFunctionData({
      abi: CURVE_EXCHANGE_ABI,
      functionName: "exchange",
      args: [0n, 1n, 12345678901234567890n, 0n],
    });
    const result = tryDecodeWithAbi({ calldata, to: "0xPool" }, CURVE_EXCHANGE_ABI as any);
    if (result?.kind === "generic") {
      expect(result.args[2]).toBe("12345678901234567890");
    }
  });
});
