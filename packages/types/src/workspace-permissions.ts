/**
 * Workspace authorization catalog — single source of truth for the WorkOS
 * dashboard, regional permission middleware, and API-key scope validation.
 *
 * Slugs flow through three places that must stay in sync:
 *   1. WorkOS Authorization > Permissions and Authorization > Roles
 *      (managed by `scripts/sync-workos-permissions.ts`).
 *   2. Regional `requireWorkspacePermission(slug)` middleware reading from the
 *      WorkOS session JWT (`req.workosPermissions`) or the API-key clamp path.
 *   3. API-key scope picker on the frontend.
 *
 * Phase 2 of the WorkOS authz rollout uses this catalog to enforce permissions
 * end-to-end. Phase 1 only sources permissions from `API_KEY_PERMISSIONS`,
 * which is now a re-export of `WORKSPACE_PERMISSIONS` so the two cannot drift.
 */

export const WORKSPACE_PERMISSION_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
  STREAMS_READ: "streams:read",
  MESSAGES_READ: "messages:read",
  MESSAGES_WRITE: "messages:write",
  USERS_READ: "users:read",
  MEMOS_READ: "memos:read",
  ATTACHMENTS_READ: "attachments:read",
  ATTACHMENTS_WRITE: "attachments:write",
  BOTS_CREATE_PERSONAL: "bots:create:personal",
  BOTS_CREATE_SHARED: "bots:create:shared",
  BOTS_MANAGE: "bots:manage",
  MEMBERS_WRITE: "members:write",
  WORKSPACE_ADMIN: "workspace:admin",
  WORKSPACE_OWNER: "workspace:owner",
} as const

export type WorkspacePermissionSlug = (typeof WORKSPACE_PERMISSION_SCOPES)[keyof typeof WORKSPACE_PERMISSION_SCOPES]

export interface WorkspacePermission {
  slug: WorkspacePermissionSlug
  name: string
  description: string
}

/**
 * The full permission catalog. Order is the wire ordering used by the WorkOS
 * sync script and the frontend scope picker.
 */
export const WORKSPACE_PERMISSIONS: WorkspacePermission[] = [
  {
    slug: WORKSPACE_PERMISSION_SCOPES.MESSAGES_SEARCH,
    name: "Search messages",
    description:
      "Grants access to search messages in public streams in a workspace. Application level stream grants can extend permissions to private streams.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.STREAMS_READ,
    name: "Read streams",
    description: "Grants access to list and search accessible streams in a workspace.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ,
    name: "Read messages",
    description: "Grants access to read messages in accessible streams.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE,
    name: "Write messages",
    description: "Grants access to send, update, and delete messages in accessible streams.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.USERS_READ,
    name: "Read users",
    description: "Grants access to list and search workspace users.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.MEMOS_READ,
    name: "Read memos",
    description: "Grants access to search preserved workspace memos and inspect their provenance.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_READ,
    name: "Read attachments",
    description: "Grants access to search accessible attachments, inspect extracted content, and fetch download URLs.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_WRITE,
    name: "Upload attachments",
    description: "Grants access to upload and replace attachments in accessible streams.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_PERSONAL,
    name: "Create personal bots",
    description:
      "Grants access to create personal bots that act on the creator's behalf. Revoke this on the member role to lock down personal bot creation.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_SHARED,
    name: "Create shared bots",
    description: "Grants access to create workspace-owned bots that represent the workspace rather than a person.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.BOTS_MANAGE,
    name: "Manage bots",
    description: "Grants access to edit, archive, restore, and rotate keys for any bot in the workspace.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE,
    name: "Manage members",
    description:
      "Grants access to invite members and change admin/member roles. Owner role changes still require Manage workspace owners.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.WORKSPACE_ADMIN,
    name: "Administer workspace",
    description: "Grants access to workspace-wide admin surfaces such as integrations and AI budget configuration.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.WORKSPACE_OWNER,
    name: "Manage workspace owners",
    description:
      "Grants access to ownership-only operations: promoting or demoting an owner, transferring ownership, and deleting the workspace.",
  },
]

export const WORKSPACE_ROLE_SLUGS = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const

export type WorkspaceRoleSlug = (typeof WORKSPACE_ROLE_SLUGS)[keyof typeof WORKSPACE_ROLE_SLUGS]

export interface WorkspaceRoleDefinition {
  slug: WorkspaceRoleSlug
  name: string
  description: string
  permissions: WorkspacePermissionSlug[]
}

const READ_AND_SELF_SERVE: WorkspacePermissionSlug[] = [
  WORKSPACE_PERMISSION_SCOPES.MESSAGES_SEARCH,
  WORKSPACE_PERMISSION_SCOPES.STREAMS_READ,
  WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ,
  WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE,
  WORKSPACE_PERMISSION_SCOPES.USERS_READ,
  WORKSPACE_PERMISSION_SCOPES.MEMOS_READ,
  WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_READ,
  WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_WRITE,
  WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_PERSONAL,
]

const ADMIN_ADDITIONS: WorkspacePermissionSlug[] = [
  WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_SHARED,
  WORKSPACE_PERMISSION_SCOPES.BOTS_MANAGE,
  WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE,
  WORKSPACE_PERMISSION_SCOPES.WORKSPACE_ADMIN,
]

export const WORKSPACE_ROLE_DEFINITIONS: WorkspaceRoleDefinition[] = [
  {
    slug: WORKSPACE_ROLE_SLUGS.OWNER,
    name: "Owner",
    description: "Full workspace administration including ownership transfer and workspace deletion.",
    permissions: [...READ_AND_SELF_SERVE, ...ADMIN_ADDITIONS, WORKSPACE_PERMISSION_SCOPES.WORKSPACE_OWNER],
  },
  {
    slug: WORKSPACE_ROLE_SLUGS.ADMIN,
    name: "Admin",
    description: "Manage members, bots, integrations, and workspace settings. Cannot transfer ownership.",
    permissions: [...READ_AND_SELF_SERVE, ...ADMIN_ADDITIONS],
  },
  {
    slug: WORKSPACE_ROLE_SLUGS.MEMBER,
    name: "Member",
    description: "Default workspace member: read access plus self-serve writes (messages, attachments, personal bots).",
    permissions: [...READ_AND_SELF_SERVE],
  },
]

/** Lookup table for `req.workosPermissions` defaulting and tests. */
export function permissionsForRole(slug: WorkspaceRoleSlug): WorkspacePermissionSlug[] {
  const definition = WORKSPACE_ROLE_DEFINITIONS.find((r) => r.slug === slug)
  if (!definition) {
    throw new Error(`Unknown workspace role: ${slug}`)
  }
  return [...definition.permissions]
}
