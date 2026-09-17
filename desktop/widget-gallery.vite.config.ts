import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A browser-only entry point; the gallery has no Tauri or relay dependencies.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  server: { host: "127.0.0.1", port: 1425, strictPort: true },
  preview: { host: "127.0.0.1", port: 1425, strictPort: true },
  build: {
    outDir: "dist-widgets",
    rollupOptions: { input: resolve(__dirname, "widgets.html") },
  },
});
