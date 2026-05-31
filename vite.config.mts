import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [react()],
  root: resolve(__dirname, "src/renderer"),
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("@xterm") || id.includes("xterm")) {
            return "xterm";
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "react-vendor";
          }

          return "vendor";
        }
      }
    }
  }
});
