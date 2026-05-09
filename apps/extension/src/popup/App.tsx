import { useEffect, useState, useCallback } from "react";
import { PopupView, type PopupState, type JudgeInfo } from "./PopupView";
import { JUDGE_INFO_URL } from "../shared/config";

export function App() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<PopupState | null>(null);
  const [judgeInfo, setJudgeInfo] = useState<JudgeInfo | null>(null);

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
    const i = setInterval(refresh, 500);
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

  return (
    <PopupView
      id={id}
      state={state}
      judgeInfo={judgeInfo}
      onIntentConfirm={(requestId, intent) =>
        void chrome.runtime.sendMessage({ kind: "user_intent_confirmed", id: requestId, intent })
      }
      onReject={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "reject" })}
      onApprove={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "approve" })}
    />
  );
}
