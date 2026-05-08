import { decode } from "@intent-check/decoder";
import type { JudgeInput, JudgeVerdict, WalletRequest, ContractMeta, OriginSignals, UserIntent } from "@intent-check/types";
import type { ContentToBackground, BackgroundToContent, PageSnapshot } from "./shared/messaging";
import { JUDGE_URL, JUDGE_API_KEY } from "./shared/config";

interface PendingItem {
  id: string;
  tabId: number;
  request: WalletRequest;
  origin: string;
  pageSnapshot: PageSnapshot;
  verdict: JudgeVerdict;
  decoded: JudgeInput["decoded"];
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
  if (/swap/.test(text))      return { kind: "swap",   summary: snapshot.title ?? "Swap on this dApp",      confidence: 0.6 };
  if (/approve/.test(text))   return { kind: "approve",summary: snapshot.title ?? "Approve token",          confidence: 0.5 };
  if (/mint/.test(text))      return { kind: "mint",   summary: snapshot.title ?? "Mint NFT",               confidence: 0.5 };
  if (/deposit|stake/.test(text)) return { kind: "deposit", summary: snapshot.title ?? "Deposit",           confidence: 0.5 };
  if (/bridge/.test(text))    return { kind: "bridge", summary: snapshot.title ?? "Bridge",                 confidence: 0.5 };
  return { kind: "other", summary: snapshot.title ?? "Unknown action", confidence: 0.2 };
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

chrome.runtime.onMessage.addListener((msg: ContentToBackground, sender, sendResponse) => {
  if (msg.kind !== "judge_request") return;
  (async () => {
    try {
      const tabId = sender.tab?.id;
      if (tabId === undefined) throw new Error("no tab id");
      const { request, origin, pageSnapshot } = msg.payload;

      // Only handle eth_sendTransaction in M1; signature paths land in M3.
      if (request.method !== "eth_sendTransaction") {
        const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: "method not supported in M1" };
        chrome.tabs.sendMessage(tabId, reply);
        return;
      }
      const tx = request.params[0];
      const chainIdHex = tx.chainId ?? "0x2105"; // default base
      const chainId = parseInt(chainIdHex, 16);

      const decoded = await decode({ chainId, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" });

      const intent = inferIntent(pageSnapshot);
      const contract: ContractMeta = { address: tx.to, chainId, verified: false, isProxy: false };
      const originSig: OriginSignals = { url: pageSnapshot.url, origin, pageTitle: pageSnapshot.title, ogTitle: pageSnapshot.ogTitle, ogSiteName: pageSnapshot.ogSiteName, visibleButtonText: pageSnapshot.visibleButtonText };

      const judgeInput: JudgeInput = { intent, decoded, contract, origin: originSig, findings: [], request };
      const verdict = await callJudge(judgeInput);

      await setPending({ id: msg.id, tabId, request, origin, pageSnapshot, verdict, decoded });
      await chrome.action.openPopup().catch(() => { /* user gesture required; popup will be opened by user clicking the action */ });
    } catch (e) {
      const tabId = sender.tab?.id;
      const reply: BackgroundToContent = { kind: "judge_error", id: msg.id, message: String((e as Error).message ?? e) };
      if (tabId !== undefined) chrome.tabs.sendMessage(tabId, reply);
    }
  })();
  return false;
});

// Popup → background: user decision.
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
