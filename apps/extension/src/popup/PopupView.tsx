import { useCallback, useEffect, useRef, useState } from "react";
import { ChatScreen } from "./components/ChatScreen";
import { ConfirmIntentScreen } from "./components/ConfirmIntentScreen";
import { IdleScreen } from "./components/IdleScreen";
import { VerdictScreen } from "./components/VerdictScreen";
import { CHAT_DEMO_MESSAGES } from "@/popup/chat/types";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput } from "@intent-check/types";
import { buildVerdictScreenModel, formatJudgeInputRaw } from "@/popup/verdict/verdictContent";
import type { ChatMessage } from "@/popup/chat/types";

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

type MainSnapshot = { id: string | null; state: PopupState | null };

export interface PopupViewProps {
  id: string | null;
  state: PopupState | null;
  onIntentConfirm: (id: string, intent: UserIntent) => void;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
  onTalkToEvzi?: () => void;
  /** Preview: increment to open chat; use with `chatPreviewMode`. */
  chatPreviewTrigger?: number;
  chatPreviewMode?: "empty" | "demo";
}

/** Shared popup UI used by the extension and the web preview dev server. */
export function PopupView({
  id,
  state,
  onIntentConfirm,
  onReject,
  onApprove,
  onTalkToEvzi,
  chatPreviewTrigger = 0,
  chatPreviewMode = "empty",
}: PopupViewProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(0);
  const [chatSeed, setChatSeed] = useState<ChatMessage[] | undefined>(undefined);
  const lastPreviewTrig = useRef(0);

  const openChat = useCallback(
    (seed?: ChatMessage[]) => {
      onTalkToEvzi?.();
      setChatSeed(seed);
      setChatSessionId((s) => s + 1);
      setChatOpen(true);
    },
    [onTalkToEvzi]
  );

  const handleBackFromChat = useCallback(() => {
    setChatOpen(false);
    setChatSeed(undefined);
  }, []);

  useEffect(() => {
    if (!chatPreviewTrigger || chatPreviewTrigger === lastPreviewTrig.current) return;
    lastPreviewTrig.current = chatPreviewTrigger;
    const seed = chatPreviewMode === "demo" ? CHAT_DEMO_MESSAGES.map((m) => ({ ...m })) : [];
    setChatSeed(seed.length ? seed : undefined);
    setChatSessionId((s) => s + 1);
    setChatOpen(true);
  }, [chatPreviewTrigger, chatPreviewMode]);

  if (chatOpen) {
    return (
      <div className="w-[min(420px,100vw)] bg-transparent p-1.5">
        <ChatScreen
          key={chatSessionId}
          initialMessages={chatSeed}
          onBack={handleBackFromChat}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  if (!state || !id) {
    return (
      <div className="w-[min(420px,100vw)] bg-transparent p-1.5">
        <IdleScreen onClose={() => window.close()} onTalkToEvzi={() => openChat()} />
      </div>
    );
  }

  if (state.phase === "awaiting_confirm") {
    return (
      <div className="w-[min(420px,100vw)] bg-transparent p-1.5">
        <ConfirmIntentScreen
          eyeStatus="blue"
          initial={state.baseDraft.intent}
          connectedOrigin={state.baseDraft.origin}
          decoded={state.baseDraft.decoded}
          onConfirm={(intent) => onIntentConfirm(id, intent)}
          onClose={() => window.close()}
          onTalkToEvzi={() => openChat()}
        />
      </div>
    );
  }

  const model = buildVerdictScreenModel(state.verdict);
  const rawDataText = formatJudgeInputRaw(state.judgeInput, state.origin);
  const dangerPrimaryIsReject = state.verdict.tier === "DANGER";

  return (
    <div className="w-[min(420px,100vw)] bg-transparent p-1.5">
      <VerdictScreen
        eyeStatus={model.eyeStatus}
        title={model.title}
        description={model.description}
        checklist={model.checklist}
        primaryLabel={model.primaryLabel}
        secondaryLabel={model.secondaryLabel}
        rawDataText={rawDataText}
        onPrimary={() => (dangerPrimaryIsReject ? onReject(id) : onApprove(id))}
        onSecondary={() => (dangerPrimaryIsReject ? onApprove(id) : onReject(id))}
        onTalkToEvzi={() => openChat()}
        onClose={() => window.close()}
      />
    </div>
  );
}
