import type { Request, Response, NextFunction } from "express"
import { HttpError } from "./errors"

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  next(err)
}
