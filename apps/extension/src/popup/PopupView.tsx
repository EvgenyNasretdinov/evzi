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

function ContractTrust({ contract, trusted }: { contract: ContractMeta; trusted: boolean }) {
  let label: string;
  let tone: "ok" | "warn" | "bad";
  if (trusted) {
    label = `Trusted ${contract.contractName ?? "known protocol"}`;
    tone = "ok";
  } else if (contract.verified && contract.matchType === "perfect") {
    label = `Sourcify perfect match${contract.contractName ? ` · ${contract.contractName}` : ""}`;
    tone = "ok";
  } else if (contract.verified && contract.matchType === "partial") {
    label = `Sourcify partial match${contract.contractName ? ` · ${contract.contractName}` : ""}`;
    tone = "warn";
  } else {
    label = "Contract not verified on Sourcify";
    tone = "warn";
  }
  const cls =
    tone === "ok" ? "text-emerald-700 dark:text-emerald-400"
    : tone === "warn" ? "text-amber-700 dark:text-amber-400"
    : "text-destructive";
  return <p className={cls}>{label}</p>;
}

function SimulationStatus({ sim }: { sim?: SimResult }) {
  if (!sim) {
    return <p className="text-muted-foreground">Simulation skipped (Tenderly not configured).</p>;
  }
  if (!sim.success) {
    return <p className="text-destructive">Simulation failed{sim.failureReason ? `: ${sim.failureReason}` : ""}.</p>;
  }
  return <p className="text-emerald-700 dark:text-emerald-400">Simulated successfully · {sim.assetChanges.length} asset change{sim.assetChanges.length === 1 ? "" : "s"} · gas {sim.gasUsed}</p>;
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
                <ContractTrust contract={state.judgeInput.contract} trusted={state.judgeInput.decoded.kind === "swap" && state.judgeInput.decoded.trusted === true} />
                <SimulationStatus sim={state.judgeInput.sim} />
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono leading-relaxed">{JSON.stringify(state.judgeInput.decoded, null, 2)}</pre>
                {state.judgeInput.sim && (
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono leading-relaxed">
                    {JSON.stringify(state.judgeInput.sim.assetChanges, null, 2)}
                  </pre>
                )}
                <p className="text-muted-foreground">Origin: {state.origin}</p>
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
