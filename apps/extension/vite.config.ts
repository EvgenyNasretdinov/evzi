import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Workspace root holds the shared .env (with TENDERLY_* keys, etc.). Vite's loadEnv
// returns matched vars; empty prefix loads everything. We then bake the ones we need
// into the bundle via `define`. Note: anything baked in is visible to anyone who
// inspects the extension bundle, which is acceptable for local dev only.
const workspaceRoot = path.resolve(__dirname, "..", "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    define: {
      "import.meta.env.VITE_TENDERLY_ACCESS_KEY": JSON.stringify(env.TENDERLY_ACCESS_KEY ?? ""),
      "import.meta.env.VITE_TENDERLY_ACCOUNT_SLUG": JSON.stringify(env.TENDERLY_ACCOUNT_SLUG ?? ""),
      "import.meta.env.VITE_TENDERLY_PROJECT_SLUG": JSON.stringify(env.TENDERLY_PROJECT_SLUG ?? ""),
    },
    // sourcemap=true so background/popup stack traces in the Chrome devtools
    // point at real source lines (was "background.ts-XXX.js:7:34786" before).
    build: {
      sourcemap: true,
      rollupOptions: { input: { popup: "src/popup/index.html" } },
    },
  };
});
