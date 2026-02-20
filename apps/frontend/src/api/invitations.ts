import { api } from "./client"
import type {
  WorkspaceInvitation,
  SendInvitationsInput,
  SendInvitationsResponse,
  SendWorkspaceCreationInvitationsInput,
  SendWorkspaceCreationInvitationsResponse,
} from "@threa/types"

export const invitationsApi = {
  async list(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const res = await api.get<{ invitations: WorkspaceInvitation[] }>(`/api/workspaces/${workspaceId}/invitations`)
    return res.invitations
  },

  async send(workspaceId: string, data: SendInvitationsInput): Promise<SendInvitationsResponse> {
    return api.post<SendInvitationsResponse>(`/api/workspaces/${workspaceId}/invitations`, data)
  },

  async revoke(workspaceId: string, invitationId: string): Promise<void> {
    await api.post(`/api/workspaces/${workspaceId}/invitations/${invitationId}/revoke`)
  },

  async resend(workspaceId: string, invitationId: string): Promise<WorkspaceInvitation> {
    const res = await api.post<{ invitation: WorkspaceInvitation }>(
      `/api/workspaces/${workspaceId}/invitations/${invitationId}/resend`
    )
    return res.invitation
  },

  async sendWorkspaceCreation(
    workspaceId: string,
    data: SendWorkspaceCreationInvitationsInput
  ): Promise<SendWorkspaceCreationInvitationsResponse> {
    return api.post<SendWorkspaceCreationInvitationsResponse>(
      `/api/workspaces/${workspaceId}/workspace-creation-invitations`,
      data
    )
  },
}
