import type { RequestHandler } from "express"

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
