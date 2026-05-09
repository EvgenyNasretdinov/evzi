import { ConfirmIntentScreen } from "./components/ConfirmIntentScreen";
import { IdleScreen } from "./components/IdleScreen";
import { VerdictScreen } from "./components/VerdictScreen";
import type { JudgeVerdict, DecodedAction, UserIntent, JudgeInput } from "@intent-check/types";
import { buildVerdictScreenModel, formatJudgeInputRaw } from "@/popup/verdict/verdictContent";

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

export interface PopupViewProps {
  id: string | null;
  state: PopupState | null;
  onIntentConfirm: (id: string, intent: UserIntent) => void;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
  onTalkToEvzi?: () => void;
}

/** Shared popup UI used by the extension and the web preview dev server. */
export function PopupView({ id, state, onIntentConfirm, onReject, onApprove, onTalkToEvzi }: PopupViewProps) {
  if (!state || !id) {
    return (
      <div className="w-[min(420px,100vw)] bg-transparent p-1.5">
        <IdleScreen onClose={() => window.close()} onTalkToEvzi={onTalkToEvzi} />
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
        onTalkToEvzi={onTalkToEvzi}
        onClose={() => window.close()}
      />
    </div>
  );
}
