import type { Request, Response, NextFunction, RequestHandler } from "express"

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function compose(...middlewares: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    let i = 0

    const runNext = (err?: Error): void => {
      if (err) return next(err)
      if (i >= middlewares.length) return next()
      const middleware = middlewares[i++]
      middleware(req, res, runNext)
    }

    runNext()
  }
}
