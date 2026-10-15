import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: "node",
  },
});
