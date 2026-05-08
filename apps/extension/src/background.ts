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

interface PendingItem {
  id: string;
  tabId: number;
  request: WalletRequest;
  origin: string;
  pageSnapshot: PageSnapshot;
  judgeInput: JudgeInput;
  verdict: JudgeVerdict;
}

async function setPending(item: PendingItem) {
  await chrome.storage.session.set({ [`pending:${item.id}`]: item, lastPendingId: item.id });
}
async function getPending(id: string): Promise<PendingItem | undefined> {
  const r = await chrome.storage.session.get([`pending:${id}`]);
  return r[`pending:${id}`];
}
async function clearPending(id: string) {
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
  if (msg.kind !== "judge_request") return;
  (async () => {
    const tabId = sender.tab?.id;
    try {
      if (tabId === undefined) throw new Error("no tab id");
      const { request, origin, pageSnapshot } = msg.payload;

      if (request.method !== "eth_sendTransaction") {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: "method not supported in M2" };
        chrome.tabs.sendMessage(tabId, reply);
        return;
      }
      const tx = request.params[0];
      const chainIdHex = tx.chainId ?? "0x2105";
      const chainId = parseInt(chainIdHex, 16);

      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });
      const verifiedContract = await fetchVerifiedContract({ chainId, address: tx.to });
      const sim = await maybeSimulate(chainId, { from: tx.from, to: tx.to, value: tx.value, data: tx.data });

      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = {
        address: tx.to, chainId,
        verified: verifiedContract.verified,
        sourceProvider: verifiedContract.verified ? "sourcify" : undefined,
        contractName: verifiedContract.contractName,
        isProxy: false,
      };
      const originSig: OriginSignals = {
        url: pageSnapshot.url, origin,
        pageTitle: pageSnapshot.title, ogTitle: pageSnapshot.ogTitle, ogSiteName: pageSnapshot.ogSiteName,
        visibleButtonText: pageSnapshot.visibleButtonText,
      };
      const findings = deterministicFindings({ decoded, contract, intent });
      const judgeInput: JudgeInput = { intent, decoded, sim, contract, origin: originSig, findings, request };

      const verdict = await callJudge(judgeInput);
      await setPending({ id: msg.id, tabId, request, origin, pageSnapshot, judgeInput, verdict });
      await chrome.action.openPopup().catch(() => {});
    } catch (e) {
      if (tabId !== undefined) {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) };
        chrome.tabs.sendMessage(tabId, reply);
      }
    }
  })();
  return false;
});

chrome.runtime.onMessage.addListener((msg: { kind: "user_decision"; id: string; decision: "approve" | "reject" }) => {
  if (msg.kind !== "user_decision") return;
  (async () => {
    const item = await getPending(msg.id);
    if (!item) return;
    const reply: BackgroundToContent = { kind: "judge_result", id: msg.id, verdict: item.verdict, userDecision: msg.decision };
    chrome.tabs.sendMessage(item.tabId, reply);
    await clearPending(msg.id);
  })();
  return false;
});
