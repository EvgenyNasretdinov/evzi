import { decode, decodeTypedData, parseTypedData, isUnlimitedAmount } from "@intent-check/decoder";
import { classifyOrigin } from "@intent-check/origin-trust";
import { lookupProtocol } from "@intent-check/protocol-registry";
import { fetchVerifiedContract } from "@intent-check/sourcify-client";
import { simulate } from "@intent-check/tenderly-client";
import type { JudgeInput, JudgeVerdict, WalletRequest, ContractMeta, OriginSignals, UserIntent, Finding, SimResult, NetDelta } from "@intent-check/types";
import type { ContentToBackground, BackgroundToContent, PageSnapshot } from "./shared/messaging";
import {
  JUDGE_URL, JUDGE_API_KEY, INFER_INTENT_URL,
  TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT_SLUG, TENDERLY_PROJECT_SLUG,
  CHAIN_ID_TO_NETWORK_ID,
} from "./shared/config";

/**
 * A single observable step in the verdict pipeline. Surfaces in the popup as a
 * checklist so the user sees exactly which network call is in flight.
 *
 * `status` is the lifecycle: pending → running → done (or skipped).
 * `tone`   is the OUTCOME, only meaningful when status is "done":
 *    - "ok"   : check passed (green ✓)
 *    - "warn" : check completed but result is negative or partial (amber ⚠)
 *    - "bad"  : check failed (red ✗)
 *    - undefined / "ok" by default
 *
 * Splitting status from tone fixes the "green checkmark next to 'Not verified'"
 * anti-pattern — the step DID finish, but its result is not a positive signal.
 */
export type JudgingStep = {
  id: "decoding" | "registry" | "sourcify" | "simulating" | "judging";
  label: string;
  status: "pending" | "running" | "done" | "skipped";
  tone?: "ok" | "warn" | "bad";
  detail?: string;
};

const PIPELINE: { id: JudgingStep["id"]; label: string }[] = [
  { id: "decoding",   label: "Decoding calldata" },
  { id: "registry",   label: "Looking up known protocol" },
  { id: "sourcify",   label: "Checking Sourcify verification" },
  { id: "simulating", label: "Simulating transaction" },
  { id: "judging",    label: "Asking the agent for a verdict" },
];

function makeSteps(overrides: Partial<Record<JudgingStep["id"], Partial<JudgingStep>>>): JudgingStep[] {
  return PIPELINE.map((p) => ({
    id: p.id,
    label: p.label,
    status: overrides[p.id]?.status ?? "pending",
    tone: overrides[p.id]?.tone,
    detail: overrides[p.id]?.detail,
  }));
}

type PhaseState =
  | {
      phase: "awaiting_confirm";
      tabId: number;
      baseDraft: {
        request: WalletRequest;
        origin: string;
        pageSnapshot: PageSnapshot;
        clickContext?: { text: string; ariaLabel?: string; sectionHeading?: string };
        chainId: number;
        decoded: JudgeInput["decoded"];
        contract: ContractMeta;
        intent: UserIntent;
      };
    }
  | {
      phase: "judging";
      tabId: number;
      origin: string;
      intent: UserIntent;
      decoded: JudgeInput["decoded"];
      contract: ContractMeta;
      // Per-step progress so the popup can render a checklist of what's done,
      // running, or pending. Steps run sequentially in this order:
      //   simulating → judging
      // (decoding/registry/sourcify run before user-confirm, included as "done"
      // entries here so the popup shows the full pipeline.)
      steps: JudgingStep[];
      // Wall-clock millisecond timestamp when the *current* step entered.
      // Popup uses it to detect a stuck state (>60s) and offer a retry.
      enteredAt: number;
    }
  | {
      phase: "verdict_ready";
      tabId: number;
      request: WalletRequest;
      origin: string;
      pageSnapshot: PageSnapshot;
      judgeInput: JudgeInput;
      verdict: JudgeVerdict;
    }
  | {
      phase: "error";
      tabId: number;
      origin: string;
      message: string;
      // Snapshot of the awaiting_confirm state, so the popup's "Retry" button
      // can re-issue the user_intent_confirmed message without re-decoding.
      retryDraft?: {
        request: WalletRequest;
        origin: string;
        pageSnapshot: PageSnapshot;
        clickContext?: { text: string; ariaLabel?: string; sectionHeading?: string };
        chainId: number;
        decoded: JudgeInput["decoded"];
        contract: ContractMeta;
        intent: UserIntent;
      };
    };

async function setState(id: string, s: PhaseState) {
  await chrome.storage.session.set({ [`pending:${id}`]: s, lastPendingId: id });
}
async function getState(id: string): Promise<PhaseState | undefined> {
  const r = await chrome.storage.session.get([`pending:${id}`]);
  return r[`pending:${id}`];
}
async function clearState(id: string) {
  await chrome.storage.session.remove([`pending:${id}`]);
}

/**
 * Regex-based fallback. Used when the /infer-intent endpoint is unavailable
 * (judge offline, no OpenAI key configured) or as a hint to seed the LLM.
 */
function inferIntentRegex(snapshot: PageSnapshot, click?: { text?: string }): UserIntent {
  const text = [snapshot.title, snapshot.ogTitle, snapshot.ogSiteName, snapshot.visibleButtonText, click?.text].filter(Boolean).join(" | ").toLowerCase();
  // Order matters — earlier matches win. Most specific verbs first.
  if (/\bswap\b|\btrade\b/.test(text))                   return { kind: "swap",     summary: click?.text ?? snapshot.title ?? "Swap on this dApp", confidence: 0.6 };
  if (/\bapprove\b|\ballow\b/.test(text))                return { kind: "approve",  summary: click?.text ?? snapshot.title ?? "Approve token",     confidence: 0.5 };
  if (/\bmint\b/.test(text))                             return { kind: "mint",     summary: click?.text ?? snapshot.title ?? "Mint NFT",          confidence: 0.5 };
  if (/\bsupply\b|\bdeposit\b|\bstake\b|\blend\b/.test(text))
                                                         return { kind: "deposit",  summary: click?.text ?? snapshot.title ?? "Deposit",           confidence: 0.5 };
  if (/\bbridge\b/.test(text))                           return { kind: "bridge",   summary: click?.text ?? snapshot.title ?? "Bridge",            confidence: 0.5 };
  if (/\bbuy\b|\bpurchase\b|\bcheckout\b/.test(text))    return { kind: "transfer", summary: click?.text ?? snapshot.title ?? "Buy / purchase",    confidence: 0.4 };
  if (/\bsend\b|\btransfer\b/.test(text))                return { kind: "transfer", summary: click?.text ?? snapshot.title ?? "Transfer",          confidence: 0.5 };
  return { kind: "other", summary: click?.text ?? snapshot.title ?? "Unknown action", confidence: 0.2 };
}

const INFER_TIMEOUT_MS = 8_000;

/**
 * Try the LLM-backed /infer-intent first; fall back to regex on any failure.
 * Total wall time capped at INFER_TIMEOUT_MS so the awaiting-confirm UI never
 * stalls waiting for a network round-trip.
 */
async function inferIntent(args: {
  snapshot: PageSnapshot;
  origin: string;
  clickContext?: { text: string; ariaLabel?: string; sectionHeading?: string };
  decoded?: { kind: string; protocol?: string; commands?: string[] };
}): Promise<UserIntent> {
  const fallback = () => inferIntentRegex(args.snapshot, args.clickContext);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), INFER_TIMEOUT_MS);
    try {
      const res = await fetch(INFER_INTENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": JUDGE_API_KEY },
        body: JSON.stringify({
          origin: args.origin,
          pageTitle: args.snapshot.title,
          ogTitle: args.snapshot.ogTitle,
          ogSiteName: args.snapshot.ogSiteName,
          clickContext: args.clickContext,
          actionContext: args.snapshot.actionContext,
          decoded: args.decoded,
        }),
        signal: ac.signal,
      });
      if (!res.ok) return fallback();
      return (await res.json()) as UserIntent;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fallback();
  }
}

type OriginVerdictArg = ReturnType<typeof classifyOrigin>;

function deterministicFindings(input: {
  decoded: JudgeInput["decoded"];
  contract: ContractMeta;
  intent: UserIntent;
  from?: string;
  originVerdict?: OriginVerdictArg;
}): Finding[] {
  const out: Finding[] = [];

  // Origin trust — strongest deterministic signal for phishing.
  if (input.originVerdict) {
    if (input.originVerdict.kind === "punycode") {
      out.push({
        code: "PUNYCODE_DOMAIN",
        severity: "danger",
        text: `Page hostname (${input.originVerdict.hostname}) uses punycode encoding — common in lookalike-domain phishing.`,
      });
    } else if (input.originVerdict.kind === "lookalike") {
      out.push({
        code: "LOOKALIKE_DOMAIN",
        severity: "danger",
        text: `Page domain "${input.originVerdict.suspectDomain}" looks suspiciously similar to ${input.originVerdict.suspectedTarget.name} (${input.originVerdict.suspectedTarget.domains[0]}). Likely phishing.`,
      });
    }
    // "trusted" and "unknown" don't emit a finding here; the verdict checklist
    // will surface them as informational rows.
  }

  if (input.decoded.kind === "approve" && input.decoded.isUnlimited) {
    out.push({ code: "UNLIMITED_APPROVAL", severity: "danger", text: `Unlimited approval to ${input.decoded.spender}` });
  }
  if (input.decoded.kind === "setApprovalForAll" && input.decoded.approved) {
    out.push({ code: "SET_APPROVAL_FOR_ALL", severity: "danger", text: `setApprovalForAll on ${input.decoded.collection}` });
  }
  // Suppress "unverified" warning when:
  //   (a) we recognize the address from the bundled protocol registry, OR
  //   (b) the decoder confidently identified the target as a known router shape.
  // Sourcify coverage is uneven across chains/contracts; relying on it alone
  // would flag well-known Uniswap routers as suspicious.
  const trustedByRegistry = input.contract.knownProtocol !== undefined;
  const trustedByDecoder = input.decoded.kind === "swap" && input.decoded.trusted === true;
  if (!input.contract.verified && !trustedByRegistry && !trustedByDecoder) {
    out.push({ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "Target contract is not verified on Sourcify." });
  }
  if (input.intent.kind === "mint" && input.decoded.kind === "approve") {
    out.push({ code: "INTENT_MISMATCH_MINT_VS_APPROVE", severity: "danger", text: "Page looks like a mint but tx is an approval." });
  }
  // Swap proceeds going to a third party — high-signal phishing indicator.
  // Skip when the decoder already classified the recipient as wallet/router_self
  // (UR sentinels 0x...0001/0x...0002), or when recipient resolves to the sender.
  if (input.decoded.kind === "swap" && input.from) {
    const sender = input.from.toLowerCase();
    // Recipient/router are required by the swap variant, but defend against a
    // bad serialization round-trip (chrome.storage.session) producing undefined.
    const recipient = typeof input.decoded.recipient === "string" ? input.decoded.recipient.toLowerCase() : "";
    const routerAddr = typeof input.decoded.router === "string" ? input.decoded.router.toLowerCase() : "";
    const isProtocolSentinel = input.decoded.recipientKind === "wallet" || input.decoded.recipientKind === "router_self";
    const isRouterAddr = recipient !== "" && recipient === routerAddr;
    if (recipient !== "" && !isProtocolSentinel && !isRouterAddr && recipient !== sender) {
      out.push({ code: "SWAP_RECIPIENT_MISMATCH", severity: "warn", text: `Swap proceeds go to ${input.decoded.recipient}, not your wallet.` });
    }
  }

  // ---- Signature-based drainer findings (M3a) ----

  // ERC-2612 Permit: if spender isn't a known protocol address, that's a drainer
  // pattern — legitimate Permits target Uniswap routers, Permit2, etc.
  if (input.decoded.kind === "permit") {
    const spenderInfo = lookupProtocol(input.contract.chainId, input.decoded.spender);
    const unlimited = isUnlimitedAmount(input.decoded.amount);
    if (!spenderInfo) {
      out.push({
        code: "PERMIT_TO_UNVERIFIED_SPENDER",
        severity: "danger",
        text: `Permit signature would let ${input.decoded.spender} spend ${unlimited ? "unlimited " : ""}tokens — spender is not a known protocol.`,
      });
    } else if (unlimited) {
      out.push({
        code: "PERMIT_UNLIMITED_AMOUNT",
        severity: "warn",
        text: `Permit grants unlimited spending to ${spenderInfo.name}.`,
      });
    }
  }

  // Permit2 transfer-from: batch transfers to an unknown spender = classic
  // drainer payload. Multiple tokens compound the danger.
  if (input.decoded.kind === "permit2Transfer") {
    const spenderInfo = lookupProtocol(input.contract.chainId, input.decoded.spender);
    const tokenCount = input.decoded.permitted.length;
    if (!spenderInfo) {
      out.push({
        code: "PERMIT2_SPENDER_UNKNOWN",
        severity: "danger",
        text: `Permit2 signature authorizes ${input.decoded.spender} to move ${tokenCount} token${tokenCount === 1 ? "" : "s"} — spender is not a recognized protocol.`,
      });
    }
    if (tokenCount > 1 && !spenderInfo) {
      out.push({
        code: "PERMIT2_BATCH_TRANSFER",
        severity: "danger",
        text: `Batch transfer authorization for ${tokenCount} tokens at once — drainers commonly bundle approvals.`,
      });
    }
  }

  // Seaport order: zero-priced offers (selling assets for nothing) are a known
  // pattern in NFT compromise scams.
  if (input.decoded.kind === "seaportOrder") {
    const zeroPrice = input.decoded.consideration.length === 0
      || input.decoded.consideration.every((c) => c.amount === "0");
    if (zeroPrice && input.decoded.offer.length > 0) {
      out.push({
        code: "SEAPORT_ZERO_PRICE_OFFER",
        severity: "danger",
        text: `Seaport order offers your assets for ${input.decoded.consideration.length === 0 ? "no" : "zero"} consideration — equivalent to giving them away.`,
      });
    }
  }

  return out;
}

async function loadTenderlySettings(): Promise<{ key: string; account: string; project: string } | null> {
  const r = await chrome.storage.local.get(["tenderly_key", "tenderly_account", "tenderly_project"]);
  const key = r.tenderly_key ?? TENDERLY_ACCESS_KEY;
  const account = r.tenderly_account ?? TENDERLY_ACCOUNT_SLUG;
  const project = r.tenderly_project ?? TENDERLY_PROJECT_SLUG;
  if (!key || !account || !project) return null;
  return { key, account, project };
}

function computeNetEffect(sim: SimResult, wallet: string): { wallet: string; deltas: NetDelta[] } {
  const w = wallet.toLowerCase();
  // Map keyed by `${chainId}:${token}` so we accumulate per-asset deltas correctly.
  const acc = new Map<string, NetDelta>();
  for (const c of sim.assetChanges) {
    // Tenderly returns `from`/`to` as null for native-currency mints/burns and
    // some bridge events. Guard so the .toLowerCase() doesn't blow up the
    // entire flow on a single malformed asset_change row.
    const cTo = typeof c.to === "string" ? c.to.toLowerCase() : "";
    const cFrom = typeof c.from === "string" ? c.from.toLowerCase() : "";
    const direction = cTo === w ? 1 : cFrom === w ? -1 : 0;
    if (direction === 0) continue;
    const tokenAddr = c.token?.address;
    if (typeof tokenAddr !== "string") continue;
    const key = `${c.token.chainId}:${tokenAddr.toLowerCase()}`;
    const prev = acc.get(key);
    const signed = (BigInt(c.token.amount) * BigInt(direction));
    if (prev) {
      prev.amount = (BigInt(prev.amount) + signed).toString();
    } else {
      acc.set(key, {
        chainId: c.token.chainId,
        token: c.token.address,
        symbol: c.token.symbol,
        decimals: c.token.decimals,
        amount: signed.toString(),
      });
    }
  }
  // Drop net-zero entries (e.g. transfers that pass through the wallet).
  const deltas = Array.from(acc.values()).filter((d) => d.amount !== "0");
  return { wallet, deltas };
}

async function maybeSimulate(chainId: number, tx: { from: string; to: string; value?: string; data?: string }): Promise<SimResult | undefined> {
  const t = await loadTenderlySettings();
  if (!t) return undefined;
  const network_id = CHAIN_ID_TO_NETWORK_ID[chainId];
  if (!network_id) return undefined;
  try {
    return await simulate({
      accessKey: t.key, accountSlug: t.account, projectSlug: t.project,
      network_id, from: tx.from, to: tx.to, input: tx.data ?? "0x", value: tx.value ?? "0x0",
    });
  } catch {
    return undefined;
  }
}

// gpt-5.5 with reasoning typically takes 10-15s; allow generous headroom.
const JUDGE_TIMEOUT_MS = 45_000;

async function callJudge(input: JudgeInput): Promise<JudgeVerdict> {
  // AbortController prevents a hanging fetch from leaving the popup stuck on
  // "Asking the agent…" forever. 30s is generous for any LLM round-trip we'd
  // accept; anything slower is effectively a failure for an interactive flow.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await fetch(JUDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": JUDGE_API_KEY },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`judge ${res.status}${detail ? ` · ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as JudgeVerdict;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`judge timeout after ${JUDGE_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender) => {
  (async () => {
    if (msg.kind === "judge_request") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const { request, origin, chainIdHex, clickContext, pageSnapshot } = msg.payload;

      // Resolve {chainId, target address, decoded action} based on the wallet method.
      // For eth_sendTransaction the target is tx.to; for typed-data signatures it
      // is the EIP-712 verifying contract. personal_sign has no on-chain target.
      let chainId: number;
      let targetAddr: string | undefined;
      let decoded: JudgeInput["decoded"];

      if (request.method === "eth_sendTransaction") {
        const tx = request.params[0];
        chainId = parseInt(chainIdHex ?? tx.chainId ?? "0x2105", 16);
        targetAddr = tx.to;
        decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0", from: tx.from });
      } else if (request.method === "eth_signTypedData_v4") {
        // params: [from, typedData JSON or object]
        const env = parseTypedData(request.params[1]);
        chainId = env?.domain?.chainId
          ? (typeof env.domain.chainId === "number" ? env.domain.chainId : parseInt(String(env.domain.chainId), env.domain.chainId.toString().startsWith("0x") ? 16 : 10))
          : parseInt(chainIdHex ?? "0x1", 16);
        targetAddr = env?.domain?.verifyingContract;
        const td = decodeTypedData(request.params[1]);
        decoded = td ?? { kind: "unknown", selector: "0x712" };
      } else if (request.method === "personal_sign") {
        // No on-chain target; classify as a generic sign for the LLM to read.
        chainId = parseInt(chainIdHex ?? "0x1", 16);
        targetAddr = undefined;
        decoded = { kind: "unknown", selector: "0xpersonal_sign" };
      } else {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: `method not supported: ${request.method}` } as BackgroundToContent);
        return;
      }

      // Trust + verification lookups apply to whichever address we resolved.
      const v = targetAddr ? await fetchVerifiedContract({ chainId, address: targetAddr }) : { verified: false, abi: [] as any[] };
      const known = targetAddr ? lookupProtocol(chainId, targetAddr) : null;

      const intent = await inferIntent({
        snapshot: pageSnapshot,
        origin,
        clickContext: clickContext ? { text: clickContext.text, ariaLabel: clickContext.ariaLabel, sectionHeading: clickContext.sectionHeading } : undefined,
        decoded: decoded.kind === "swap"
          ? { kind: "swap", protocol: decoded.protocol, commands: decoded.commands }
          : { kind: decoded.kind },
      });
      const contract: ContractMeta = {
        address: targetAddr ?? "0x0000000000000000000000000000000000000000",
        chainId,
        verified: v.verified,
        sourceProvider: v.verified ? "sourcify" : undefined,
        matchType: v.matchType,
        contractName: known?.name ?? v.contractName,
        isProxy: false,
        knownProtocol: known ? { protocol: known.protocol, name: known.name, kind: known.kind } : undefined,
      };

      const clickCtx = clickContext ? { text: clickContext.text, ariaLabel: clickContext.ariaLabel, sectionHeading: clickContext.sectionHeading } : undefined;
      await setState(msg.id, { phase: "awaiting_confirm", tabId, baseDraft: { request, origin, pageSnapshot, clickContext: clickCtx, chainId, decoded, contract, intent } });
      await chrome.action.openPopup().catch(() => {});
      return;
    }

    if (msg.kind === "user_intent_confirmed") {
      const s = await getState(msg.id);
      // Allow re-entry from awaiting_confirm OR from a prior error (retry).
      const draft = s?.phase === "awaiting_confirm" ? s.baseDraft
        : s?.phase === "error" && s.retryDraft ? s.retryDraft
        : null;
      const tabId = s?.tabId;
      if (!draft || tabId === undefined) return;
      // Tenderly only meaningful for eth_sendTransaction; signature requests
      // have nothing to simulate (no on-chain effect at sign time).
      const tx = draft.request.method === "eth_sendTransaction" ? draft.request.params[0] : null;

      // The first three steps (decoding/registry/sourcify) already ran in the
      // awaiting_confirm handler — surface them as 'done' so the user sees the
      // full pipeline, not just what's running right now.
      // Each step has an outcome tone separate from its lifecycle status: a
      // "done" step with a negative result (e.g., Sourcify says "not verified")
      // renders amber instead of green, so the UI matches the actual signal.
      let decodingDetail: string;
      let decodingTone: JudgingStep["tone"];
      if (draft.decoded.kind === "swap" && draft.decoded.commands?.length) {
        decodingDetail = `${draft.decoded.protocol} · ${draft.decoded.commands.join(" → ")}`;
        decodingTone = "ok";
      } else if (draft.decoded.kind === "unknown") {
        decodingDetail = `Unknown · selector ${draft.decoded.selector}`;
        decodingTone = "warn";
      } else {
        decodingDetail = draft.decoded.kind;
        decodingTone = "ok";
      }

      const registryDetail = draft.contract.knownProtocol
        ? `Trusted ${draft.contract.knownProtocol.protocol} · ${draft.contract.knownProtocol.name}`
        : "Not in registry";
      const registryTone: JudgingStep["tone"] = draft.contract.knownProtocol ? "ok" : "warn";

      let sourcifyDetail: string;
      let sourcifyTone: JudgingStep["tone"];
      if (draft.contract.verified && draft.contract.matchType === "perfect") {
        sourcifyDetail = "Perfect match";
        sourcifyTone = "ok";
      } else if (draft.contract.verified && draft.contract.matchType === "partial") {
        sourcifyDetail = "Partial match";
        sourcifyTone = "warn";
      } else {
        sourcifyDetail = "Not verified";
        sourcifyTone = "warn";
      }

      // Step 4: Tenderly simulation.
      await setState(msg.id, {
        phase: "judging", tabId,
        origin: draft.origin, intent: msg.intent, decoded: draft.decoded, contract: draft.contract,
        steps: makeSteps({
          decoding: { status: "done", tone: decodingTone, detail: decodingDetail },
          registry: { status: "done", tone: registryTone, detail: registryDetail },
          sourcify: { status: "done", tone: sourcifyTone, detail: sourcifyDetail },
          simulating: { status: "running" },
        }),
        enteredAt: Date.now(),
      });
      const sim = tx ? await maybeSimulate(draft.chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data }) : undefined;

      let simStatus: JudgingStep["status"];
      let simTone: JudgingStep["tone"];
      let simDetail: string;
      if (!tx) {
        simStatus = "skipped"; simTone = undefined; simDetail = "Not applicable (signature request)";
      } else if (!sim) {
        simStatus = "skipped"; simTone = undefined; simDetail = "Skipped (Tenderly not configured)";
      } else if (!sim.success) {
        simStatus = "done"; simTone = "bad"; simDetail = `Failed${sim.failureReason ? ` · ${sim.failureReason}` : ""}`;
      } else {
        simStatus = "done"; simTone = "ok"; simDetail = `${sim.assetChanges.length} asset change${sim.assetChanges.length === 1 ? "" : "s"} · gas ${sim.gasUsed}`;
      }

      // Step 5: judge.
      await setState(msg.id, {
        phase: "judging", tabId,
        origin: draft.origin, intent: msg.intent, decoded: draft.decoded, contract: draft.contract,
        steps: makeSteps({
          decoding: { status: "done", tone: decodingTone, detail: decodingDetail },
          registry: { status: "done", tone: registryTone, detail: registryDetail },
          sourcify: { status: "done", tone: sourcifyTone, detail: sourcifyDetail },
          simulating: { status: simStatus, tone: simTone, detail: simDetail },
          judging: { status: "running" },
        }),
        enteredAt: Date.now(),
      });

      // Origin trust signals — punycode, lookalike, or known-dApp match. Rolled
      // into both OriginSignals (for the LLM judge to read) and findings (for
      // the safety floor to enforce).
      const originVerdict = classifyOrigin(draft.pageSnapshot.url || draft.origin);
      const originSig: OriginSignals = {
        url: draft.pageSnapshot.url, origin: draft.origin,
        pageTitle: draft.pageSnapshot.title, ogTitle: draft.pageSnapshot.ogTitle, ogSiteName: draft.pageSnapshot.ogSiteName,
        visibleButtonText: draft.pageSnapshot.visibleButtonText,
        knownDappMatch: originVerdict.kind === "trusted"
          ? { name: originVerdict.match.name, expectedDomains: originVerdict.match.domains, matched: true }
          : undefined,
        punycode: originVerdict.kind === "punycode" ? true : undefined,
        lookalikeOf: originVerdict.kind === "lookalike" ? originVerdict.suspectedTarget.name : undefined,
      };

      const findings = deterministicFindings({
        decoded: draft.decoded,
        contract: draft.contract,
        intent: msg.intent,
        from: tx?.from,
        originVerdict,
      });
      const netEffect = sim && tx?.from ? computeNetEffect(sim, tx.from) : undefined;
      const judgeInput: JudgeInput = { intent: msg.intent, decoded: draft.decoded, sim, contract: draft.contract, origin: originSig, findings, request: draft.request, netEffect };
      try {
        const verdict = await callJudge(judgeInput);
        await setState(msg.id, { phase: "verdict_ready", tabId, request: draft.request, origin: draft.origin, pageSnapshot: draft.pageSnapshot, judgeInput, verdict });
      } catch (e) {
        const message = String((e as Error).message ?? e);
        // Persist retryDraft so the popup's "Retry" button can re-enter the flow
        // without making the user re-navigate the dApp.
        await setState(msg.id, {
          phase: "error", tabId, origin: draft.origin, message,
          retryDraft: { request: draft.request, origin: draft.origin, pageSnapshot: draft.pageSnapshot, clickContext: draft.clickContext, chainId: draft.chainId, decoded: draft.decoded, contract: draft.contract, intent: msg.intent },
        });
        // Best-effort notify the inpage that the request hasn't been answered yet.
        // The user can still hit Retry or Reject from the popup.
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message } as BackgroundToContent).catch(() => {});
      }
      return;
    }

    if (msg.kind === "user_decision") {
      const s = await getState(msg.id);
      if (!s || s.phase !== "verdict_ready") return;
      chrome.tabs.sendMessage(s.tabId, { kind: "judge_result", id: msg.id, verdict: s.verdict, userDecision: msg.decision } as BackgroundToContent);
      await clearState(msg.id);
      return;
    }
  })();
  return false;
});
