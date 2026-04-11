import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

/**
 * Backoffice dev server.
 *
 * Proxies `/api/*` to the backoffice-router worker (port 3005), which then
 * forwards to the control-plane (3003). This mirrors the prod topology —
 * browser → backoffice-router → control-plane — so the same request-shaping
 * (X-Forwarded-Host, CF-Connecting-IP handling) is exercised in dev.
 *
 * If you want to bypass the router in dev (e.g. when the router isn't
 * running), point VITE_API_PROXY_PORT at the control-plane (3003) instead.
 */
const proxyPort = process.env.VITE_API_PROXY_PORT || "3005"
const backofficePort = parseInt(process.env.VITE_PORT || "3004", 10)
const proxyTarget = `http://localhost:${proxyPort}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: backofficePort,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/test-auth-login": {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
