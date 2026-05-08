import { decode } from "@intent-check/decoder";
import { fetchVerifiedContract } from "@intent-check/sourcify-client";
import { simulate } from "@intent-check/tenderly-client";
import type { JudgeInput, JudgeVerdict, WalletRequest, ContractMeta, OriginSignals, UserIntent, Finding, SimResult } from "@intent-check/types";
import type { ContentToBackground, BackgroundToContent, PageSnapshot } from "./shared/messaging";
import {
  JUDGE_URL, JUDGE_API_KEY,
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
        chainId: number;
        decoded: JudgeInput["decoded"];
        contract: ContractMeta;
        intent: UserIntent;
      };
    }
  | {
      phase: "verdict_ready";
      tabId: number;
      request: WalletRequest;
      origin: string;
      pageSnapshot: PageSnapshot;
      judgeInput: JudgeInput;
      verdict: JudgeVerdict;
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

function inferIntent(snapshot: PageSnapshot): UserIntent {
  const text = [snapshot.title, snapshot.ogTitle, snapshot.ogSiteName, snapshot.visibleButtonText].filter(Boolean).join(" | ").toLowerCase();
  if (/swap/.test(text))           return { kind: "swap",    summary: snapshot.title ?? "Swap on this dApp",    confidence: 0.6 };
  if (/approve/.test(text))        return { kind: "approve", summary: snapshot.title ?? "Approve token",        confidence: 0.5 };
  if (/mint/.test(text))           return { kind: "mint",    summary: snapshot.title ?? "Mint NFT",             confidence: 0.5 };
  if (/deposit|stake/.test(text))  return { kind: "deposit", summary: snapshot.title ?? "Deposit",              confidence: 0.5 };
  if (/bridge/.test(text))         return { kind: "bridge",  summary: snapshot.title ?? "Bridge",               confidence: 0.5 };
  return { kind: "other", summary: snapshot.title ?? "Unknown action", confidence: 0.2 };
}

function deterministicFindings(input: { decoded: JudgeInput["decoded"]; contract: ContractMeta; intent: UserIntent }): Finding[] {
  const out: Finding[] = [];
  if (input.decoded.kind === "approve" && input.decoded.isUnlimited) {
    out.push({ code: "UNLIMITED_APPROVAL", severity: "danger", text: `Unlimited approval to ${input.decoded.spender}` });
  }
  if (input.decoded.kind === "setApprovalForAll" && input.decoded.approved) {
    out.push({ code: "SET_APPROVAL_FOR_ALL", severity: "danger", text: `setApprovalForAll on ${input.decoded.collection}` });
  }
  if (!input.contract.verified) {
    out.push({ code: "UNVERIFIED_CONTRACT", severity: "warn", text: "Target contract is not verified on Sourcify." });
  }
  if (input.intent.kind === "mint" && input.decoded.kind === "approve") {
    out.push({ code: "INTENT_MISMATCH_MINT_VS_APPROVE", severity: "danger", text: "Page looks like a mint but tx is an approval." });
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

async function callJudge(input: JudgeInput): Promise<JudgeVerdict> {
  const res = await fetch(JUDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": JUDGE_API_KEY },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`judge ${res.status}`);
  return (await res.json()) as JudgeVerdict;
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender) => {
  (async () => {
    if (msg.kind === "judge_request") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const { request, origin, pageSnapshot } = msg.payload;

      if (request.method !== "eth_sendTransaction") {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: "method not supported in M2" } as BackgroundToContent);
        return;
      }
      const tx = request.params[0];
      const chainId = parseInt(tx.chainId ?? "0x2105", 16);
      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });
      const v = await fetchVerifiedContract({ chainId, address: tx.to });
      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = { address: tx.to, chainId, verified: v.verified, sourceProvider: v.verified ? "sourcify" : undefined, contractName: v.contractName, isProxy: false };

      await setState(msg.id, { phase: "awaiting_confirm", tabId, baseDraft: { request, origin, pageSnapshot, chainId, decoded, contract, intent } });
      await chrome.action.openPopup().catch(() => {});
      return;
    }

    if (msg.kind === "user_intent_confirmed") {
      const s = await getState(msg.id);
      if (!s || s.phase !== "awaiting_confirm") return;
      const { baseDraft, tabId } = s;
      const tx = baseDraft.request.method === "eth_sendTransaction" ? baseDraft.request.params[0] : null;
      if (!tx) return;

      const sim = await maybeSimulate(baseDraft.chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data });
      const findings = deterministicFindings({ decoded: baseDraft.decoded, contract: baseDraft.contract, intent: msg.intent });
      const originSig: OriginSignals = {
        url: baseDraft.pageSnapshot.url, origin: baseDraft.origin,
        pageTitle: baseDraft.pageSnapshot.title, ogTitle: baseDraft.pageSnapshot.ogTitle, ogSiteName: baseDraft.pageSnapshot.ogSiteName,
        visibleButtonText: baseDraft.pageSnapshot.visibleButtonText,
      };
      const judgeInput: JudgeInput = { intent: msg.intent, decoded: baseDraft.decoded, sim, contract: baseDraft.contract, origin: originSig, findings, request: baseDraft.request };
      try {
        const verdict = await callJudge(judgeInput);
        await setState(msg.id, { phase: "verdict_ready", tabId, request: baseDraft.request, origin: baseDraft.origin, pageSnapshot: baseDraft.pageSnapshot, judgeInput, verdict });
      } catch (e) {
        chrome.tabs.sendMessage(tabId, { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) } as BackgroundToContent);
        await clearState(msg.id);
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
