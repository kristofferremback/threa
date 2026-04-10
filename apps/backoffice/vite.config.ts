import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

/**
 * Backoffice dev server.
 *
 * Proxies `/api/*` directly to the control-plane (3003). No workspace-router
 * hop — the backoffice talks only to the control-plane. Same-origin proxy
 * means the WorkOS session cookie lands on the backoffice origin and the
 * login/callback flow works without any cookie-domain gymnastics.
 */
const controlPlanePort = process.env.VITE_CONTROL_PLANE_PORT || "3003"
const backofficePort = parseInt(process.env.VITE_PORT || "3004", 10)
const controlPlaneTarget = `http://localhost:${controlPlanePort}`

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
        target: controlPlaneTarget,
        changeOrigin: true,
      },
      "/test-auth-login": {
        target: controlPlaneTarget,
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
