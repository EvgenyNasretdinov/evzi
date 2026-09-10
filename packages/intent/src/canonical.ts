/**
 * Deterministic JSON: object keys sorted, no incidental whitespace,
 * `undefined` members dropped. Two structurally equal values always
 * serialize to the same string, so hashing them is meaningful.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("canonicalize: non-finite number");
  }

  return JSON.stringify(value) ?? "null";
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
