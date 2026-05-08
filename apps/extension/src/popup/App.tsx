import { useEffect, useState, useCallback } from "react";
import { VerdictChip } from "./components/VerdictChip";
import { IntentConfirm } from "./components/IntentConfirm";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput } from "@intent-check/types";

interface AwaitingConfirm { phase: "awaiting_confirm"; baseDraft: { decoded: DecodedAction; intent: UserIntent; pageSnapshot: { title?: string }; origin: string }; }
interface VerdictReady   { phase: "verdict_ready"; verdict: JudgeVerdict; judgeInput: JudgeInput; origin: string; pageSnapshot: { title?: string }; }
type State = AwaitingConfirm | VerdictReady;

export function App() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);

  const refresh = useCallback(async () => {
    const r = await chrome.storage.session.get(["lastPendingId"]);
    const newId = r.lastPendingId as string | undefined;
    if (!newId) return;
    setId(newId);
    const r2 = await chrome.storage.session.get([`pending:${newId}`]);
    setState(r2[`pending:${newId}`] ?? null);
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 500); return () => clearInterval(i); }, [refresh]);

  if (!state || !id) return <div style={{ width: 320, padding: 12, fontFamily: "system-ui" }}><h3>Intent Check</h3><p>No active request.</p></div>;

  if (state.phase === "awaiting_confirm") {
    return (
      <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <p style={{ fontSize: 12, color: "#555" }}>{state.baseDraft.origin}</p>
        <IntentConfirm
          initial={state.baseDraft.intent}
          onConfirm={(intent) => chrome.runtime.sendMessage({ kind: "user_intent_confirmed", id, intent })}
        />
      </div>
    );
  }

  return (
    <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <VerdictChip tier={state.verdict.tier} />
      </div>
      <p style={{ marginTop: 8 }}>{state.verdict.headline}</p>
      <ul style={{ paddingLeft: 18, fontSize: 12 }}>
        {state.verdict.reasons.map((r, i) => <li key={i} style={{ color: r.severity === "danger" ? "#cf222e" : r.severity === "warn" ? "#9a6700" : "#444" }}>{r.text}</li>)}
      </ul>
      <details>
        <summary>Details</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(state.judgeInput.decoded, null, 2)}</pre>
        {state.judgeInput.sim && <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(state.judgeInput.sim.assetChanges, null, 2)}</pre>}
        <p style={{ fontSize: 11, color: "#555" }}>Origin: {state.origin}</p>
      </details>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => chrome.runtime.sendMessage({ kind: "user_decision", id, decision: "reject" })} style={{ flex: 1 }}>Reject</button>
        <button onClick={() => chrome.runtime.sendMessage({ kind: "user_decision", id, decision: "approve" })} style={{ flex: 1, background: "#1a7f37", color: "white" }} disabled={state.verdict.tier === "DANGER"}>
          {state.verdict.tier === "DANGER" ? "Blocked" : "Sign"}
        </button>
      </div>
    </div>
  );
}
