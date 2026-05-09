import type { VerdictTier } from "@intent-check/types";
import { cn } from "@/lib/utils";

const tierClass: Record<VerdictTier, string> = {
  SAFE: "bg-emerald-600 text-white",
  CAUTION: "bg-amber-600 text-white",
  DANGER: "bg-destructive text-destructive-foreground",
};

export function VerdictChip({ tier }: { tier: VerdictTier }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        tierClass[tier]
      )}
    >
      {tier}
    </span>
  );
}
