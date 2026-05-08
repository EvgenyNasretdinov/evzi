import { useEffect, useState } from "react";
import { VerdictChip } from "./components/VerdictChip";
import type { JudgeVerdict, DecodedAction } from "@intent-check/types";

interface PendingItem {
  id: string;
  verdict: JudgeVerdict;
  decoded: DecodedAction;
  origin: string;
  pageSnapshot: { title?: string };
}

export function App() {
  const [item, setItem] = useState<PendingItem | null>(null);

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.session.get(["lastPendingId"]);
      const id = r.lastPendingId as string | undefined;
      if (!id) return;
      const r2 = await chrome.storage.session.get([`pending:${id}`]);
      setItem(r2[`pending:${id}`] ?? null);
    })();
  }, []);

  async function decide(decision: "approve" | "reject") {
    if (!item) return;
    await chrome.runtime.sendMessage({ kind: "user_decision", id: item.id, decision });
    window.close();
  }

  if (!item) {
    return <div style={{ width: 320, padding: 12, fontFamily: "system-ui" }}><h3>Intent Check</h3><p>No active request.</p></div>;
  }

  return (
    <div style={{ width: 360, padding: 12, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Intent Check</h3>
        <VerdictChip tier={item.verdict.tier} />
      </div>
      <p style={{ marginTop: 8 }}>{item.verdict.headline}</p>
      <details>
        <summary>Details</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(item.decoded, null, 2)}</pre>
        <p style={{ fontSize: 11, color: "#555" }}>Origin: {item.origin}</p>
      </details>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => decide("reject")} style={{ flex: 1 }}>Reject</button>
        <button onClick={() => decide("approve")} style={{ flex: 1, background: "#1a7f37", color: "white" }}>Sign</button>
      </div>
    </div>
  );
}
