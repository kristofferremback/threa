import { api } from "./client"
import type { Workspace, WorkspaceBootstrap, CreateWorkspaceInput } from "@threa/types"

export type { WorkspaceBootstrap, CreateWorkspaceInput }

export const workspacesApi = {
  async list(): Promise<Workspace[]> {
    const res = await api.get<{ workspaces: Workspace[] }>("/api/workspaces")
    return res.workspaces
  },

  async get(workspaceId: string): Promise<Workspace> {
    const res = await api.get<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}`)
    return res.workspace
  },

  async bootstrap(workspaceId: string): Promise<WorkspaceBootstrap> {
    const res = await api.get<{ data: WorkspaceBootstrap }>(`/api/workspaces/${workspaceId}/bootstrap`)
    return res.data
  },

  async create(data: CreateWorkspaceInput): Promise<Workspace> {
    const res = await api.post<{ workspace: Workspace }>("/api/workspaces", data)
    return res.workspace
  },

  async markAllAsRead(workspaceId: string): Promise<string[]> {
    const res = await api.post<{ updatedStreamIds: string[] }>(`/api/workspaces/${workspaceId}/streams/read-all`)
    return res.updatedStreamIds
  },
}
