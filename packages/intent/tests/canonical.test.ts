import { describe, it, expect } from "vitest";
import { canonicalize, sha256Hex } from "../src/canonical";

describe("intent — canonicalize", () => {
  it("sorts object keys so key order cannot change the output", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalize({ x: { d: 1, c: 2 } })).toBe('{"x":{"c":2,"d":1}}');
  });

  it("preserves array order, because order is meaningful", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no incidental whitespace", () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it("drops undefined members so optional fields cannot shift the hash", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("keeps null, which is a real value", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("escapes strings via JSON rules", () => {
    expect(canonicalize({ a: 'q"\n' })).toBe('{"a":"q\\"\\n"}');
  });
});

describe("intent — sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable across calls", async () => {
    expect(await sha256Hex("evzi")).toBe(await sha256Hex("evzi"));
  });
});
