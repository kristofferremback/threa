import { api } from "./client"
import type { GitHubWorkspaceIntegration, LinearWorkspaceIntegration } from "@threa/types"

export interface GitHubIntegrationResponse {
  configured: boolean
  integration: GitHubWorkspaceIntegration | null
}

export interface LinearIntegrationResponse {
  configured: boolean
  integration: LinearWorkspaceIntegration | null
}

export const integrationsApi = {
  async getGithub(workspaceId: string): Promise<GitHubIntegrationResponse> {
    return api.get<GitHubIntegrationResponse>(`/api/workspaces/${workspaceId}/integrations/github`)
  },

  async disconnectGithub(workspaceId: string): Promise<void> {
    await api.delete(`/api/workspaces/${workspaceId}/integrations/github`)
  },

  async getLinear(workspaceId: string): Promise<LinearIntegrationResponse> {
    return api.get<LinearIntegrationResponse>(`/api/workspaces/${workspaceId}/integrations/linear`)
  },

  async disconnectLinear(workspaceId: string): Promise<void> {
    await api.delete(`/api/workspaces/${workspaceId}/integrations/linear`)
  },
}
