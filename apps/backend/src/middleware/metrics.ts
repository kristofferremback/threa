import type { Request, Response, NextFunction } from "express"
import { httpRequestsTotal, httpRequestDuration, httpActiveConnections } from "../lib/observability"

/**
 * Map HTTP status code to error type label.
 */
function getErrorType(statusCode: number): string {
  if (statusCode < 400) return "-"
  if (statusCode === 401) return "not_authenticated"
  if (statusCode === 403) return "forbidden"
  if (statusCode === 404) return "not_found"
  if (statusCode < 500) return "client_error"
  return "server_error"
}

/**
 * Get normalized path from Express route with sorted query param names.
 *
 * Examples:
 * - /api/workspaces/:workspaceId/streams -> /api/workspaces/:workspaceId/streams
 * - With query ?limit=10&offset=0 -> /api/workspaces/:workspaceId/streams?limit&offset
 */
function getNormalizedPath(req: Request): string {
  // Use matched route pattern if available, otherwise use URL path
  const basePath = req.route?.path || req.path

  // Append sorted query param names (no values)
  const queryKeys = Object.keys(req.query).sort()
  if (queryKeys.length > 0) {
    return `${basePath}?${queryKeys.join("&")}`
  }

  return basePath
}

/**
 * Extract workspaceId from request params or return "-" for routes without workspace context.
 */
function getWorkspaceId(req: Request): string {
  return (req.params?.workspaceId as string) || "-"
}

/**
 * HTTP metrics middleware.
 *
 * Tracks:
 * - Active connections (inc on request, dec on response)
 * - Request count and duration with labels for method, path, status, error type, workspace
 *
 * Skips /health, /readyz, and /metrics endpoints entirely.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip probe and metrics endpoints entirely
  if (req.path === "/health" || req.path === "/readyz" || req.path === "/metrics") {
    return next()
  }

  const startTime = process.hrtime.bigint()
  httpActiveConnections.inc()

  // Intercept response finish to capture metrics
  // Using 'finish' event instead of overriding res.end to avoid TypeScript overload issues
  res.on("finish", () => {
    httpActiveConnections.dec()

    const durationNs = process.hrtime.bigint() - startTime
    const durationSeconds = Number(durationNs) / 1e9

    const normalizedPath = getNormalizedPath(req)
    const workspaceId = getWorkspaceId(req)
    const errorType = getErrorType(res.statusCode)

    const labels = {
      method: req.method,
      normalized_path: normalizedPath,
      status_code: res.statusCode.toString(),
      error_type: errorType,
      workspace_id: workspaceId,
    }

    httpRequestsTotal.inc(labels)
    httpRequestDuration.observe(labels, durationSeconds)
  })

  next()
}
