import type { WorkspaceRole } from "./domain"

export interface WorkspaceAuthzSnapshotMembership {
  organizationMembershipId: string
  workosUserId: string
  roleSlugs: string[]
}

export interface WorkspaceAuthzSnapshot {
  workspaceId: string
  workosOrganizationId: string
  revision: string
  generatedAt: string
  roles: WorkspaceRole[]
  memberships: WorkspaceAuthzSnapshotMembership[]
}
