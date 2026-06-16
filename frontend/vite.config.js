import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy API + websocket to the FastAPI backend so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:1030", changeOrigin: true },
      "/ws": { target: "ws://localhost:1030", ws: true },
    },
  },
});
