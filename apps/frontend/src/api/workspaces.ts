import { api } from "./client"
import type {
  Workspace,
  WorkspaceBootstrap,
  WorkspaceMember,
  CreateWorkspaceInput,
  CompleteMemberSetupInput,
} from "@threa/types"

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

  async completeMemberSetup(workspaceId: string, data: CompleteMemberSetupInput): Promise<WorkspaceMember> {
    const res = await api.post<{ member: WorkspaceMember }>(`/api/workspaces/${workspaceId}/setup`, data)
    return res.member
  },

  async checkSlugAvailable(workspaceId: string, slug: string): Promise<boolean> {
    const res = await api.get<{ available: boolean }>(
      `/api/workspaces/${workspaceId}/slug-available?slug=${encodeURIComponent(slug)}`
    )
    return res.available
  },

  async updateProfile(
    workspaceId: string,
    data: { name?: string; description?: string | null }
  ): Promise<WorkspaceMember> {
    const res = await api.patch<{ member: WorkspaceMember }>(`/api/workspaces/${workspaceId}/profile`, data)
    return res.member
  },

  async uploadAvatar(workspaceId: string, file: File): Promise<WorkspaceMember> {
    const formData = new FormData()
    formData.append("avatar", file)

    const response = await fetch(`/api/workspaces/${workspaceId}/profile/avatar`, {
      method: "POST",
      body: formData,
      credentials: "include",
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const errorMessage = typeof body.error === "string" ? body.error : body.error?.message || "Upload failed"
      throw new Error(errorMessage)
    }

    const body = await response.json()
    return body.member
  },

  async removeAvatar(workspaceId: string): Promise<WorkspaceMember> {
    const res = await api.delete<{ member: WorkspaceMember }>(`/api/workspaces/${workspaceId}/profile/avatar`)
    return res.member
  },
}
