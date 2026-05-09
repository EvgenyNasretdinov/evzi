import type { EvziEyeStatus } from "@/popup/components/EvziEyeLogo";
import type { JudgeInput, JudgeVerdict, VerdictTier } from "@intent-check/types";

/** Shown under API-only reason lines until a dedicated subtitle exists on `JudgeVerdict.reasons`. */
export const CHECKLIST_SUBTITLE_FALLBACK = "Supporting detail for this check.";

export type VerdictCheckSeverity = "pass" | "caution" | "fail";

export interface VerdictChecklistRow {
  severity: VerdictCheckSeverity;
  title: string;
  description: string;
}

export interface VerdictScreenCopy {
  title: string;
  description: string;
  checklist: VerdictChecklistRow[];
  primaryLabel: string;
  secondaryLabel: string;
}

const SAFE: VerdictScreenCopy = {
  title: "All looks good...",
  description: "Seems like the website is secured and the action you do is valued.",
  checklist: [
    {
      severity: "pass",
      title: "Target contract is verified on Sourcify.",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "pass",
      title: "Success! Your changes have been saved",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "pass",
      title: "Success! Your changes have been saved",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "pass",
      title: "Success! Your changes have been saved",
      description: "This is an alert with icon, title and description.",
    },
  ],
  primaryLabel: "Continue signing",
  secondaryLabel: "Reject transaction",
};

const CAUTION: VerdictScreenCopy = {
  title: "Kinda suspicious....",
  description: "Seems like the website is secured and the action you do is valued.",
  checklist: [
    {
      severity: "pass",
      title: "Target contract is not verified on Sourcify.",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "pass",
      title: "Success! Your changes have been saved",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "fail",
      title: "Target contract is not verified on Sourcify.",
      description: "Please verify your billing information in order to proceed.",
    },
  ],
  primaryLabel: "Continue signing",
  secondaryLabel: "Reject transaction",
};

const DANGER: VerdictScreenCopy = {
  title: "Wow... Better not.",
  description: "Make changes to your profile here. Click save when you're done.",
  checklist: [
    {
      severity: "pass",
      title: "Success! Your changes have been saved",
      description: "This is an alert with icon, title and description.",
    },
    {
      severity: "fail",
      title: "Target contract is not verified on Sourcify.",
      description: "Please verify your billing information in order to proceed.",
    },
    {
      severity: "fail",
      title: "Target contract is not verified on Sourcify.",
      description: "Please verify your billing information in order to proceed.",
    },
    {
      severity: "fail",
      title: "Target contract is not verified on Sourcify.",
      description: "Please verify your billing information in order to proceed.",
    },
  ],
  primaryLabel: "Reject transaction",
  secondaryLabel: "Continue anyway",
};

export const VERDICT_COPY: Record<VerdictTier, VerdictScreenCopy> = {
  SAFE: SAFE,
  CAUTION: CAUTION,
  DANGER: DANGER,
};

export function tierToEyeStatus(tier: VerdictTier): EvziEyeStatus {
  if (tier === "SAFE") return "green";
  if (tier === "CAUTION") return "yellow";
  return "red";
}

function severityFromReason(s: JudgeVerdict["reasons"][number]["severity"]): VerdictCheckSeverity {
  if (s === "info") return "pass";
  if (s === "warn") return "caution";
  return "fail";
}

/** Prefer live reasons when present; otherwise use static tier copy (Figma placeholders). */
export function resolveVerdictChecklist(verdict: JudgeVerdict): VerdictChecklistRow[] {
  if (verdict.reasons.length > 0) {
    return verdict.reasons.map((r) => ({
      severity: severityFromReason(r.severity),
      title: r.text,
      description: "",
    }));
  }
  return VERDICT_COPY[verdict.tier].checklist;
}

export function buildVerdictScreenModel(verdict: JudgeVerdict): {
  eyeStatus: EvziEyeStatus;
  title: string;
  description: string;
  checklist: VerdictChecklistRow[];
  primaryLabel: string;
  secondaryLabel: string;
} {
  const copy = VERDICT_COPY[verdict.tier];
  return {
    eyeStatus: tierToEyeStatus(verdict.tier),
    title: copy.title,
    description: verdict.headline ? `${copy.description}\n\n${verdict.headline}` : copy.description,
    checklist: resolveVerdictChecklist(verdict),
    primaryLabel: copy.primaryLabel,
    secondaryLabel: copy.secondaryLabel,
  };
}

export function formatJudgeInputRaw(judgeInput: JudgeInput, origin: string): string {
  return JSON.stringify(
    {
      origin,
      decoded: judgeInput.decoded,
      sim: judgeInput.sim,
      contract: judgeInput.contract,
      findings: judgeInput.findings,
    },
    null,
    2
  );
}
