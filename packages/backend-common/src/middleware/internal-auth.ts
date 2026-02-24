import { timingSafeEqual } from "crypto"
import type { NextFunction, Request, Response } from "express"

/** Header name for inter-service authentication (control-plane ↔ regional backend). */
export const INTERNAL_API_KEY_HEADER = "X-Internal-Api-Key"

/**
 * Middleware that validates inter-service requests using a shared secret.
 * Uses timing-safe comparison to prevent side-channel leakage.
 */
export function createInternalAuthMiddleware(internalApiKey: string) {
  const expectedBuf = Buffer.from(internalApiKey)

  return function internalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const provided = req.headers[INTERNAL_API_KEY_HEADER.toLowerCase()]
    if (typeof provided !== "string") {
      res.status(401).json({ error: "Invalid or missing internal API key" })
      return
    }
    const providedBuf = Buffer.from(provided)
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      res.status(401).json({ error: "Invalid or missing internal API key" })
      return
    }
    next()
  }
}
