import { decode } from "@intent-check/decoder";
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
      // Used by the popup spinner to show partial progress, e.g. "Simulating…".
      step: "fetching_simulation" | "calling_judge";
      // Wall-clock millisecond timestamp when this step entered. Popup uses it to
      // detect a stuck state (>60s) and offer a retry without waiting indefinitely.
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

function deterministicFindings(input: { decoded: JudgeInput["decoded"]; contract: ContractMeta; intent: UserIntent; from?: string }): Finding[] {
  const out: Finding[] = [];
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
    const recipient = input.decoded.recipient.toLowerCase();
    const isProtocolSentinel = input.decoded.recipientKind === "wallet" || input.decoded.recipientKind === "router_self";
    const isRouterAddr = recipient === input.decoded.router.toLowerCase();
    if (!isProtocolSentinel && !isRouterAddr && recipient !== sender) {
      out.push({ code: "SWAP_RECIPIENT_MISMATCH", severity: "warn", text: `Swap proceeds go to ${input.decoded.recipient}, not your wallet.` });
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
    const direction = c.to.toLowerCase() === w ? 1 : c.from.toLowerCase() === w ? -1 : 0;
    if (direction === 0) continue;
    const key = `${c.token.chainId}:${c.token.address.toLowerCase()}`;
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

const JUDGE_TIMEOUT_MS = 30_000;

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

      if (request.method !== "eth_sendTransaction") {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: "method not supported in M2" } as BackgroundToContent);
        return;
      }
      const tx = request.params[0];
      // Prefer the wallet's reported chainId; fall back to tx.chainId; default Base.
      const chainId = parseInt(chainIdHex ?? tx.chainId ?? "0x2105", 16);
      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0", from: tx.from });
      const v = await fetchVerifiedContract({ chainId, address: tx.to });
      const known = lookupProtocol(chainId, tx.to);
      const intent = await inferIntent({
        snapshot: pageSnapshot,
        origin,
        clickContext: clickContext ? { text: clickContext.text, ariaLabel: clickContext.ariaLabel, sectionHeading: clickContext.sectionHeading } : undefined,
        decoded: decoded.kind === "swap"
          ? { kind: "swap", protocol: decoded.protocol, commands: decoded.commands }
          : { kind: decoded.kind },
      });
      const contract: ContractMeta = {
        address: tx.to,
        chainId,
        verified: v.verified,
        sourceProvider: v.verified ? "sourcify" : undefined,
        matchType: v.matchType,
        // Prefer the registry's specific name (e.g. "UniversalRouter v2") over Sourcify's
        // generic compilation target — registry is hand-curated and more accurate when both exist.
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
      const tx = draft.request.method === "eth_sendTransaction" ? draft.request.params[0] : null;
      if (!tx) return;

      // Step 1: Tenderly simulation. Show progress so the popup can spin.
      await setState(msg.id, {
        phase: "judging", tabId,
        origin: draft.origin, intent: msg.intent, decoded: draft.decoded, contract: draft.contract,
        step: "fetching_simulation",
        enteredAt: Date.now(),
      });
      const sim = await maybeSimulate(draft.chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data });

      // Step 2: judge.
      await setState(msg.id, {
        phase: "judging", tabId,
        origin: draft.origin, intent: msg.intent, decoded: draft.decoded, contract: draft.contract,
        step: "calling_judge",
        enteredAt: Date.now(),
      });

      const findings = deterministicFindings({ decoded: draft.decoded, contract: draft.contract, intent: msg.intent, from: tx.from });
      const originSig: OriginSignals = {
        url: draft.pageSnapshot.url, origin: draft.origin,
        pageTitle: draft.pageSnapshot.title, ogTitle: draft.pageSnapshot.ogTitle, ogSiteName: draft.pageSnapshot.ogSiteName,
        visibleButtonText: draft.pageSnapshot.visibleButtonText,
      };
      const netEffect = sim && tx.from ? computeNetEffect(sim, tx.from) : undefined;
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
