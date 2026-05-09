// Self-contained inpage proxy. No imports — runs as-is in the page main world.
// Injected by content-script.ts via a <script src=chrome-extension://...> tag at document_start.
(function () {
  "use strict";

  var IC_PORT = "intent-check";
  var MAX_ATTEMPTS = 50;

  function install() {
    var target = window.ethereum;
    if (!target) {
      var attempts = 0;
      var i = setInterval(function () {
        attempts += 1;
        if (window.ethereum) { clearInterval(i); install(); return; }
        if (attempts >= MAX_ATTEMPTS) { clearInterval(i); }
      }, 100);
      return;
    }

    if (target.__intentCheckPatched) return;

    var interceptedMethods = new Set([
      "eth_sendTransaction",
      "eth_signTypedData_v4",
      "personal_sign",
      "wallet_sendCalls",
    ]);

    var originalRequest = target.request.bind(target);

    target.request = async function patched(args) {
      if (!interceptedMethods.has(args.method)) {
        return originalRequest(args);
      }

      // Capture the wallet's current chain at request time. Read synchronously only —
      // making any async call here can deadlock with the dApp's own request flow.
      var chainIdHex = (typeof target.chainId === "string") ? target.chainId : undefined;

      var id = crypto.randomUUID();
      var msg = {
        kind: "wallet_request",
        id: id,
        origin: location.origin,
        chainIdHex: chainIdHex,
        request: { method: args.method, params: args.params || [] },
      };
      window.postMessage({ port: IC_PORT, payload: msg }, "*");

      var decision = await new Promise(function (resolve) {
        function onMessage(ev) {
          if (ev.source !== window) return;
          var data = ev.data || {};
          if (data.port !== IC_PORT || !data.payload) return;
          var p = data.payload;
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

    target.__intentCheckPatched = true;
    if (globalThis.__INTENT_CHECK_DEBUG === true) {
      console.log("[intent-check] window.ethereum patched");
    }
  }

  install();
})();
