import type { GitHubClient } from "../../../workspace-integrations"

export interface GitHubToolDeps {
  workspaceId: string
  /**
   * Resolve the workspace's GitHub client. Callers should memoize so a single agent
   * turn doesn't re-fetch the integration record (and possibly refresh the token)
   * on every tool invocation.
   */
  getClient: () => Promise<GitHubClient | null>
}
