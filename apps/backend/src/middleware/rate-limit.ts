import rateLimit from "express-rate-limit"

/** Strict: auth endpoints — prevent brute force */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "Too many authentication attempts, please try again later" },
})

/** AI: expensive LLM-triggering flows — prevent cost abuse */
export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Too many AI requests, please try again later" },
})

/** Standard: write operations — prevent spam */
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Too many requests, please try again later" },
})

/** Relaxed: read-only endpoints */
export const relaxedRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Too many requests, please try again later" },
})
