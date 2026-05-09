import { useEffect, useState, useCallback } from "react";
import { PopupView, type PopupState, type JudgeInfo, type ChatContext } from "./PopupView";
import type { ChatMessage } from "./chat/types";
import type { ChatSendResponse } from "../shared/messaging";
import { JUDGE_INFO_URL } from "../shared/config";

export function App() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<PopupState | null>(null);
  const [judgeInfo, setJudgeInfo] = useState<JudgeInfo | null>(null);
  // tick forces a re-render every 500ms even if storage didn't change. The
  // judging-stuck guard in PopupView depends on Date.now() vs state.enteredAt;
  // without this tick a hung background would never trigger the guard.
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const r = await chrome.storage.session.get(["lastPendingId"]);
    const newId = r.lastPendingId as string | undefined;
    if (!newId) return;
    setId(newId);
    const r2 = await chrome.storage.session.get([`pending:${newId}`]);
    setState(r2[`pending:${newId}`] ?? null);
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(() => {
      refresh();
      setTick((t) => t + 1);
    }, 500);
    return () => clearInterval(i);
  }, [refresh]);

  // Fetch judge info once. Failure → leave null (footer hides).
  useEffect(() => {
    let cancelled = false;
    fetch(JUDGE_INFO_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => { if (!cancelled && info) setJudgeInfo(info as JudgeInfo); })
      .catch(() => { /* judge offline; keep footer hidden */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Chat dispatcher — bridges the in-popup ChatScreen to the background's
   * /chat fetch. Strips ChatMessage to the wire shape (drops id, createdAt)
   * since the LLM only cares about role+content.
   */
  const onChatSend = useCallback(async (messages: ChatMessage[], context?: ChatContext): Promise<string> => {
    const wire = messages.map((m) => ({ role: m.role, content: m.content }));
    const response = await chrome.runtime.sendMessage({
      kind: "chat_send",
      messages: wire,
      context,
    }) as ChatSendResponse;
    if (!response || !response.ok) {
      throw new Error(response?.error ?? "chat: no response");
    }
    return response.reply;
  }, []);

  return (
    <PopupView
      id={id}
      state={state}
      judgeInfo={judgeInfo}
      onChatSend={onChatSend}
      onIntentConfirm={(requestId, intent) =>
        void chrome.runtime.sendMessage({ kind: "user_intent_confirmed", id: requestId, intent })
      }
      onReject={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "reject" })}
      onApprove={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "approve" })}
    />
  );
}
