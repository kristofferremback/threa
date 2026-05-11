import type { LinearClient } from "../../../workspace-integrations"

export interface LinearToolDeps {
  workspaceId: string
  /**
   * Resolve the workspace's Linear client. Callers should memoize so a single
   * agent turn doesn't re-fetch integration credentials on every tool call.
   */
  getClient: () => Promise<LinearClient | null>
}
