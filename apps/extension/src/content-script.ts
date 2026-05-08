import { IC_PORT, type InpageToContent, type ContentToInpage, type ContentToBackground, type BackgroundToContent, type PageSnapshot } from "./shared/messaging";

// inpage.ts is loaded into the page's MAIN world by the manifest (world: "MAIN" content_scripts entry).
// We do not inject it here.

function snapshot(): PageSnapshot {
  const og = (k: string) => document.querySelector<HTMLMetaElement>(`meta[property="og:${k}"]`)?.content;
  const visibleBtn = document.activeElement instanceof HTMLElement ? document.activeElement.innerText?.trim().slice(0, 80) : undefined;
  return {
    url: location.href,
    origin: location.origin,
    title: document.title,
    ogTitle: og("title"),
    ogSiteName: og("site_name"),
    visibleButtonText: visibleBtn,
  };
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = (ev.data ?? {}) as { port?: string; payload?: InpageToContent };
  if (data.port !== IC_PORT || !data.payload) return;
  if (data.payload.kind !== "wallet_request") return;
  const { id, request, origin } = data.payload;
  const msg: ContentToBackground = { kind: "judge_request", id, payload: { request, origin, pageSnapshot: snapshot() } };
  chrome.runtime.sendMessage(msg).catch((e) => {
    const reply: ContentToInpage = { kind: "error", id, message: String(e) };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  });
});

chrome.runtime.onMessage.addListener((msg: BackgroundToContent) => {
  if (msg.kind === "judge_result") {
    const reply: ContentToInpage = { kind: "verdict", id: msg.id, verdict: msg.verdict, userDecision: msg.userDecision };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  } else if (msg.kind === "judge_error") {
    const reply: ContentToInpage = { kind: "error", id: msg.id, message: msg.message };
    window.postMessage({ port: IC_PORT, payload: reply }, "*");
  }
});
