import { api } from "./client"
import type { Workspace, WorkspaceMember, Stream, StreamMember } from "@/types/domain"

// Bootstrap response - everything needed to render a workspace
export interface WorkspaceBootstrap {
  workspace: Workspace
  members: WorkspaceMember[]
  streams: Stream[]
  streamMemberships: StreamMember[]
}

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
    const res = await api.get<{ data: WorkspaceBootstrap }>(
      `/api/workspaces/${workspaceId}/bootstrap`
    )
    return res.data
  },

  async create(data: { name: string; slug?: string }): Promise<Workspace> {
    const res = await api.post<{ workspace: Workspace }>("/api/workspaces", data)
    return res.workspace
  },
}
