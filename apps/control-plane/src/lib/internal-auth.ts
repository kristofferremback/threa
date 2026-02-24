import type { Request, Response, NextFunction } from "express"

export function createInternalAuthMiddleware(internalApiKey: string) {
  return function internalAuth(req: Request, res: Response, next: NextFunction) {
    const provided = req.headers["x-internal-api-key"]
    if (typeof provided !== "string" || provided !== internalApiKey) {
      return res.status(401).json({ error: "Invalid or missing internal API key" })
    }
    next()
  }
}
