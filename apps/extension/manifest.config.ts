import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "EVZI",
  description: "EVZI — tells you whether a Web3 transaction matches your intent.",
  version: "0.0.1",
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_title: "EVZI",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  background: { service_worker: "src/background.ts", type: "module" },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content-script.ts"],
      run_at: "document_start",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    { resources: ["inpage.js", "assets/*"], matches: ["http://*/*", "https://*/*"] },
  ],
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["http://*/*", "https://*/*"],
});
