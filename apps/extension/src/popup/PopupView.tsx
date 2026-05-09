import { Shield } from "lucide-react";
import { VerdictChip } from "./components/VerdictChip";
import { IntentConfirm } from "./components/IntentConfirm";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput, ContractMeta, SimResult } from "@intent-check/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CheckTone = "ok" | "warn" | "bad" | "info";

interface CheckRow {
  label: string;
  detail: string;
  tone: CheckTone;
}

function toneClass(tone: CheckTone) {
  if (tone === "ok") return "text-emerald-700 dark:text-emerald-400";
  if (tone === "warn") return "text-amber-700 dark:text-amber-400";
  if (tone === "bad") return "text-destructive";
  return "text-muted-foreground";
}

function toneGlyph(tone: CheckTone) {
  if (tone === "ok") return "✓";
  if (tone === "warn") return "⚠";
  if (tone === "bad") return "✗";
  return "·";
}

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function buildChecks(input: JudgeInput): CheckRow[] {
  const rows: CheckRow[] = [];
  const d = input.decoded;
  const c = input.contract;
  const sim = input.sim;

  // Decoded as
  if (d.kind === "swap") {
    const cmds = d.commands && d.commands.length > 0 ? d.commands.join(" → ") : "swap";
    rows.push({ label: "Decoded as", detail: `${d.protocol} · ${cmds}`, tone: "ok" });
  } else if (d.kind === "approve") {
    rows.push({ label: "Decoded as", detail: `ERC-20 approve · ${d.isUnlimited ? "unlimited" : d.amount}`, tone: d.isUnlimited ? "bad" : "warn" });
  } else if (d.kind === "setApprovalForAll") {
    rows.push({ label: "Decoded as", detail: `setApprovalForAll · ${d.approved ? "granted" : "revoked"}`, tone: d.approved ? "bad" : "ok" });
  } else if (d.kind === "transfer") {
    rows.push({ label: "Decoded as", detail: `Transfer to ${shortAddr(d.to)}`, tone: "info" });
  } else {
    rows.push({ label: "Decoded as", detail: `Unknown · selector ${d.kind === "unknown" ? d.selector : "?"}`, tone: "warn" });
  }

  // Contract trust
  const trustedSwap = d.kind === "swap" && d.trusted === true;
  if (trustedSwap) {
    rows.push({ label: "Contract", detail: `Trusted ${c.contractName ?? "known protocol"}`, tone: "ok" });
  } else if (c.verified && c.matchType === "perfect") {
    rows.push({ label: "Contract", detail: `Sourcify perfect match${c.contractName ? ` · ${c.contractName}` : ""}`, tone: "ok" });
  } else if (c.verified && c.matchType === "partial") {
    rows.push({ label: "Contract", detail: `Sourcify partial match${c.contractName ? ` · ${c.contractName}` : ""}`, tone: "warn" });
  } else {
    rows.push({ label: "Contract", detail: "Not verified on Sourcify", tone: "warn" });
  }

  // Simulation
  if (!sim) {
    rows.push({ label: "Simulation", detail: "Skipped (Tenderly not configured)", tone: "info" });
  } else if (!sim.success) {
    rows.push({ label: "Simulation", detail: `Failed${sim.failureReason ? ` · ${sim.failureReason}` : ""}`, tone: "bad" });
  } else {
    rows.push({ label: "Simulation", detail: `OK · ${sim.assetChanges.length} asset change${sim.assetChanges.length === 1 ? "" : "s"} · gas ${sim.gasUsed}`, tone: "ok" });
  }

  // Net effect
  if (input.netEffect && input.netEffect.deltas.length > 0) {
    const formatted = input.netEffect.deltas
      .map((delta) => {
        const sign = delta.amount.startsWith("-") ? "-" : "+";
        const symbol = delta.symbol ?? shortAddr(delta.token);
        return `${sign}${delta.amount.replace(/^-/, "")} ${symbol}`;
      })
      .join(", ");
    rows.push({ label: "Net effect", detail: formatted, tone: "info" });
  } else if (input.netEffect) {
    rows.push({ label: "Net effect", detail: "No net change to your wallet", tone: "info" });
  }

  // Recipient (for swaps)
  if (d.kind === "swap") {
    if (d.recipientKind === "wallet") {
      rows.push({ label: "Recipient", detail: "Your wallet", tone: "ok" });
    } else if (d.recipientKind === "router_self") {
      rows.push({ label: "Recipient", detail: "Router-self forwarding (UR convention, normal)", tone: "ok" });
    } else if (d.recipientKind === "third_party") {
      rows.push({ label: "Recipient", detail: `Third party · ${shortAddr(d.recipient)}`, tone: "bad" });
    }
  }

  // Origin
  rows.push({ label: "Origin", detail: input.origin.origin, tone: "info" });

  return rows;
}

function ChecksPanel({ input }: { input: JudgeInput }) {
  const rows = buildChecks(input);
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start gap-2">
          <span className={`w-3 shrink-0 ${toneClass(r.tone)}`}>{toneGlyph(r.tone)}</span>
          <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
          <span className={`flex-1 break-words ${toneClass(r.tone)}`}>{r.detail}</span>
        </div>
      ))}
    </div>
  );
}

export interface AwaitingConfirmState {
  phase: "awaiting_confirm";
  baseDraft: {
    decoded: DecodedAction;
    intent: UserIntent;
    pageSnapshot: { title?: string };
    origin: string;
  };
}

export interface VerdictReadyState {
  phase: "verdict_ready";
  verdict: JudgeVerdict;
  judgeInput: JudgeInput;
  origin: string;
  pageSnapshot: { title?: string };
}

export type PopupState = AwaitingConfirmState | VerdictReadyState;

function reasonClass(severity: JudgeVerdict["reasons"][number]["severity"]) {
  if (severity === "danger") return "text-destructive";
  if (severity === "warn") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export interface JudgeInfo {
  provider: "stub" | "openai" | "anthropic" | "none";
  model?: string;
}

export interface PopupViewProps {
  id: string | null;
  state: PopupState | null;
  judgeInfo?: JudgeInfo | null;
  onIntentConfirm: (id: string, intent: UserIntent) => void;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
}

function JudgeInfoFooter({ info }: { info?: JudgeInfo | null }) {
  if (!info) return null;
  let label: string;
  if (info.provider === "stub") label = "stub mode";
  else if (info.provider === "none") label = "no LLM configured";
  else label = `${info.provider}${info.model ? ` · ${info.model}` : ""}`;
  return (
    <p className="border-t bg-muted/20 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      Judge: {label}
    </p>
  );
}

/** Shared popup UI used by the extension and the web preview dev server. */
export function PopupView({ id, state, judgeInfo, onIntentConfirm, onReject, onApprove }: PopupViewProps) {
  if (!state || !id) {
    return (
      <div className="w-[380px] bg-background p-3">
        <Card>
          <CardHeader className="space-y-1 pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Shield className="h-5 w-5 text-foreground" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-base">Intent Check</CardTitle>
                <CardDescription className="text-xs">Extension popup</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-6 pt-0">
            <p className="text-sm text-muted-foreground">No active request. Trigger a transaction from a supported dapp to see analysis here.</p>
          </CardContent>
          <JudgeInfoFooter info={judgeInfo} />
        </Card>
      </div>
    );
  }

  if (state.phase === "awaiting_confirm") {
    return (
      <div className="w-[380px] bg-background p-3">
        <Card>
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-base">Intent Check</CardTitle>
            <CardDescription className="truncate text-xs">{state.baseDraft.origin}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <IntentConfirm initial={state.baseDraft.intent} onConfirm={(intent) => onIntentConfirm(id, intent)} />
          </CardContent>
          <JudgeInfoFooter info={judgeInfo} />
        </Card>
      </div>
    );
  }

  return (
    <div className="w-[380px] bg-background p-3">
      <Card>
        <CardHeader className="space-y-2 pb-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Intent Check</CardTitle>
            <VerdictChip tier={state.verdict.tier} />
          </div>
          <CardDescription className="text-xs">{state.origin}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm leading-snug">{state.verdict.headline}</p>
          <ul className="space-y-1.5 text-xs">
            {state.verdict.reasons.map((r, i) => (
              <li key={i} className={reasonClass(r.severity)}>
                {r.text}
              </li>
            ))}
          </ul>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                View technical details
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Details</DialogTitle>
                <DialogDescription>Decoded call and simulation snapshot for this request.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <ChecksPanel input={state.judgeInput} />
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Raw decoded action</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono leading-relaxed">{JSON.stringify(state.judgeInput.decoded, null, 2)}</pre>
                </details>
                {state.judgeInput.sim && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Raw asset changes</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono leading-relaxed">{JSON.stringify(state.judgeInput.sim.assetChanges, null, 2)}</pre>
                  </details>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
        <CardFooter className="flex gap-2 border-t bg-muted/30 px-4 py-3">
          <Button variant="outline" className="flex-1" onClick={() => onReject(id)}>
            Reject
          </Button>
          <Button className="flex-1" disabled={state.verdict.tier === "DANGER"} onClick={() => onApprove(id)}>
            {state.verdict.tier === "DANGER" ? "Blocked" : "Sign"}
          </Button>
        </CardFooter>
        <JudgeInfoFooter info={judgeInfo} />
      </Card>
    </div>
  );
}
