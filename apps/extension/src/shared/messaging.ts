import type { JudgeVerdict, WalletRequest, UserIntent } from "@intent-check/types";

// Inpage <-> content-script messages travel via window.postMessage with a marker.
export const IC_PORT = "intent-check";

export type InpageToContent =
  | { kind: "wallet_request"; id: string; origin: string; request: WalletRequest }
  | { kind: "ping" };

export type ContentToInpage =
  | { kind: "verdict"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "error"; id: string; message: string };

// Content-script <-> background messages use chrome.runtime.
export type ContentToBackground =
  | { kind: "judge_request"; id: string; tabId?: number; payload: { request: WalletRequest; origin: string; pageSnapshot: PageSnapshot } }
  | { kind: "user_intent_confirmed"; id: string; intent: UserIntent }
  | { kind: "user_decision"; id: string; decision: "approve" | "reject" };

export type BackgroundToContent =
  | { kind: "judge_result"; id: string; verdict: JudgeVerdict; userDecision: "approve" | "reject" }
  | { kind: "judge_error"; id: string; message: string };

export interface PageSnapshot {
  url: string;
  origin: string;
  title?: string;
  ogTitle?: string;
  ogSiteName?: string;
  visibleButtonText?: string;
}
