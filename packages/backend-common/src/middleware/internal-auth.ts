import { timingSafeEqual } from "crypto"
import type { NextFunction, Request, Response } from "express"
import { HttpError } from "../errors"

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
      next(new HttpError("Invalid or missing internal API key", { status: 401, code: "UNAUTHORIZED" }))
      return
    }
    const providedBuf = Buffer.from(provided)
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      next(new HttpError("Invalid or missing internal API key", { status: 401, code: "UNAUTHORIZED" }))
      return
    }
    next()
  }
}
