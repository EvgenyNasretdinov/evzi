import { useEffect, useState, useCallback } from "react";
import { PopupView, type PopupState } from "./PopupView";

export function App() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<PopupState | null>(null);

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

  return (
    <PopupView
      id={id}
      state={state}
      onIntentConfirm={(requestId, intent) =>
        void chrome.runtime.sendMessage({ kind: "user_intent_confirmed", id: requestId, intent })
      }
      onReject={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "reject" })}
      onApprove={(requestId) => void chrome.runtime.sendMessage({ kind: "user_decision", id: requestId, decision: "approve" })}
    />
  );
}
