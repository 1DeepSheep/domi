import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/prosemirror-") || id.includes("/@tiptap/pm/")) {
            return "editor-prosemirror";
          }
          if (id.includes("/node_modules/@tiptap/")) return "editor-tiptap";
          return undefined;
        }
      }
    }
  }
});
