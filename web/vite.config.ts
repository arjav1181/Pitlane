import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Point at a deployed server with OPENREELS_DEV_API=https://…/api/v1
        target: (process.env.OPENREELS_DEV_API ?? "http://localhost:3000").replace(/\/api\/v1\/?$/, ""),
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
