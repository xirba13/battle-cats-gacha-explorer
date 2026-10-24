import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A static site: banner data and the Cat Guide list are files in public/data,
// and everything else runs in the browser (no API to proxy).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
