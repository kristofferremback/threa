import type { Request, Response, NextFunction } from "express"
import { logger } from "../lib/logger"

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error")

  res.status(500).json({ error: "Internal server error" })
}
