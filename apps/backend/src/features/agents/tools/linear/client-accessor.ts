import type { LinearClient, WorkspaceIntegrationService } from "../../../workspace-integrations"
import { LinearApiError } from "../../../workspace-integrations"
import { logger } from "../../../../lib/logger"
import type { AgentToolResult } from "../../runtime"
import type { LinearToolDeps } from "./deps"

export interface LinearToolError {
  error: string
  code:
    | "LINEAR_NOT_CONNECTED"
    | "LINEAR_RATE_LIMITED"
    | "LINEAR_NOT_FOUND"
    | "LINEAR_FORBIDDEN"
    | "LINEAR_REQUEST_FAILED"
}

export async function withLinearClient<T>(
  deps: LinearToolDeps,
  fn: (client: LinearClient) => Promise<T>
): Promise<T | LinearToolError> {
  try {
    const client = await deps.getClient()
    if (!client) {
      return {
        error:
          "Linear is not connected for this workspace, or the installation has hit its API rate limit. Ask a workspace admin to connect Linear from workspace settings.",
        code: "LINEAR_NOT_CONNECTED",
      }
    }
    return await fn(client)
  } catch (err) {
    return mapLinearError(err, deps)
  }
}

export function createMemoizedLinearClient(
  service: WorkspaceIntegrationService,
  workspaceId: string
): () => Promise<LinearClient | null> {
  let cached: Promise<LinearClient | null> | null = null
  return async () => {
    if (cached === null) cached = service.getLinearClient(workspaceId)
    try {
      return await cached
    } catch (err) {
      cached = null
      throw err
    }
  }
}

export function toToolResult(result: unknown): AgentToolResult {
  return { output: JSON.stringify(result) }
}

function mapLinearError(err: unknown, deps: LinearToolDeps): LinearToolError {
  if (LinearApiError.isNotFound(err)) {
    return { error: "Linear resource not found", code: "LINEAR_NOT_FOUND" }
  }
  if (LinearApiError.isRateLimited(err)) {
    return { error: "Linear API rate limit exceeded. Try again later.", code: "LINEAR_RATE_LIMITED" }
  }
  if (LinearApiError.isUnauthorized(err)) {
    logger.warn({ err, workspaceId: deps.workspaceId }, "Linear API auth failed")
    return {
      error: "Linear denied the request. The workspace integration may need to be reconnected.",
      code: "LINEAR_FORBIDDEN",
    }
  }
  logger.error({ err, workspaceId: deps.workspaceId }, "Linear tool request failed")
  const message = err instanceof Error ? err.message : "Unknown error"
  return { error: `Linear request failed: ${message}`, code: "LINEAR_REQUEST_FAILED" }
}

export function isLinearToolError(value: unknown): value is LinearToolError {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    "code" in value &&
    typeof (value as LinearToolError).code === "string" &&
    (value as LinearToolError).code.startsWith("LINEAR_")
  )
}
