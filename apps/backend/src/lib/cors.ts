import type { CorsOptions } from "cors"

export function createCorsOriginChecker(allowedOrigins: string[]): CorsOptions["origin"] {
  const allowlist = new Set(allowedOrigins)

  return (origin, callback) => {
    // Allow requests without Origin header (same-origin, mobile apps, curl, health checks).
    if (!origin) {
      callback(null, true)
      return
    }

    if (allowlist.has(origin)) {
      callback(null, true)
      return
    }

    callback(new Error("CORS origin not allowed"), false)
  }
}
