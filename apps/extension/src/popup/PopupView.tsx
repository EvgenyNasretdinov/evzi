import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleAlert, Loader2, MinusCircle } from "lucide-react";
import { ChatScreen } from "./components/ChatScreen";
import { ConfirmIntentScreen } from "./components/ConfirmIntentScreen";
import { IdleScreen } from "./components/IdleScreen";
import { VerdictScreen } from "./components/VerdictScreen";
import { CHAT_DEMO_MESSAGES, type ChatMessage } from "@/popup/chat/types";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput, ContractMeta } from "@intent-check/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildVerdictScreenModel, formatJudgeInputRaw } from "@/popup/verdict/verdictContent";

export interface JudgingStep {
  id: "decoding" | "registry" | "sourcify" | "simulating" | "judging";
  label: string;
  status: "pending" | "running" | "done" | "skipped";
  /** Outcome tone, only meaningful when status is "done". Defaults to "ok". */
  tone?: "ok" | "warn" | "bad";
  detail?: string;
}

export interface AwaitingConfirmState {
  phase: "awaiting_confirm";
  baseDraft: {
    decoded: DecodedAction;
    intent: UserIntent;
    pageSnapshot: { title?: string };
    origin: string;
    clickContext?: { text: string; ariaLabel?: string; sectionHeading?: string };
  };
}

export interface JudgingState {
  phase: "judging";
  origin: string;
  intent: UserIntent;
  decoded: DecodedAction;
  contract: ContractMeta;
  steps: JudgingStep[];
  enteredAt: number;
}

export interface ErrorState {
  phase: "error";
  origin: string;
  message: string;
  retryDraft?: { intent: UserIntent };
}

export interface VerdictReadyState {
  phase: "verdict_ready";
  verdict: JudgeVerdict;
  judgeInput: JudgeInput;
  origin: string;
  pageSnapshot: { title?: string };
}

export type PopupState = AwaitingConfirmState | JudgingState | VerdictReadyState | ErrorState;

export interface JudgeInfo {
  provider: "stub" | "openai" | "anthropic" | "none";
  model?: string;
}

/** Context the chat carries when opened from a screen that has verdict data. */
export interface ChatContext {
  judgeInput?: JudgeInput;
  verdict?: JudgeVerdict;
  origin?: string;
}

export interface PopupViewProps {
  id: string | null;
  state: PopupState | null;
  judgeInfo?: JudgeInfo | null;
  onIntentConfirm: (id: string, intent: UserIntent) => void;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
  onTalkToEvzi?: () => void;
  /**
   * Send a chat message to the agent. Receives the full thread + the context
   * the chat opened with (verdict, judgeInput, origin) so the backend can
   * tailor its reply. Resolves with the assistant's reply text.
   *
   * When omitted (e.g., the design preview), ChatScreen falls back to a
   * canned placeholder reply.
   */
  onChatSend?: (messages: ChatMessage[], context?: ChatContext) => Promise<string>;
  /** Preview: increment to open chat; use with `chatPreviewMode`. */
  chatPreviewTrigger?: number;
  chatPreviewMode?: "empty" | "demo";
}

// --- step list helpers ---

function StepIcon({ step }: { step: JudgingStep }) {
  if (step.status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />;
  if (step.status === "skipped") return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  if (step.status === "done") {
    if (step.tone === "bad")  return <CircleAlert    className="h-4 w-4 shrink-0 text-destructive" aria-hidden />;
    if (step.tone === "warn") return <AlertTriangle  className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />;
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />;
}

function stepTextTone(step: JudgingStep): string {
  if (step.status === "running") return "font-medium text-foreground";
  if (step.status === "pending") return "text-muted-foreground";
  if (step.status === "done") {
    if (step.tone === "bad")  return "text-destructive";
    if (step.tone === "warn") return "text-amber-700 dark:text-amber-400";
  }
  return "text-foreground";
}

function ProgressList({ steps }: { steps: JudgingStep[] }) {
  return (
    <ul className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2.5 text-sm">
          <span className="mt-0.5">
            <StepIcon step={s} />
          </span>
          <div className="min-w-0 flex-1">
            <div className={stepTextTone(s)}>{s.label}</div>
            {s.detail && (
              <div className="truncate text-[11px] text-muted-foreground">{s.detail}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
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

/** Compose an aiMessage from the captured click context so it appears in the
 * ConfirmIntentScreen's hero copy. Falls back to the default "Let's take a
 * second look…" placeholder when no click was recorded. */
function aiMessageFromClick(click?: { text: string; sectionHeading?: string }) {
  if (!click) return undefined;
  const where = click.sectionHeading ? ` in ${click.sectionHeading}` : "";
  return {
    title: `Reviewing your "${click.text}"${where ? ` action` : " click"}…`,
    description: `I saw you click "${click.text}"${where}. Confirm it matches what you meant and I'll run the safety checks.`,
  };
}

/** Shared popup UI used by the extension and the web preview dev server. */
export function PopupView({
  id,
  state,
  judgeInfo,
  onIntentConfirm,
  onReject,
  onApprove,
  onTalkToEvzi,
  onChatSend,
  chatPreviewTrigger = 0,
  chatPreviewMode = "empty",
}: PopupViewProps) {
  // Chat overlay state — when open, takes precedence over every other phase.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(0);
  const [chatSeed, setChatSeed] = useState<ChatMessage[] | undefined>(undefined);
  const [chatContext, setChatContext] = useState<ChatContext | undefined>(undefined);
  const lastPreviewTrig = useRef(0);

  const openChat = useCallback(
    (ctx?: ChatContext, seed?: ChatMessage[]) => {
      onTalkToEvzi?.();
      setChatContext(ctx);
      setChatSeed(seed);
      setChatSessionId((s) => s + 1);
      setChatOpen(true);
    },
    [onTalkToEvzi]
  );

  const handleBackFromChat = useCallback(() => {
    setChatOpen(false);
    setChatSeed(undefined);
    setChatContext(undefined);
  }, []);

  // Preview-mode trigger: opens chat from external state (e.g., the dev
  // preview app's "Chat · empty" / "Chat · demo" buttons).
  useEffect(() => {
    if (!chatPreviewTrigger || chatPreviewTrigger === lastPreviewTrig.current) return;
    lastPreviewTrig.current = chatPreviewTrigger;
    const seed = chatPreviewMode === "demo" ? CHAT_DEMO_MESSAGES.map((m) => ({ ...m })) : [];
    setChatSeed(seed.length ? seed : undefined);
    setChatContext(undefined);
    setChatSessionId((s) => s + 1);
    setChatOpen(true);
  }, [chatPreviewTrigger, chatPreviewMode]);

  // Adapter: ChatScreen.sendMessage takes a flat (messages) signature; we
  // bind the current chat context here so the screen doesn't need to know
  // about it.
  const sendForChat = onChatSend
    ? (messages: ChatMessage[]) => onChatSend(messages, chatContext)
    : undefined;

  if (chatOpen) {
    return (
      <div className="w-[420px] bg-transparent p-1.5">
        <ChatScreen
          key={chatSessionId}
          initialMessages={chatSeed}
          sendMessage={sendForChat}
          onBack={handleBackFromChat}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  // --- idle ---
  if (!state || !id) {
    return (
      <div className="w-[420px] bg-transparent p-1.5">
        <IdleScreen onClose={() => window.close()} onTalkToEvzi={() => openChat()} />
      </div>
    );
  }

  // --- awaiting confirm: designer's ConfirmIntentScreen ---
  if (state.phase === "awaiting_confirm") {
    return (
      <div className="w-[420px] bg-transparent p-1.5">
        <ConfirmIntentScreen
          eyeStatus="blue"
          aiMessage={aiMessageFromClick(state.baseDraft.clickContext)}
          initial={state.baseDraft.intent}
          connectedOrigin={state.baseDraft.origin}
          decoded={state.baseDraft.decoded}
          onConfirm={(intent) => onIntentConfirm(id, intent)}
          onClose={() => window.close()}
          onTalkToEvzi={() => openChat({ origin: state.baseDraft.origin })}
        />
      </div>
    );
  }

  // --- judging: full pipeline checklist + 60s stuck guard ---
  if (state.phase === "judging") {
    const stuck = Date.now() - state.enteredAt > 90_000;
    if (stuck) {
      return (
        <div className="w-[380px] bg-transparent p-1.5">
          <Card className="evzi-popup-surface shadow-popup border-0">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-base">EVZI</CardTitle>
              <CardDescription className="truncate text-xs">{state.origin}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-sm text-destructive">
                The check is taking longer than expected. The judge backend may be unavailable.
              </p>
              <ProgressList steps={state.steps} />
              <Button className="w-full" onClick={() => onIntentConfirm(id, state.intent)}>
                Retry
              </Button>
            </CardContent>
            <JudgeInfoFooter info={judgeInfo} />
          </Card>
        </div>
      );
    }
    return (
      <div className="w-[380px] bg-transparent p-1.5">
        <Card className="evzi-popup-surface shadow-popup border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-base">Running checks…</CardTitle>
            <CardDescription className="truncate text-xs">{state.origin}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <p className="text-xs text-muted-foreground">
              Intent: <span className="font-medium text-foreground">{state.intent.summary}</span>
            </p>
            <ProgressList steps={state.steps} />
          </CardContent>
          <JudgeInfoFooter info={judgeInfo} />
        </Card>
      </div>
    );
  }

  // --- error: retry / reject ---
  if (state.phase === "error") {
    return (
      <div className="w-[380px] bg-transparent p-1.5">
        <Card className="evzi-popup-surface shadow-popup border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-base">EVZI</CardTitle>
            <CardDescription className="truncate text-xs">{state.origin}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-sm text-destructive">Could not get a verdict.</p>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-[11px] leading-snug text-muted-foreground">
              {state.message}
            </pre>
            <div className="flex gap-2">
              {state.retryDraft && (
                <Button className="flex-1" onClick={() => onIntentConfirm(id, state.retryDraft!.intent)}>
                  Retry
                </Button>
              )}
              <Button variant="outline" className={state.retryDraft ? "flex-1" : "w-full"} onClick={() => onReject(id)}>
                Reject request
              </Button>
            </div>
          </CardContent>
          <JudgeInfoFooter info={judgeInfo} />
        </Card>
      </div>
    );
  }

  // --- verdict: designer's VerdictScreen ---
  const model = buildVerdictScreenModel(state.verdict, state.judgeInput);
  const rawDataText = formatJudgeInputRaw(state.judgeInput, state.origin);
  const dangerPrimaryIsReject = state.verdict.tier === "DANGER";

  let judgeFooterLabel: string | undefined;
  if (judgeInfo) {
    if (judgeInfo.provider === "stub") judgeFooterLabel = "Judge: stub mode";
    else if (judgeInfo.provider === "none") judgeFooterLabel = "Judge: no LLM configured";
    else judgeFooterLabel = `Judge: ${judgeInfo.provider}${judgeInfo.model ? ` · ${judgeInfo.model}` : ""}`;
  }

  return (
    <div className="w-[420px] bg-transparent p-1.5">
      <VerdictScreen
        eyeStatus={model.eyeStatus}
        title={model.title}
        description={model.description}
        checklist={model.checklist}
        primaryLabel={model.primaryLabel}
        secondaryLabel={model.secondaryLabel}
        rawDataText={rawDataText}
        footerLabel={judgeFooterLabel}
        onPrimary={() => (dangerPrimaryIsReject ? onReject(id) : onApprove(id))}
        onSecondary={() => (dangerPrimaryIsReject ? onApprove(id) : onReject(id))}
        onTalkToEvzi={() => openChat({ judgeInput: state.judgeInput, verdict: state.verdict, origin: state.origin })}
        onClose={() => window.close()}
      />
    </div>
  );
}
