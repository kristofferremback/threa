import type { WorkspaceIntegrationService } from "../../../workspace-integrations"

export interface GitHubToolDeps {
  workspaceId: string
  workspaceIntegrationService: WorkspaceIntegrationService
}
