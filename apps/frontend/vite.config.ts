/// <reference types="vitest" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

// Backend port can be configured via env var for browser E2E tests
const backendPort = process.env.VITE_BACKEND_PORT || "3001"
const backendTarget = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      "/test-auth-login": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
