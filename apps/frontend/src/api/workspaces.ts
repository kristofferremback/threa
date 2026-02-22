import { api } from "./client"
import type { Workspace, WorkspaceBootstrap, User, CreateWorkspaceInput, CompleteMemberSetupInput } from "@threa/types"

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

  async completeUserSetup(workspaceId: string, data: CompleteMemberSetupInput): Promise<User> {
    const res = await api.post<{ user?: User; member?: User }>(`/api/workspaces/${workspaceId}/setup`, data)
    if (!res.user && !res.member) {
      throw new Error("Setup response missing user payload")
    }
    return res.user ?? res.member!
  },

  async checkSlugAvailable(workspaceId: string, slug: string): Promise<boolean> {
    const res = await api.get<{ available: boolean }>(
      `/api/workspaces/${workspaceId}/slug-available?slug=${encodeURIComponent(slug)}`
    )
    return res.available
  },

  async updateProfile(workspaceId: string, data: { name?: string; description?: string | null }): Promise<User> {
    const res = await api.patch<{ user?: User; member?: User }>(`/api/workspaces/${workspaceId}/profile`, data)
    if (!res.user && !res.member) {
      throw new Error("Profile response missing user payload")
    }
    return res.user ?? res.member!
  },

  async uploadAvatar(workspaceId: string, file: File): Promise<User> {
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
    return body.user ?? body.member
  },

  async removeAvatar(workspaceId: string): Promise<User> {
    const res = await api.delete<{ user?: User; member?: User }>(`/api/workspaces/${workspaceId}/profile/avatar`)
    if (!res.user && !res.member) {
      throw new Error("Avatar response missing user payload")
    }
    return res.user ?? res.member!
  },

  // Backward-compatible alias while call sites migrate.
  completeMemberSetup(workspaceId: string, data: CompleteMemberSetupInput) {
    return this.completeUserSetup(workspaceId, data)
  },
}
