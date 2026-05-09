import type { EvziEyeStatus } from "@/popup/components/EvziEyeLogo";
import { formatTokenAmount } from "@intent-check/token-metadata";
import type { JudgeInput, JudgeVerdict, VerdictTier } from "@intent-check/types";

/** Legacy export kept for any importers; the new path drops fallbacks entirely. */
export const CHECKLIST_SUBTITLE_FALLBACK = "";

export type VerdictCheckSeverity = "pass" | "caution" | "fail";

export interface VerdictChecklistRow {
  severity: VerdictCheckSeverity;
  title: string;
  description: string;
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
    });
  } else if (d.kind === "approve") {
    rows.push({
      severity: d.isUnlimited ? "fail" : "caution",
      title: `Decoded as ERC-20 approve`,
      description: d.isUnlimited
        ? `Unlimited approval to ${shortAddr(d.spender)}. Anyone holding the spender contract could move all of this token from your wallet, anytime.`
        : `Approve ${d.amount} to ${shortAddr(d.spender)}.`,
    });
  } else if (d.kind === "setApprovalForAll") {
    rows.push({
      severity: d.approved ? "fail" : "pass",
      title: d.approved ? "setApprovalForAll granted" : "setApprovalForAll revoked",
      description: d.approved
        ? `Operator ${shortAddr(d.operator)} can move ANY token in collection ${shortAddr(d.collection)}.`
        : `Revoking operator ${shortAddr(d.operator)} on collection ${shortAddr(d.collection)}.`,
    });
  } else if (d.kind === "permit") {
    rows.push({
      severity: "caution",
      title: "ERC-2612 Permit signature",
      description: `If signed, ${shortAddr(d.spender)} can spend ${d.amount} of token ${shortAddr(d.token)}.`,
    });
  } else if (d.kind === "permit2Transfer") {
    const tokens = d.permitted.length;
    rows.push({
      severity: "caution",
      title: `Permit2 ${tokens > 1 ? "batch " : ""}transfer authorization`,
      description: `${shortAddr(d.spender)} would be authorized to move ${tokens} token${tokens === 1 ? "" : "s"} on your behalf.`,
    });
  } else if (d.kind === "seaportOrder") {
    rows.push({
      severity: "caution",
      title: "Seaport marketplace order",
      description: `Sign-only order: ${d.offer.length} offered → ${d.consideration.length} consideration item${d.consideration.length === 1 ? "" : "s"}.`,
    });
  } else if (d.kind === "transfer") {
    rows.push({
      severity: "pass",
      title: "Direct token transfer",
      description: `${d.amount} of ${shortAddr(d.token)} to ${shortAddr(d.to)}.`,
    });
  } else {
    rows.push({
      severity: "caution",
      title: "Calldata could not be decoded",
      description: `Selector ${"selector" in d ? d.selector : "?"} doesn't match any known shape. The agent reasons from the contract address and simulation alone.`,
    });
  }

  // 2. Contract trust — registry first (authoritative), then Sourcify.
  if (c.knownProtocol) {
    if (c.verified && c.matchType === "perfect") {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} contract`,
        description: `Address matches our registry of canonical ${c.knownProtocol.protocol} deployments and Sourcify verifies the source code (perfect match).`,
      });
    } else if (c.verified && c.matchType === "partial") {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} contract`,
        description: `Address matches our registry of canonical ${c.knownProtocol.protocol} deployments. Sourcify match is "partial" (compiler settings differ slightly), which is normal for ${c.knownProtocol.protocol}.`,
      });
    } else {
      rows.push({
        severity: "pass",
        title: `Trusted ${c.knownProtocol.protocol} · ${c.knownProtocol.name}`,
        description: `This address matches our hand-curated registry of canonical ${c.knownProtocol.protocol} deployments. Sourcify doesn't list it as verified — that's common for ${c.knownProtocol.protocol} contracts on this chain — but the registry match is enough to trust the address.`,
      });
    }
  } else if (c.verified && c.matchType === "perfect") {
    rows.push({
      severity: "pass",
      title: "Sourcify: perfect match",
      description: `Sourcify confirms the deployed bytecode matches verified source${c.contractName ? ` (${c.contractName})` : ""}.`,
    });
  } else if (c.verified && c.matchType === "partial") {
    rows.push({
      severity: "caution",
      title: "Sourcify: partial match",
      description: `Sourcify has source for this contract${c.contractName ? ` (${c.contractName})` : ""} but compiler settings differ from the canonical match. Usually safe but worth noting.`,
    });
  } else {
    rows.push({
      severity: "caution",
      title: "Sourcify: not verified",
      description: `Sourcify doesn't have this contract's source code. Without source, we can't independently confirm what it does.`,
    });
  }

  // 3. Simulation outcome.
  if (!sim) {
    rows.push({
      severity: "caution",
      title: "Simulation: skipped",
      description: "Tenderly isn't configured (or not applicable for signature requests). The agent reasons from calldata and contract trust alone.",
    });
  } else if (!sim.success) {
    rows.push({
      severity: "fail",
      title: "Simulation failed",
      description: sim.failureReason ?? "The transaction would revert. Signing it as-is wastes gas and accomplishes nothing.",
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
    });
  }

  // 4. Recipient (only meaningful for swaps).
  if (d.kind === "swap") {
    if (d.recipientKind === "wallet") {
      rows.push({
        severity: "pass",
        title: "Output goes to your wallet",
        description: "The decoded recipient resolves to your address (Uniswap MSG_SENDER sentinel).",
      });
    } else if (d.recipientKind === "router_self") {
      rows.push({
        severity: "pass",
        title: "Output handed back to the router",
        description: "Uniswap convention: 0x…0002 means 'route output stays on the router for the next command' (typically UNWRAP_WETH followed by transfer to your wallet). Not a third-party drain.",
      });
    } else if (d.recipientKind === "third_party") {
      rows.push({
        severity: "fail",
        title: "Output goes to a third party",
        description: `Recipient ${shortAddr(d.recipient)} is neither your wallet nor a router-self sentinel. Check carefully.`,
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
    });
  } else if (o.punycode) {
    rows.push({
      severity: "fail",
      title: "Origin: punycode-encoded hostname",
      description: `The page hostname uses xn-- punycode labels — a classic lookalike-domain phishing pattern. Wallets often display the visually-similar Unicode form.`,
    });
  } else if (o.lookalikeOf) {
    rows.push({
      severity: "fail",
      title: `Origin: lookalike of ${o.lookalikeOf}`,
      description: `The page hostname is very close to a known ${o.lookalikeOf} domain but isn't it. Likely phishing.`,
    });
  } else if (o.origin) {
    // Unknown origin — informational, not bad. Only show when we have something.
    rows.push({
      severity: "caution",
      title: `Origin: ${o.origin}`,
      description: `We don't recognise this dApp. That doesn't mean it's malicious — but check the URL carefully and look for other red flags above.`,
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
