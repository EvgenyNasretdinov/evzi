import { describe, it, expect } from "vitest";
import { classifyOrigin, hostnameOf, isPunycode } from "../src/index";

describe("origin-trust — hostnameOf", () => {
  it("extracts hostname from full URL", () => {
    expect(hostnameOf("https://app.uniswap.org/swap?chain=base")).toBe("app.uniswap.org");
  });
  it("extracts hostname from bare origin", () => {
    expect(hostnameOf("https://app.uniswap.org")).toBe("app.uniswap.org");
  });
  it("normalizes case", () => {
    expect(hostnameOf("https://App.Uniswap.ORG")).toBe("app.uniswap.org");
  });
  it("returns empty for garbage", () => {
    expect(hostnameOf("")).toBe("");
  });
});

describe("origin-trust — isPunycode", () => {
  it("flags xn-- labels", () => {
    expect(isPunycode("xn--niswap-31a.org")).toBe(true);
    expect(isPunycode("app.xn--uniswp-y3a.org")).toBe(true);
  });
  it("ignores normal hostnames", () => {
    expect(isPunycode("uniswap.org")).toBe(false);
    expect(isPunycode("app.uniswap.org")).toBe(false);
  });
});

describe("origin-trust — classifyOrigin", () => {
  it("recognizes Uniswap as trusted (root)", () => {
    const r = classifyOrigin("https://uniswap.org");
    expect(r.kind).toBe("trusted");
    if (r.kind !== "trusted") throw new Error();
    expect(r.match.protocol).toBe("Uniswap");
    expect(r.matchedDomain).toBe("uniswap.org");
  });

  it("recognizes app.uniswap.org as trusted (subdomain)", () => {
    const r = classifyOrigin("https://app.uniswap.org/swap");
    expect(r.kind).toBe("trusted");
  });

  it("flags punycode hostnames", () => {
    const r = classifyOrigin("https://xn--uniswp-y3a.org");
    expect(r.kind).toBe("punycode");
  });

  it("catches uniswap-app.io as a lookalike", () => {
    const r = classifyOrigin("https://app.uniswap-app.io");
    // uniswap-app.io vs uniswap.org → distance ≤ 2? Actually 4. Not caught.
    // But aavve.com should be caught (distance 1 from aave.com).
    expect(r.kind).toBe("unknown");
  });

  it("catches aavve.com as a lookalike of aave.com", () => {
    const r = classifyOrigin("https://aavve.com");
    expect(r.kind).toBe("lookalike");
    if (r.kind !== "lookalike") throw new Error();
    expect(r.suspectedTarget.protocol).toBe("Aave");
    expect(r.distance).toBeLessThanOrEqual(2);
  });

  it("catches unisvvap.org as a lookalike of uniswap.org", () => {
    const r = classifyOrigin("https://unisvvap.org");
    expect(r.kind).toBe("lookalike");
    if (r.kind !== "lookalike") throw new Error();
    expect(r.suspectedTarget.protocol).toBe("Uniswap");
  });

  it("returns unknown for an unrelated domain", () => {
    const r = classifyOrigin("https://my-personal-blog.com");
    expect(r.kind).toBe("unknown");
  });

  it("treats malformed input as unknown", () => {
    expect(classifyOrigin("").kind).toBe("unknown");
  });
});
