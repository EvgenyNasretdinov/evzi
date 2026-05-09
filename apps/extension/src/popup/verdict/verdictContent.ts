import type { EvziEyeStatus } from "@/popup/components/EvziEyeLogo";
import { formatTokenAmount } from "@intent-check/token-metadata";
import type { JudgeInput, JudgeVerdict, VerdictTier } from "@intent-check/types";
import { isExactMatch, isPartialMatch } from "@intent-check/types";

/** Legacy export kept for any importers; the new path drops fallbacks entirely. */
export const CHECKLIST_SUBTITLE_FALLBACK = "";

export type VerdictCheckSeverity = "pass" | "caution" | "fail";

/** Where a checklist row's evidence came from. Surfaced as a small chip
 * next to the title so users can see which check produced the signal —
 * teaching value + transparency. */
export type VerdictRowSource =
  | "decoder"    // calldata / typed-data → DecodedAction
  | "registry"   // hand-curated protocol registry hit
  | "sourcify"   // Sourcify verification, proxy resolution, NatSpec userdoc
  | "tenderly"   // transaction simulation
  | "origin"     // origin-trust (known-dApps, lookalike, punycode)
  | "findings"   // deterministic findings (UNLIMITED_APPROVAL, etc.)
  | "agent";     // LLM judgment

export interface VerdictChecklistRow {
  severity: VerdictCheckSeverity;
  title: string;
  description: string;
  source?: VerdictRowSource;
}

export function tierToEyeStatus(tier: VerdictTier): EvziEyeStatus {
  if (tier === "SAFE") return "green";
  if (tier === "CAUTION") return "yellow";
  return "red";
}

function severityFromReason(s: JudgeVerdict["reasons"][number]["severity"]): VerdictCheckSeverity {
  if (s === "info") return "pass";
  if (s === "warn") return "caution";
  return "fail";
}

function shortAddr(a?: string) {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Compose the verdict checklist from the FULL judge input — every
 * deterministic check that ran gets a row with an honest, contextual
 * description. This avoids the "all good" + "Sourcify: not verified"
 * paradox that happens when we surface only LLM reasons.
 *
 * Order: most informative trust signals first (decoded → contract →
 * simulation → recipient), then deterministic findings, then any LLM
 * reasons that don't duplicate the above.
 */
function checklistFromJudgeInput(input: JudgeInput): VerdictChecklistRow[] {
  const rows: VerdictChecklistRow[] = [];
  const d = input.decoded;
  const c = input.contract;
  const sim = input.sim;

  // 1. Decoded action — what the calldata actually does.
  if (d.kind === "swap") {
    const cmds = d.commands && d.commands.length > 0 ? d.commands.join(" → ") : "swap";
    rows.push({
      severity: "pass",
      title: `Decoded as ${d.protocol} swap`,
      description: `Command sequence: ${cmds}.`,
      source: "decoder",
    });
  } else if (d.kind === "approve") {
    rows.push({
      severity: d.isUnlimited ? "fail" : "caution",
      title: `Decoded as ERC-20 approve`,
      description: d.isUnlimited
        ? `Unlimited approval to ${shortAddr(d.spender)}. Anyone holding the spender contract could move all of this token from your wallet, anytime.`
        : `Approve ${d.amount} to ${shortAddr(d.spender)}.`,
      source: "decoder",
    });
  } else if (d.kind === "setApprovalForAll") {
    rows.push({
      severity: d.approved ? "fail" : "pass",
      title: d.approved ? "setApprovalForAll granted" : "setApprovalForAll revoked",
      description: d.approved
        ? `Operator ${shortAddr(d.operator)} can move ANY token in collection ${shortAddr(d.collection)}.`
        : `Revoking operator ${shortAddr(d.operator)} on collection ${shortAddr(d.collection)}.`,
      source: "decoder",
    });
  } else if (d.kind === "permit") {
    rows.push({
      severity: "caution",
      title: "ERC-2612 Permit signature",
      description: `If signed, ${shortAddr(d.spender)} can spend ${d.amount} of token ${shortAddr(d.token)}.`,
      source: "decoder",
    });
  } else if (d.kind === "permit2Transfer") {
    const tokens = d.permitted.length;
    rows.push({
      severity: "caution",
      title: `Permit2 ${tokens > 1 ? "batch " : ""}transfer authorization`,
      description: `${shortAddr(d.spender)} would be authorized to move ${tokens} token${tokens === 1 ? "" : "s"} on your behalf.`,
      source: "decoder",
    });
  } else if (d.kind === "seaportOrder") {
    rows.push({
      severity: "caution",
      title: "Seaport marketplace order",
      description: `Sign-only order: ${d.offer.length} offered → ${d.consideration.length} consideration item${d.consideration.length === 1 ? "" : "s"}.`,
      source: "decoder",
    });
  } else if (d.kind === "transfer") {
    rows.push({
      severity: "pass",
      title: "Direct token transfer",
      description: `${d.amount} of ${shortAddr(d.token)} to ${shortAddr(d.to)}.`,
      source: "decoder",
    });
  } else if (d.kind === "lendingAction") {
    rows.push({
      severity: "pass",
      title: `Decoded as ${d.protocol} ${d.verb}`,
      description: `${d.verb} ${d.amount} of ${shortAddr(d.asset)} on the ${d.protocol} pool${d.onBehalfOf ? ` (on behalf of ${shortAddr(d.onBehalfOf)})` : ""}.`,
      source: "decoder",
    });
  } else if (d.kind === "generic") {
    // ABI-decoded fallback. Format args as name=value when names are present;
    // fall back to bare positional values otherwise. Truncate per-arg so a
    // 256-byte calldata blob doesn't blow up the checklist row.
    const truncate = (s: string) => (s.length > 48 ? `${s.slice(0, 45)}…` : s);
    const argPairs = d.args.map((val, i) => {
      const name = d.argNames?.[i];
      const v = truncate(val);
      return name ? `${name}=${v}` : v;
    });
    const headerArgs = (d.argNames && d.argNames.some(Boolean)) ? d.argNames.join(", ") : d.args.map((_, i) => `arg${i}`).join(", ");
    const titleProtocol = d.protocol ? `${d.protocol} · ` : "";
    rows.push({
      severity: d.trusted ? "pass" : "caution",
      title: `${titleProtocol}Calling ${d.functionName}(${headerArgs}) on ${shortAddr(d.target)}`,
      description: argPairs.length > 0
        ? `Arguments: ${argPairs.join(", ")}.`
        : `No arguments. Decoded from the contract's ABI (Sourcify-provided).`,
      source: "decoder",
    });
  } else {
    rows.push({
      severity: "caution",
      title: "Calldata could not be decoded",
      description: `Selector ${"selector" in d ? d.selector : "?"} doesn't match any known shape. The agent reasons from the contract address and simulation alone.`,
      source: "decoder",
    });
  }

  // 1b. Author intent (NatSpec userdoc) — what the contract author says.
  // Surfaced before contract trust so the user reads the human-language
  // description first, then sees how trusted the source of that description is.
  if (c.authorIntent?.contract) {
    rows.push({
      severity: "pass",
      title: "What the contract author says it does",
      description: c.authorIntent.contract,
      source: "sourcify",
    });
  }
  if (c.authorIntent?.method) {
    rows.push({
      severity: "pass",
      title: "What this specific function says about itself",
      description: c.authorIntent.method,
      source: "sourcify",
    });
  }

  // 2. Contract trust — registry first (authoritative), then Sourcify.
  if (c.knownProtocol) {
    if (c.verified && isExactMatch(c.matchType)) {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} contract`,
        description: `Address matches our registry of canonical ${c.knownProtocol.protocol} deployments and Sourcify verifies the source code (perfect match).`,
        source: "registry",
      });
    } else if (c.verified && isPartialMatch(c.matchType)) {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} contract`,
        description: `Address matches our registry of canonical ${c.knownProtocol.protocol} deployments. Sourcify match is "partial" (compiler settings differ slightly), which is normal for ${c.knownProtocol.protocol}.`,
        source: "registry",
      });
    } else {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} · ${c.knownProtocol.name}`,
        description: `This address matches our hand-curated registry of canonical ${c.knownProtocol.protocol} deployments. Sourcify doesn't list it as verified — that's common for ${c.knownProtocol.protocol} contracts on this chain — but the registry match is enough to trust the address.`,
        source: "registry",
      });
    }
  } else if (c.verified && isExactMatch(c.matchType)) {
    rows.push({
      severity: "pass",
      title: "Sourcify: perfect match",
      description: `Sourcify confirms the deployed bytecode matches verified source${c.contractName ? ` (${c.contractName})` : ""}.`,
      source: "sourcify",
    });
  } else if (c.verified && isPartialMatch(c.matchType)) {
    rows.push({
      severity: "caution",
      title: "Sourcify: partial match",
      description: `Sourcify has source for this contract${c.contractName ? ` (${c.contractName})` : ""} but compiler settings differ from the canonical match. Usually safe but worth noting.`,
      source: "sourcify",
    });
  } else {
    rows.push({
      severity: "caution",
      title: "Sourcify: not verified",
      description: `Sourcify doesn't have this contract's source code. Without source, we can't independently confirm what it does.`,
      source: "sourcify",
    });
  }

  // 3. Simulation outcome.
  if (!sim) {
    rows.push({
      severity: "caution",
      title: "Simulation: skipped",
      description: "Tenderly isn't configured (or not applicable for signature requests). The agent reasons from calldata and contract trust alone.",
      source: "tenderly",
    });
  } else if (!sim.success) {
    rows.push({
      severity: "fail",
      title: "Simulation failed",
      description: sim.failureReason ?? "The transaction would revert. Signing it as-is wastes gas and accomplishes nothing.",
      source: "tenderly",
    });
  } else {
    const ne = input.netEffect;
    const netLine = ne && ne.deltas.length > 0
      ? "Net effect: " + ne.deltas.map((d2) => {
          const sym = d2.symbol ?? shortAddr(d2.token);
          if (typeof d2.decimals === "number") {
            // formatTokenAmount handles sign internally; "−" is rendered for negatives.
            const human = formatTokenAmount(d2.amount, d2.decimals);
            const prefix = human.startsWith("−") ? "" : "+";
            return `${prefix}${human} ${sym}`;
          }
          // No decimals available — fall back to raw integer with explicit +/−.
          const sign = d2.amount.startsWith("-") ? "−" : "+";
          return `${sign}${d2.amount.replace(/^-/, "")} ${sym}`;
        }).join(", ")
      : "No net change to your wallet.";
    rows.push({
      severity: "pass",
      title: `Simulation succeeded · ${sim.assetChanges.length} asset change${sim.assetChanges.length === 1 ? "" : "s"}`,
      description: `${netLine} Gas used: ${sim.gasUsed}.`,
      source: "tenderly",
    });
  }

  // 4. Recipient (only meaningful for swaps).
  if (d.kind === "swap") {
    if (d.recipientKind === "wallet") {
      rows.push({
        severity: "pass",
        title: "Output goes to your wallet",
        description: "The decoded recipient resolves to your address (Uniswap MSG_SENDER sentinel).",
        source: "decoder",
      });
    } else if (d.recipientKind === "router_self") {
      rows.push({
        severity: "pass",
        title: "Output handed back to the router",
        description: "Uniswap convention: 0x…0002 means 'route output stays on the router for the next command' (typically UNWRAP_WETH followed by transfer to your wallet). Not a third-party drain.",
        source: "decoder",
      });
    } else if (d.recipientKind === "third_party") {
      rows.push({
        severity: "fail",
        title: "Output goes to a third party",
        description: `Recipient ${shortAddr(d.recipient)} is neither your wallet nor a router-self sentinel. Check carefully.`,
        source: "decoder",
      });
    }
  }

  // 5. Origin trust — known dApp / lookalike / unknown.
  const o = input.origin;
  if (o.knownDappMatch?.matched) {
    rows.push({
      severity: "pass",
      title: `Origin: ${o.knownDappMatch.name} (verified)`,
      description: `Page is served from a domain we recognise as ${o.knownDappMatch.name}. The expected domains are ${o.knownDappMatch.expectedDomains.join(", ")}.`,
      source: "origin",
    });
  } else if (o.punycode) {
    rows.push({
      severity: "fail",
      title: "Origin: punycode-encoded hostname",
      description: `The page hostname uses xn-- punycode labels — a classic lookalike-domain phishing pattern. Wallets often display the visually-similar Unicode form.`,
      source: "origin",
    });
  } else if (o.lookalikeOf) {
    rows.push({
      severity: "fail",
      title: `Origin: lookalike of ${o.lookalikeOf}`,
      description: `The page hostname is very close to a known ${o.lookalikeOf} domain but isn't it. Likely phishing.`,
      source: "origin",
    });
  } else if (o.origin) {
    // Unknown origin — informational, not bad. Only show when we have something.
    rows.push({
      severity: "caution",
      title: `Origin: ${o.origin}`,
      description: `We don't recognise this dApp. That doesn't mean it's malicious — but check the URL carefully and look for other red flags above.`,
      source: "origin",
    });
  }

  // 6. Deterministic findings — append any with non-info severity that aren't
  // already covered above. (info-level findings are usually informational
  // duplicates of the rows we already added.)
  for (const f of input.findings) {
    if (f.severity === "info") continue;
    rows.push({
      severity: severityFromReason(f.severity),
      title: f.text,
      description: `Deterministic check (${f.code}).`,
      source: "findings",
    });
  }

  return rows;
}

/**
 * Append the LLM's reasons that aren't already represented in deterministic
 * checks. Uses simple string overlap to dedupe — a reason whose first 6
 * meaningful words appear in any existing row's title/description is dropped.
 */
function appendLlmReasons(rows: VerdictChecklistRow[], verdict: JudgeVerdict): VerdictChecklistRow[] {
  const haystack = rows.map((r) => (r.title + " " + r.description).toLowerCase()).join(" || ");
  const out = rows.slice();
  for (const r of verdict.reasons) {
    const text = (r.text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase().split(/\s+/).slice(0, 6).join(" ");
    if (key && haystack.includes(key)) continue;
    out.push({
      severity: severityFromReason(r.severity),
      title: text,
      description: "",
      source: "agent",
    });
  }
  return out;
}

const TIER_TITLE: Record<VerdictTier, string> = {
  SAFE: "All looks good",
  CAUTION: "Worth a closer look",
  DANGER: "Don't sign this",
};

export function buildVerdictScreenModel(verdict: JudgeVerdict, judgeInput: JudgeInput): {
  eyeStatus: EvziEyeStatus;
  title: string;
  description: string;
  checklist: VerdictChecklistRow[];
  primaryLabel: string;
  secondaryLabel: string;
} {
  const checklist = appendLlmReasons(checklistFromJudgeInput(judgeInput), verdict);
  const description = verdict.headline?.trim() || "";

  const isDanger = verdict.tier === "DANGER";
  return {
    eyeStatus: tierToEyeStatus(verdict.tier),
    title: TIER_TITLE[verdict.tier],
    description,
    checklist,
    primaryLabel: isDanger ? "Reject transaction" : "Continue signing",
    secondaryLabel: isDanger ? "Continue anyway" : "Reject transaction",
  };
}

export function formatJudgeInputRaw(judgeInput: JudgeInput, origin: string): string {
  return JSON.stringify(
    {
      origin,
      decoded: judgeInput.decoded,
      sim: judgeInput.sim,
      contract: judgeInput.contract,
      findings: judgeInput.findings,
    },
    null,
    2
  );
}
