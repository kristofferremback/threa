import { timingSafeEqual } from "crypto"
import type { NextFunction, Request, Response } from "express"

/**
 * Middleware that validates inter-service requests using a shared secret.
 * The control-plane sends X-Internal-Api-Key on calls to regional backends.
 * Uses timing-safe comparison to prevent side-channel leakage.
 */
export function createInternalAuthMiddleware(internalApiKey: string) {
  const expectedBuf = Buffer.from(internalApiKey)

  return function internalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const provided = req.headers["x-internal-api-key"]
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
