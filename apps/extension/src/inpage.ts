import { IC_PORT, type ContentToInpage, type InpageToContent } from "./shared/messaging";

(function install() {
  const target = (window as any).ethereum;
  if (!target) {
    // Wait for injection: most wallets define window.ethereum after page load.
    const i = setInterval(() => {
      if ((window as any).ethereum) { clearInterval(i); install(); }
    }, 100);
    return;
  }

  const interceptedMethods = new Set([
    "eth_sendTransaction",
    "eth_signTypedData_v4",
    "personal_sign",
    "wallet_sendCalls",
  ]);

  const originalRequest = target.request.bind(target);

  target.request = async function patched(args: { method: string; params?: unknown[] }) {
    if (!interceptedMethods.has(args.method)) {
      return originalRequest(args);
    }

    const id = crypto.randomUUID();
    const msg: InpageToContent = {
      kind: "wallet_request",
      id,
      origin: location.origin,
      request: { method: args.method, params: (args.params as any) ?? [] } as any,
    };
    window.postMessage({ port: IC_PORT, payload: msg }, "*");

    const decision = await new Promise<"approve" | "reject">((resolve) => {
      function onMessage(ev: MessageEvent) {
        if (ev.source !== window) return;
        const data = (ev.data ?? {}) as { port?: string; payload?: ContentToInpage };
        if (data.port !== IC_PORT || !data.payload) return;
        const p = data.payload;
        if ("id" in p && p.id !== id) return;
        if (p.kind === "verdict") { window.removeEventListener("message", onMessage); resolve(p.userDecision); }
        if (p.kind === "error")   { window.removeEventListener("message", onMessage); resolve("reject"); }
      }
      window.addEventListener("message", onMessage);
    });

    if (decision === "reject") {
      throw { code: 4001, message: "User rejected the request (intent-check)." };
    }
    return originalRequest(args);
  };

  console.log("[intent-check] window.ethereum patched");
})();
