import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Plain Vite app (no CRX) for fast localhost UI work with HMR. */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5174,
    strictPort: true,
    open: "/preview/",
  },
});
