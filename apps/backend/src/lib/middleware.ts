import type { z } from "zod"
import type { Request, Response, NextFunction, RequestHandler } from "express"

declare global {
  namespace Express {
    interface Request {
      validated?: unknown
    }
  }
}

export function compose(...middlewares: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    const run = (i: number): void => {
      if (i >= middlewares.length) return next()
      middlewares[i](req, res, (err) => {
        if (err) return next(err)
        run(i + 1)
      })
    }
    run(0)
  }
}

export function validate<T>(schema: z.ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      })
    }
    req.validated = result.data
    next()
  }
}
