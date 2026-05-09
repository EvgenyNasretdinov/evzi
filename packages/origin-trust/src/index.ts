/**
 * Origin trust signals: detects whether a dApp page's origin is a known
 * good dApp, a lookalike of one, or has an unusual encoding (punycode).
 *
 * Phishing in 2026 is most often *origin* impersonation: `app.uniswap-claim.io`
 * vs `app.uniswap.org`. Any user gut-feel about "the URL looks weird" can be
 * captured deterministically as a Levenshtein distance + punycode flag.
 *
 * No network calls. The list of known dApps is hand-curated and small.
 */

export interface KnownDapp {
  /** Display name shown to the user. */
  name: string;
  /** Protocol family ("Uniswap", "Aave"). Not always equal to name. */
  protocol: string;
  /**
   * Domains the dApp legitimately runs on. Subdomains of these match too
   * (e.g., listing "uniswap.org" matches "app.uniswap.org").
   */
  domains: string[];
  /**
   * What the dApp does, in one short phrase. Powers the contextual descriptions
   * in the popup ("This is the official Uniswap interface").
   */
  what: string;
}

/**
 * Hand-curated. Goal: cover the dApps users are most likely to interact with
 * on a hackathon-day demo, plus the well-known phishing targets. Each entry
 * is fewer than 100 chars total.
 */
const KNOWN_DAPPS: KnownDapp[] = [
  { name: "Uniswap",       protocol: "Uniswap",  domains: ["uniswap.org", "uniswap.com"], what: "Uniswap (DEX swap router)" },
  { name: "Aave",          protocol: "Aave",     domains: ["aave.com"], what: "Aave (lending market)" },
  { name: "OpenSea",       protocol: "OpenSea",  domains: ["opensea.io"], what: "OpenSea (NFT marketplace)" },
  { name: "Blur",          protocol: "Blur",     domains: ["blur.io"], what: "Blur (NFT marketplace)" },
  { name: "ENS",           protocol: "ENS",      domains: ["ens.domains", "app.ens.domains"], what: "ENS (Ethereum Name Service)" },
  { name: "1inch",         protocol: "1inch",    domains: ["1inch.io", "app.1inch.io"], what: "1inch (DEX aggregator)" },
  { name: "Curve",         protocol: "Curve",    domains: ["curve.fi", "curve.finance"], what: "Curve (stablecoin DEX)" },
  { name: "Compound",      protocol: "Compound", domains: ["compound.finance", "app.compound.finance"], what: "Compound (lending market)" },
  { name: "Lido",          protocol: "Lido",     domains: ["lido.fi"], what: "Lido (liquid staking)" },
  { name: "Across",        protocol: "Across",   domains: ["across.to"], what: "Across (cross-chain bridge)" },
  { name: "Hop",           protocol: "Hop",      domains: ["hop.exchange"], what: "Hop (cross-chain bridge)" },
  { name: "Stargate",      protocol: "Stargate", domains: ["stargate.finance"], what: "Stargate (cross-chain bridge)" },
  { name: "Coinbase Wallet", protocol: "Coinbase", domains: ["wallet.coinbase.com"], what: "Coinbase Wallet web app" },
  { name: "Pendle",        protocol: "Pendle",   domains: ["pendle.finance", "app.pendle.finance"], what: "Pendle (yield trading)" },
  { name: "EigenLayer",    protocol: "EigenLayer", domains: ["eigenlayer.xyz", "app.eigenlayer.xyz"], what: "EigenLayer (restaking)" },
];

export type OriginVerdict =
  | { kind: "trusted";   match: KnownDapp; matchedDomain: string }
  | { kind: "lookalike"; suspectedTarget: KnownDapp; reason: "levenshtein"; distance: number; suspectDomain: string }
  | { kind: "punycode";  hostname: string }
  | { kind: "unknown";   hostname: string };

/**
 * Extract the hostname from a URL or origin string. Returns "" on failure.
 * We accept full URLs ("https://app.uniswap.org/swap") and bare origins
 * ("https://app.uniswap.org") and bare hostnames ("app.uniswap.org").
 *
 * Some URL parsers normalize punycode-encoded labels back to Unicode (per
 * IDNA), which would defeat the lookalike-detection purpose. We pull the
 * raw hostname out of the input ourselves so `xn--…` stays as-is.
 */
export function hostnameOf(input: string): string {
  if (!input) return "";
  // Strip scheme + path manually so xn-- labels survive intact.
  const noScheme = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = noScheme.split(/[/?#]/, 1)[0] ?? "";
  // Strip userinfo and port.
  const noUser = host.includes("@") ? host.split("@").slice(-1)[0] ?? "" : host;
  const noPort = noUser.split(":")[0] ?? "";
  return noPort.toLowerCase();
}

/**
 * `isPunycode("xn--niswap-31a.org")` → true. Punycode-encoded internationalized
 * domain names are a classic phishing vector ("аpp.uniswap.org" with a Cyrillic
 * 'а' encodes as `xn--`). Wallets/browsers display the original glyphs but the
 * URL's bytes betray it.
 */
export function isPunycode(hostname: string): boolean {
  if (!hostname) return false;
  return hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"));
}

function isExactOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Classic Levenshtein, capped — no need to compute beyond 4 for our purposes
 * (lookalike threshold). Cap-and-bail is a meaningful speedup for long inputs.
 */
function levenshtein(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > cap) return cap + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev: number[] = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  let curr: number[] = new Array<number>(bl + 1).fill(0);
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const c = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      curr[j] = c;
      if (c < rowMin) rowMin = c;
    }
    if (rowMin > cap) return cap + 1;
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[bl] ?? cap + 1;
}

/**
 * Classify a page origin against the known-dApp directory.
 *
 * - **trusted**:  hostname matches a known domain or its subdomain.
 * - **punycode**: hostname has any `xn--` label. Always at least caution-tier.
 * - **lookalike**: hostname is within Levenshtein distance ≤2 of a known
 *                  domain after stripping common subdomains. Catches
 *                  `unisvvap.org`, `uniswap-app.io`, `aavve.com` style typos.
 * - **unknown**:  no known-dApp signal either way.
 */
export function classifyOrigin(originOrUrl: string): OriginVerdict {
  const host = hostnameOf(originOrUrl);
  if (!host) return { kind: "unknown", hostname: "" };

  // Punycode is a strong signal — return early.
  if (isPunycode(host)) return { kind: "punycode", hostname: host };

  // Trusted match (host or any subdomain of a known domain).
  for (const dapp of KNOWN_DAPPS) {
    for (const domain of dapp.domains) {
      if (isExactOrSubdomain(host, domain)) {
        return { kind: "trusted", match: dapp, matchedDomain: domain };
      }
    }
  }

  // Lookalike: compare the registrable domain (last 2 labels) against each
  // known domain. We focus on the registrable part because subdomains can
  // be anything.
  const labels = host.split(".");
  const registrable = labels.length >= 2 ? labels.slice(-2).join(".") : host;
  let bestSuspect: KnownDapp | null = null;
  let bestDistance = Infinity;
  for (const dapp of KNOWN_DAPPS) {
    for (const domain of dapp.domains) {
      const knownReg = domain.split(".").slice(-2).join(".");
      if (knownReg === registrable) continue; // exact match handled above
      const d = levenshtein(registrable, knownReg, 2);
      if (d <= 2 && d < bestDistance) {
        bestDistance = d;
        bestSuspect = dapp;
      }
    }
  }
  if (bestSuspect) {
    return { kind: "lookalike", suspectedTarget: bestSuspect, reason: "levenshtein", distance: bestDistance, suspectDomain: registrable };
  }

  return { kind: "unknown", hostname: host };
}

export { KNOWN_DAPPS };
