import type { GitHubClient } from "../../../workspace-integrations"
import { logger } from "../../../../lib/logger"
import type { AgentToolResult } from "../../runtime"
import type { GitHubToolDeps } from "./deps"

export interface GitHubToolError {
  error: string
  code:
    | "GITHUB_NOT_CONNECTED"
    | "GITHUB_RATE_LIMITED"
    | "GITHUB_NOT_FOUND"
    | "GITHUB_FORBIDDEN"
    | "GITHUB_REQUEST_FAILED"
}

export async function withGithubClient<T>(
  deps: GitHubToolDeps,
  fn: (client: GitHubClient) => Promise<T>
): Promise<T | GitHubToolError> {
  const client = await deps.workspaceIntegrationService.getGithubClient(deps.workspaceId)
  if (!client) {
    return {
      error:
        "GitHub is not connected for this workspace, or the installation has hit its API rate limit. Ask a workspace admin to connect GitHub from workspace settings.",
      code: "GITHUB_NOT_CONNECTED",
    }
  }
  try {
    return await fn(client)
  } catch (err) {
    return mapGithubError(err, deps)
  }
}

export function toToolResult(result: unknown): AgentToolResult {
  return { output: JSON.stringify(result) }
}

function mapGithubError(err: unknown, deps: GitHubToolDeps): GitHubToolError {
  const status = getStatus(err)
  if (status === 404) {
    return { error: "GitHub resource not found", code: "GITHUB_NOT_FOUND" }
  }
  if (status === 403 || status === 401) {
    logger.warn({ err, workspaceId: deps.workspaceId }, "GitHub API forbidden or auth failed")
    return {
      error: "GitHub denied the request. The installation may lack permission for this resource.",
      code: "GITHUB_FORBIDDEN",
    }
  }
  if (status === 429 || (status !== null && isRateLimitError(err))) {
    return { error: "GitHub API rate limit exceeded. Try again later.", code: "GITHUB_RATE_LIMITED" }
  }
  logger.error({ err, workspaceId: deps.workspaceId }, "GitHub tool request failed")
  const message = err instanceof Error ? err.message : "Unknown error"
  return { error: `GitHub request failed: ${message}`, code: "GITHUB_REQUEST_FAILED" }
}

function getStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null
  const status = (err as { status?: unknown }).status
  return typeof status === "number" ? status : null
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const message = (err as { message?: unknown }).message
  return typeof message === "string" && /rate limit/i.test(message)
}

export function isGitHubToolError(value: unknown): value is GitHubToolError {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    "code" in value &&
    typeof (value as GitHubToolError).code === "string" &&
    (value as GitHubToolError).code.startsWith("GITHUB_")
  )
}
