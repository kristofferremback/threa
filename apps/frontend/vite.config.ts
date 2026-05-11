/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { execSync } from "child_process"
import path from "path"

// Ports can be configured via env vars for browser E2E tests
const backendPort = process.env.VITE_BACKEND_PORT || "3001"
const frontendPort = parseInt(process.env.VITE_PORT || "3000", 10)
const backendTarget = `http://localhost:${backendPort}`

// Disable HMR during E2E tests to avoid noisy WebSocket errors when Playwright closes tabs
const isE2ETest = !!process.env.VITE_BACKEND_PORT

// Build version from git short hash — used for auto-update detection.
// Falls back to a build timestamp so auto-update still works in gitless CI environments.
let buildVersion: string
try {
  buildVersion = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
} catch {
  buildVersion = `build-${Date.now()}`
}

function versionJsonPlugin(): Plugin {
  return {
    name: "version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: buildVersion }),
      })
    },
  }
}

function withForwardedHostHeaders() {
  return {
    configure(proxy: {
      on(
        event: "proxyReq",
        listener: (
          proxyReq: { setHeader(name: string, value: string): void },
          req: {
            headers: Record<string, string | string[] | undefined>
          }
        ) => void
      ): void
    }) {
      proxy.on("proxyReq", (proxyReq, req) => {
        const rawHost = req.headers.host
        const host = Array.isArray(rawHost) ? rawHost[0] : rawHost
        if (!host) return

        const forwardedProtoHeader = req.headers["x-forwarded-proto"]
        const forwardedProto = Array.isArray(forwardedProtoHeader) ? forwardedProtoHeader[0] : forwardedProtoHeader
        const port = host.includes(":") ? (host.split(":").at(-1) ?? "") : ""

        proxyReq.setHeader("x-forwarded-host", host)
        proxyReq.setHeader("x-forwarded-proto", forwardedProto ?? "http")
        if (port) {
          proxyReq.setHeader("x-forwarded-port", port)
        }
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false, // we register manually in main.tsx with updateViaCache: 'none'
      manifest: false, // use existing public/manifest.json
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // recover.html is the nuclear-option SW-unregister page (public/recover.html).
        // Precaching it would defeat its purpose — and with CF Pages Pretty URLs, the
        // /recover ↔ /recover.html rewrite loop in _redirects causes the SW install
        // fetch to fail with ERR_TOO_MANY_REDIRECTS, which strands the SW in
        // "installing" forever and breaks navigator.serviceWorker.ready (and push).
        globIgnores: ["**/recover.html"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
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
    host: "0.0.0.0",
    port: frontendPort,
    hmr: isE2ETest ? false : undefined,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        xfwd: true,
        ...withForwardedHostHeaders(),
      },
      "/test-auth-login": {
        target: backendTarget,
        changeOrigin: true,
        xfwd: true,
        ...withForwardedHostHeaders(),
      },
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
