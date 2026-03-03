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

// Build version from git short hash — used for auto-update detection
let buildVersion = "dev"
try {
  buildVersion = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
} catch {
  // git not available (e.g. CI without .git), fall back to "dev"
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
      registerType: "autoUpdate",
      manifest: false, // use existing public/manifest.json
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
