import type { Request, RequestHandler } from "express"
import { createRateLimit, getClientIp } from "@threa/backend-common"

export interface RateLimiterSet {
  globalBaseline: RequestHandler
  auth: RequestHandler
  search: RequestHandler
  upload: RequestHandler
  messageCreate: RequestHandler
  commandDispatch: RequestHandler
  publicApiWorkspace: RequestHandler
  publicApiKey: RequestHandler
}

export interface RateLimiterConfig {
  globalMax: number
  authMax: number
}

function userScopeKey(req: Request): string {
  return req.workosUserId || getClientIp(req, "unknown")
}

export function createRateLimiters(config: RateLimiterConfig): RateLimiterSet {
  return {
    globalBaseline: createRateLimit({
      name: "global",
      windowMs: 60_000,
      max: config.globalMax,
      key: (req) => getClientIp(req, "unknown"),
    }),

    auth: createRateLimit({
      name: "auth",
      windowMs: 60_000,
      max: config.authMax,
      key: (req) => getClientIp(req, "unknown"),
    }),

    search: createRateLimit({
      name: "search",
      windowMs: 60_000,
      max: 30,
      key: userScopeKey,
    }),

    upload: createRateLimit({
      name: "upload",
      windowMs: 60_000,
      max: 20,
      key: userScopeKey,
    }),

    messageCreate: createRateLimit({
      name: "message-create",
      windowMs: 60_000,
      max: 120,
      key: userScopeKey,
    }),

    commandDispatch: createRateLimit({
      name: "command-dispatch",
      windowMs: 60_000,
      max: 30,
      key: userScopeKey,
    }),

    // Public API rate limiters run BEFORE auth middleware, so use
    // req.params (populated by Express route matching) and the raw
    // Authorization header instead of req.workspaceId / req.apiKey.
    publicApiWorkspace: createRateLimit({
      name: "public-api-workspace",
      windowMs: 60_000,
      max: 600,
      key: (req) => req.params.workspaceId || getClientIp(req, "unknown"),
    }),

    publicApiKey: createRateLimit({
      name: "public-api-key",
      windowMs: 60_000,
      max: 60,
      key: (req) => {
        const authHeader = req.headers.authorization
        if (authHeader?.startsWith("Bearer ")) {
          return `apikey:${authHeader.slice(7)}`
        }
        return getClientIp(req, "unknown")
      },
    }),
  }
}
