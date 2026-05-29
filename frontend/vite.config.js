import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend port can be overridden with BCPE_BACKEND (used by docker-compose).
const backend = process.env.BCPE_BACKEND || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
    },
  },
});
