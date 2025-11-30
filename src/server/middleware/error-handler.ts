import type { Request, Response, NextFunction } from "express"
import { logger } from "../lib/logger"
import { isProduction } from "../config"

export interface ApiError {
  message: string
  statusCode: number
  code: string
  stack?: string
}

/**
 * Centralized error handling middleware
 * Formats errors consistently and logs appropriately
 */
export const createErrorHandler = () => {
  return (err: Error & Partial<ApiError>, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || 500
    const code = err.code || "INTERNAL_ERROR"

    // Log error details
    logger.error(
      {
        err,
        method: req.method,
        url: req.url,
        statusCode,
        code,
        user: req.user?.id,
      },
      "Request error",
    )

    // Don't leak internal error details in production
    const message =
      statusCode === 500 && isProduction
        ? "Internal server error"
        : err.message || "An error occurred"

    // Return simple error string for frontend compatibility
    res.status(statusCode).json({
      error: message,
      code,
      ...(!isProduction && { stack: err.stack }),
    })
  }
}

/**
 * Creates a standardized API error
 */
export class ApiError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode: number = 500, code: string = "INTERNAL_ERROR") {
    super(message)
    this.name = "ApiError"
    this.statusCode = statusCode
    this.code = code
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Common error creators
 */
export const errors = {
  badRequest: (message: string) => new ApiError(message, 400, "BAD_REQUEST"),
  unauthorized: (message: string = "Unauthorized") => new ApiError(message, 401, "UNAUTHORIZED"),
  forbidden: (message: string = "Forbidden") => new ApiError(message, 403, "FORBIDDEN"),
  notFound: (message: string = "Not found") => new ApiError(message, 404, "NOT_FOUND"),
  conflict: (message: string) => new ApiError(message, 409, "CONFLICT"),
  internal: (message: string = "Internal server error") => new ApiError(message, 500, "INTERNAL_ERROR"),
}
