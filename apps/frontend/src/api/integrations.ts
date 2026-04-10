import { api } from "./client"
import type { GitHubWorkspaceIntegration } from "@threa/types"

export interface GitHubIntegrationResponse {
  configured: boolean
  integration: GitHubWorkspaceIntegration | null
}

export const integrationsApi = {
  async getGithub(workspaceId: string): Promise<GitHubIntegrationResponse> {
    return api.get<GitHubIntegrationResponse>(`/api/workspaces/${workspaceId}/integrations/github`)
  },

  async disconnectGithub(workspaceId: string): Promise<void> {
    await api.delete(`/api/workspaces/${workspaceId}/integrations/github`)
  },
}
