import type { VerdictTier } from "@intent-check/types";

const colors: Record<VerdictTier, string> = {
  SAFE: "#1a7f37",
  CAUTION: "#9a6700",
  DANGER: "#cf222e",
};

export function VerdictChip({ tier }: { tier: VerdictTier }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      background: colors[tier], color: "white", fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
    }}>
      {tier}
    </span>
  );
}
