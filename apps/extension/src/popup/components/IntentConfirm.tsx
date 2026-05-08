import { useState } from "react";
import type { UserIntent } from "@intent-check/types";

const KINDS: UserIntent["kind"][] = ["swap", "approve", "deposit", "mint", "bridge", "transfer", "sign", "other"];

export function IntentConfirm({ initial, onConfirm }: { initial: UserIntent; onConfirm: (i: UserIntent) => void }) {
  const [kind, setKind] = useState(initial.kind);
  const [summary, setSummary] = useState(initial.summary);
  return (
    <div>
      <h4 style={{ margin: "8px 0" }}>Looks like you're trying to:</h4>
      <select value={kind} onChange={(e) => setKind(e.target.value as UserIntent["kind"])}>
        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input style={{ width: "100%", marginTop: 8 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <button style={{ marginTop: 8, width: "100%" }} onClick={() => onConfirm({ ...initial, kind, summary, confidence: 1 })}>
        That's right — check it
      </button>
    </div>
  );
}
