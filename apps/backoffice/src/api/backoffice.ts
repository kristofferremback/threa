import { api } from "./client"

/**
 * Typed fetchers + query keys for the `/api/backoffice/*` surface. Keeping all
 * of them in one place lets pages import a single module and lets query keys
 * stay colocated with the fetchers that produce them.
 */

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  region: string
  createdByWorkosUserId: string
  workosOrganizationId: string | null
  memberCount: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceOwnerSummary {
  workosUserId: string
  email: string | null
  name: string | null
}

export interface WorkspaceDetail extends WorkspaceSummary {
  owner: WorkspaceOwnerSummary
}

export interface WorkspaceRef {
  id: string
  name: string
  slug: string
}

export interface WorkspaceOwnerInvitation {
  id: string
  email: string
  state: "pending" | "accepted" | "revoked" | "expired"
  acceptedAt: string | null
  revokedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  workspaces: WorkspaceRef[]
}

export const backofficeKeys = {
  workspaces: ["backoffice", "workspaces"] as const,
  workspace: (id: string) => ["backoffice", "workspaces", id] as const,
  invitations: ["backoffice", "invitations"] as const,
}

export function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return api.get<{ workspaces: WorkspaceSummary[] }>("/api/backoffice/workspaces").then((r) => r.workspaces)
}

export function getWorkspace(id: string): Promise<WorkspaceDetail> {
  return api
    .get<{ workspace: WorkspaceDetail }>(`/api/backoffice/workspaces/${encodeURIComponent(id)}`)
    .then((r) => r.workspace)
}

export function listWorkspaceOwnerInvitations(): Promise<WorkspaceOwnerInvitation[]> {
  return api
    .get<{ invitations: WorkspaceOwnerInvitation[] }>("/api/backoffice/workspace-owner-invitations")
    .then((r) => r.invitations)
}

export function createWorkspaceOwnerInvitation(email: string): Promise<WorkspaceOwnerInvitation> {
  return api
    .post<{ invitation: WorkspaceOwnerInvitation }>("/api/backoffice/workspace-owner-invitations", {
      email,
    })
    .then((r) => r.invitation)
}

export function resendWorkspaceOwnerInvitation(id: string): Promise<WorkspaceOwnerInvitation> {
  return api
    .post<{
      invitation: WorkspaceOwnerInvitation
    }>(`/api/backoffice/workspace-owner-invitations/${encodeURIComponent(id)}/resend`)
    .then((r) => r.invitation)
}

export function revokeWorkspaceOwnerInvitation(id: string): Promise<void> {
  return api.post<void>(`/api/backoffice/workspace-owner-invitations/${encodeURIComponent(id)}/revoke`)
}
