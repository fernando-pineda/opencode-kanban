import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
    proxy: {
      "/terminal": {
        target: "ws://localhost:3210",
        changeOrigin: true,
        ws: true,
      },
      "/api/events": {
        target: "ws://localhost:3210",
        changeOrigin: true,
        ws: false,
      },
      "/api/filesystem": {
        target: "http://localhost:3210",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3210",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
