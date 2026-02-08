import rateLimit, { type Options, ipKeyGenerator } from "express-rate-limit"

const isTest = process.env.NODE_ENV === "test"

function ipKey(ip: string | undefined): string {
  return ip ? ipKeyGenerator(ip) : "unknown"
}

const shared: Partial<Options> = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  skip: isTest ? () => true : undefined,
}

/** Strict: auth endpoints — prevent brute force */
export const authRateLimit = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  keyGenerator: (req) => ipKey(req.ip),
  message: { error: "Too many authentication attempts, please try again later" },
})

/** AI: expensive LLM-triggering flows — prevent cost abuse */
export const aiRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  keyGenerator: (req) => req.userId ?? ipKey(req.ip),
  message: { error: "Too many AI requests, please try again later" },
})

/** Standard: write operations — prevent spam */
export const standardRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  keyGenerator: (req) => req.userId ?? ipKey(req.ip),
  message: { error: "Too many requests, please try again later" },
})

/** Relaxed: read-only endpoints */
export const relaxedRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  keyGenerator: (req) => req.userId ?? ipKey(req.ip),
  message: { error: "Too many requests, please try again later" },
})
