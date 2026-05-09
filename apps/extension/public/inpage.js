// Self-contained inpage proxy. No imports — runs as-is in the page main world.
// Injected by content-script.ts via a <script src=chrome-extension://...> tag at document_start.
(function () {
  "use strict";

  var IC_PORT = "intent-check";
  var MAX_ATTEMPTS = 50;
  // Click-context window: only forward a click recorded within the last 10s as
  // associated with the request. Older clicks are stale and probably unrelated.
  var CLICK_CONTEXT_TTL_MS = 10_000;

  // Extract visible <input>/<textarea>/contenteditable values inside a section,
  // alongside their nearest <label>/aria-label/placeholder. Capped at MAX inputs.
  function extractInputs(section) {
    var out = [];
    if (!section) return out;
    var MAX = 8;
    var fields = section.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']");
    for (var i = 0; i < fields.length && out.length < MAX; i++) {
      var f = fields[i];
      var type = (f.getAttribute("type") || "").toLowerCase();
      if (type === "password" || type === "hidden") continue;
      var val = f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement
        ? f.value
        : (f.textContent || "");
      val = (val || "").trim();
      if (!val) continue;
      // Label: <label for=id>, ancestor label, aria-label, placeholder.
      var label = "";
      if (f.id) {
        var lbl = section.querySelector('label[for="' + f.id + '"]');
        if (lbl && lbl instanceof HTMLElement) label = (lbl.innerText || "").trim();
      }
      if (!label) {
        var ancestorLabel = f.closest("label");
        if (ancestorLabel && ancestorLabel instanceof HTMLElement) label = (ancestorLabel.innerText || "").trim();
      }
      if (!label) label = f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.getAttribute("name") || "";
      label = (label || "").trim().slice(0, 80);
      if (label.length > 0 || val.length > 0) {
        out.push({ label: label, value: val.slice(0, 120) });
      }
    }
    return out;
  }

  // Short text excerpt from the action's section. Helps the LLM disambiguate
  // when labels alone are ambiguous (e.g. "Confirm"). React-virtualized dApps
  // (Uniswap, etc) often don't expose semantic <section>/<form>, so we capture
  // a generous text window from the click target's region.
  function extractNearbyText(section) {
    if (!section || !(section instanceof HTMLElement)) return "";
    var text = (section.innerText || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 1200);
  }

  // Walk up from the clicked element to find the most informative ancestor
  // for context capture. Prefers semantic landmarks but falls back to a
  // sufficiently large container so heavily-virtualized dApps still get text.
  function pickContextRoot(btn) {
    var landmark = btn.closest("section, [role='dialog'], [role='form'], form, main, article");
    if (landmark instanceof HTMLElement && (landmark.innerText || "").length > 40) return landmark;
    // Walk up to find an ancestor with substantial text content (>120 chars).
    var node = btn.parentElement;
    var hops = 0;
    while (node && hops < 8) {
      if (node instanceof HTMLElement) {
        var len = (node.innerText || "").length;
        if (len > 120 && len < 4000) return node;
      }
      node = node.parentElement;
      hops += 1;
    }
    return document.body;
  }

  // Track the last meaningful click on the page so we can attribute the wallet
  // request to a user action ("Swap", "Approve…", "Mint Test NFT", etc).
  var lastClick = null;
  var lastActionContext = null;
  document.addEventListener("click", function captureClick(ev) {
    try {
      var el = ev.target;
      if (!el || !(el instanceof Element)) return;
      // Walk up to the nearest button/role=button — that's the actual action handle.
      var btn = el.closest("button, [role='button'], a[role='button'], [type='submit']");
      if (!btn) return;

      // Visible label: try aria-label first (often more semantic than innerText),
      // then innerText, then alt/title.
      var label = btn.getAttribute("aria-label")
        || (btn instanceof HTMLElement ? btn.innerText : "")
        || btn.getAttribute("title")
        || "";
      label = (label || "").trim().slice(0, 120);
      if (!label) return;

      var section = pickContextRoot(btn);

      // Section heading: nearest H1/H2/H3 ancestor or sibling. Helps disambiguate
      // generic labels like "Confirm" by their dialog/section.
      var heading = "";
      var h = section.querySelector("h1, h2, h3, [role='heading']");
      if (h && h instanceof HTMLElement) heading = (h.innerText || "").trim().slice(0, 120);

      lastClick = {
        text: label,
        ariaLabel: btn.getAttribute("aria-label") || undefined,
        nodeTag: btn.tagName.toLowerCase(),
        sectionHeading: heading || undefined,
        recordedAt: Date.now(),
      };
      lastActionContext = {
        heading: heading || undefined,
        inputs: extractInputs(section),
        nearbyText: extractNearbyText(section),
      };
    } catch (_) { /* never let context-capture break the page */ }
  }, /* useCapture */ true);

  function freshClickContext() {
    if (!lastClick) return undefined;
    if (Date.now() - lastClick.recordedAt > CLICK_CONTEXT_TTL_MS) return undefined;
    return lastClick;
  }
  function freshActionContext() {
    if (!lastClick || !lastActionContext) return undefined;
    if (Date.now() - lastClick.recordedAt > CLICK_CONTEXT_TTL_MS) return undefined;
    return lastActionContext;
  }

  var INTERCEPTED_METHODS = new Set([
    "eth_sendTransaction",
    "eth_signTypedData_v4",
    "personal_sign",
    "wallet_sendCalls",
  ]);

  /**
   * Wrap a provider's request method so intercepted calls flow through our
   * popup before reaching the real wallet. Idempotent — patching the same
   * provider twice is a no-op (we mark with __intentCheckPatched).
   *
   * Provider can be window.ethereum, or any EIP-6963-announced provider, or
   * any item inside window.ethereum.providers (legacy multi-wallet array).
   */
  function patchProvider(target, label) {
    if (!target || typeof target !== "object" || typeof target.request !== "function") return false;
    if (target.__intentCheckPatched) return false;

    var originalRequest = target.request.bind(target);

    target.request = async function patched(args) {
      if (!args || !INTERCEPTED_METHODS.has(args.method)) {
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
        clickContext: freshClickContext(),
        actionContext: freshActionContext(),
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
      console.log("[intent-check] patched provider:", label || "(unknown)");
    }
    return true;
  }

  /**
   * EIP-6963 multi-provider discovery: modern dApps don't call
   * window.ethereum.request — they listen for `eip6963:announceProvider`,
   * pick a provider object out of the event detail, and call .request on
   * THAT object. We patch each announced provider in place; the dApp keeps
   * the same reference so our patch applies to every subsequent call.
   *
   * We also dispatch `eip6963:requestProvider` so wallets that already
   * announced before our content script ran will re-announce.
   */
  function installEip6963() {
    window.addEventListener("eip6963:announceProvider", function (ev) {
      try {
        var detail = ev && ev.detail;
        if (!detail || !detail.provider) return;
        var name = detail.info && (detail.info.name || detail.info.rdns) || "EIP-6963";
        patchProvider(detail.provider, name);
      } catch (_) { /* never let provider patching break the page */ }
    }, true);

    // Best-effort kick: if the dApp's listeners are already attached, this
    // makes wallets re-announce so we can patch them. Harmless if no one
    // responds.
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (_) {}
  }

  /**
   * Legacy window.ethereum patching. Modern dApps don't use it, but many
   * still do as a fallback path. Also patches window.ethereum.providers[]
   * (legacy multi-wallet array used by Coinbase Wallet et al).
   */
  function installLegacy() {
    var target = window.ethereum;
    if (!target) {
      var attempts = 0;
      var i = setInterval(function () {
        attempts += 1;
        if (window.ethereum) { clearInterval(i); installLegacy(); return; }
        if (attempts >= MAX_ATTEMPTS) { clearInterval(i); }
      }, 100);
      return;
    }
    patchProvider(target, "window.ethereum");
    if (Array.isArray(target.providers)) {
      target.providers.forEach(function (p, idx) {
        patchProvider(p, "window.ethereum.providers[" + idx + "]");
      });
    }
  }

  installEip6963();
  installLegacy();
})();
