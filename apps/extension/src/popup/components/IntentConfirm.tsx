import { useState } from "react";
import type { UserIntent } from "@intent-check/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const KINDS: UserIntent["kind"][] = ["swap", "approve", "deposit", "mint", "bridge", "transfer", "sign", "other"];

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50"
);

export function IntentConfirm({ initial, onConfirm }: { initial: UserIntent; onConfirm: (i: UserIntent) => void }) {
  const [kind, setKind] = useState(initial.kind);
  const [summary, setSummary] = useState(initial.summary);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium leading-none">What you&apos;re doing</p>
        <p className="text-sm text-muted-foreground">Confirm so we can simulate and judge the transaction.</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="intent-kind" className="text-xs font-medium text-muted-foreground">
          Category
        </label>
        <select
          id="intent-kind"
          className={selectClassName}
          value={kind}
          onChange={(e) => setKind(e.target.value as UserIntent["kind"])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="intent-summary" className="text-xs font-medium text-muted-foreground">
          Short description
        </label>
        <Input id="intent-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Swap ETH → USDC on Uniswap" />
      </div>
      <Button className="w-full" onClick={() => onConfirm({ ...initial, kind, summary, confidence: 1 })}>
        That&apos;s right — check it
      </Button>
    </div>
  );
}
