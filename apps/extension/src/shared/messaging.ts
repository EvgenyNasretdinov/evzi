import type { JudgeInput, JudgeVerdict, WalletRequest, UserIntent } from "@intent-check/types";

/** Popup chat message — wire shape, mirrors @intent-check/types optional fields. */
export interface ChatMessageWire {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContextWire {
  judgeInput?: JudgeInput;
  verdict?: JudgeVerdict;
  origin?: string;
}

// Inpage <-> content-script messages travel via window.postMessage with a marker.
export const IC_PORT = "intent-check";

export interface ClickContext {
  text: string;              // visible label of the clicked button
  ariaLabel?: string;
  nodeTag: string;           // "button", "a", "div"
  sectionHeading?: string;   // nearest H1/H2/H3 in the same section
  recordedAt: number;
}

export interface ActionContext {
  heading?: string;
  inputs: { label: string; value: string }[];
  nearbyText?: string;
}

export type InpageToContent =
  | { kind: "wallet_request"; id: string; origin: string; chainIdHex?: string; clickContext?: ClickContext; actionContext?: ActionContext; request: WalletRequest }
  | { kind: "ping" };

export type ContentToInpage =
  | { kind: "verdict"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "error"; id: string; message: string };

// Content-script <-> background messages use chrome.runtime.
export type ContentToBackground =
  | { kind: "judge_request"; id: string; tabId?: number; payload: { request: WalletRequest; origin: string; chainIdHex?: string; clickContext?: ClickContext; pageSnapshot: PageSnapshot } }
  | { kind: "user_intent_confirmed"; id: string; intent: UserIntent }
  | { kind: "user_decision"; id: string; decision: "approve" | "reject" };

export type BackgroundToContent =
  | { kind: "judge_result"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "judge_error"; id: string; message: string };

// Popup <-> background. Request/response over chrome.runtime.sendMessage.
export type PopupToBackground =
  | { kind: "chat_send"; messages: ChatMessageWire[]; context?: ChatContextWire };

export type ChatSendResponse =
  | { ok: true; reply: string }
  | { ok: false; error: string };

export interface PageSnapshot {
  url: string;
  origin: string;
  title?: string;
  ogTitle?: string;
  ogSiteName?: string;
  visibleButtonText?: string;
  // Rich context near the action: nearest section heading, visible input
  // values, and a short body-text excerpt. Used by the LLM intent inference.
  actionContext?: {
    heading?: string;
    inputs: { label: string; value: string }[];
    nearbyText?: string;
  };
}
