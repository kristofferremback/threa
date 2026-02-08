import type { NextFunction, Request, RequestHandler, Response } from "express"

interface RateLimitBucket {
  count: number
  resetAt: number
}

interface RateLimitOptions {
  name: string
  windowMs: number
  max: number
  key: (req: Request) => string
  skip?: (req: Request) => boolean
}

interface RateLimiterSet {
  globalBaseline: RequestHandler
  auth: RequestHandler
  search: RequestHandler
  upload: RequestHandler
  messageCreate: RequestHandler
  commandDispatch: RequestHandler
  aiQuotaPerMember: RequestHandler
}

function parsePositiveEnvInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"]
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim()
  }
  return req.ip || "unknown"
}

function setRateLimitHeaders(res: Response, max: number, remaining: number, resetAt: number): void {
  const secondsUntilReset = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))
  res.setHeader("RateLimit-Limit", String(max))
  res.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)))
  res.setHeader("RateLimit-Reset", String(secondsUntilReset))
}

function cleanupExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number): void {
  if (buckets.size < 10_000) return
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>()

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (options.skip?.(req)) {
      return next()
    }

    const now = Date.now()
    cleanupExpiredBuckets(buckets, now)

    const bucketKey = `${options.name}:${options.key(req)}`
    const existing = buckets.get(bucketKey)
    const bucket: RateLimitBucket =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + options.windowMs,
          }

    if (bucket.count >= options.max) {
      setRateLimitHeaders(res, options.max, 0, bucket.resetAt)
      res.status(429).json({
        error: "Rate limit exceeded",
        limit: options.max,
        windowMs: options.windowMs,
      })
      return
    }

    bucket.count += 1
    buckets.set(bucketKey, bucket)
    setRateLimitHeaders(res, options.max, options.max - bucket.count, bucket.resetAt)
    next()
  }
}

function userScopeKey(req: Request): string {
  return req.userId || getClientIp(req)
}

function workspaceMemberScopeKey(req: Request): string {
  const workspaceId = req.workspaceId || "unknown-workspace"
  const memberId = req.member?.id || req.userId || getClientIp(req)
  return `${workspaceId}:${memberId}`
}

export function createRateLimiters(): RateLimiterSet {
  const globalMax = parsePositiveEnvInt("GLOBAL_RATE_LIMIT_MAX", 300)

  return {
    // Baseline abuse protection across all API endpoints.
    globalBaseline: createRateLimit({
      name: "global",
      windowMs: 60_000,
      max: globalMax,
      key: (req) => getClientIp(req),
      skip: (req) => req.path === "/health" || req.path === "/metrics",
    }),

    // Auth endpoints are brute-force targets.
    auth: createRateLimit({
      name: "auth",
      windowMs: 60_000,
      max: 20,
      key: (req) => getClientIp(req),
    }),

    // Search can be expensive and is easy to scrape.
    search: createRateLimit({
      name: "search",
      windowMs: 60_000,
      max: 30,
      key: userScopeKey,
    }),

    // Uploads are write-heavy and expensive.
    upload: createRateLimit({
      name: "upload",
      windowMs: 60_000,
      max: 20,
      key: userScopeKey,
    }),

    // Message creation can fan out to outbox, embeddings, and agent flows.
    messageCreate: createRateLimit({
      name: "message-create",
      windowMs: 60_000,
      max: 120,
      key: userScopeKey,
    }),

    // Explicit command dispatch can trigger expensive background execution.
    commandDispatch: createRateLimit({
      name: "command-dispatch",
      windowMs: 60_000,
      max: 30,
      key: userScopeKey,
    }),

    // Workspace/member quota for expensive AI-triggering paths.
    aiQuotaPerMember: createRateLimit({
      name: "ai-quota-member",
      windowMs: 60_000,
      max: 40,
      key: workspaceMemberScopeKey,
    }),
  }
}
