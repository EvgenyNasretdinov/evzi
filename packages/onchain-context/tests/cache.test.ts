import { describe, it, expect, beforeEach } from "vitest";
import { cacheGet, cacheSet, cachedOrKickoff, clearCache, drainInflight } from "../src/cache";

describe("onchain-context — cache", () => {
  beforeEach(() => clearCache());

  it("returns a stored value before it expires", () => {
    cacheSet("k", 42, 1000, 0);
    expect(cacheGet<number>("k", 500)).toBe(42);
  });

  it("drops a value once it expires", () => {
    cacheSet("k", 42, 1000, 0);
    expect(cacheGet<number>("k", 1001)).toBeUndefined();
  });

  it("misses on an unknown key", () => {
    expect(cacheGet("nope")).toBeUndefined();
  });

  it("returns undefined on a cold miss and does not wait for the fetch", async () => {
    let finished = false;
    const out = cachedOrKickoff("k", 1000, async () => {
      await new Promise((r) => setTimeout(r, 30));
      finished = true;
      return "late";
    });
    expect(out).toBeUndefined();
    expect(finished).toBe(false);
    await drainInflight();
    expect(finished).toBe(true);
  });

  it("serves the value once the background fetch has landed", async () => {
    cachedOrKickoff("k", 1000, async () => "warm");
    await drainInflight();
    expect(cachedOrKickoff("k", 1000, async () => "should not be called")).toBe("warm");
  });

  it("coalesces concurrent misses into a single fetch", async () => {
    let calls = 0;
    const f = async () => {
      calls += 1;
      return "v";
    };
    cachedOrKickoff("k", 1000, f);
    cachedOrKickoff("k", 1000, f);
    cachedOrKickoff("k", 1000, f);
    await drainInflight();
    expect(calls).toBe(1);
  });

  it("does not cache a failed fetch", async () => {
    cachedOrKickoff("k", 1000, async () => {
      throw new Error("boom");
    });
    await drainInflight();
    expect(cacheGet("k")).toBeUndefined();
  });

  it("does not cache an undefined result", async () => {
    cachedOrKickoff("k", 1000, async () => undefined);
    await drainInflight();
    expect(cacheGet("k")).toBeUndefined();
  });
});
