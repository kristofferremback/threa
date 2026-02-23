import type { NextFunction, Request, Response } from "express"

/**
 * Middleware that validates inter-service requests using a shared secret.
 * The control-plane sends X-Internal-Api-Key on calls to regional backends.
 */
export function createInternalAuthMiddleware(internalApiKey: string) {
  return function internalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const provided = req.headers["x-internal-api-key"]
    if (typeof provided !== "string" || provided !== internalApiKey) {
      res.status(401).json({ error: "Invalid or missing internal API key" })
      return
    }
    next()
  }
}
