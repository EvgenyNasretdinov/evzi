import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Intent Check",
  description: "Tells you whether a Web3 transaction matches your intent.",
  version: "0.0.1",
  action: { default_popup: "src/popup/index.html", default_title: "Intent Check" },
  background: { service_worker: "src/background.ts", type: "module" },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content-script.ts"],
      run_at: "document_start",
      all_frames: false,
    },
    // @crxjs types lag: world: "MAIN" supported in MV3 since Chrome 111
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/inpage.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN",
    } as any,
  ],
  web_accessible_resources: [
    { resources: ["assets/*"], matches: ["http://*/*", "https://*/*"] },
  ],
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["http://*/*", "https://*/*"],
});
