export const WORKSPACE_PERMISSION_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
  STREAMS_READ: "streams:read",
  MESSAGES_READ: "messages:read",
  MESSAGES_WRITE: "messages:write",
  USERS_READ: "users:read",
  MEMOS_READ: "memos:read",
  ATTACHMENTS_READ: "attachments:read",
  MEMBERS_WRITE: "members:write",
  WORKSPACE_ADMIN: "workspace:admin",
} as const

export type WorkspacePermissionScope = (typeof WORKSPACE_PERMISSION_SCOPES)[keyof typeof WORKSPACE_PERMISSION_SCOPES]

export interface WorkspacePermission {
  slug: WorkspacePermissionScope
  name: string
  description: string
}

/**
 * Human-readable workspace permission definitions.
 * Used in the UI and as the source of truth for WorkOS dashboard configuration.
 *
 * WorkOS setup: Authorization > Configuration > Organization API key permissions
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
    slug: WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE,
    name: "Manage members",
    description: "Grants access to invite users, manage workspace memberships, and update member roles.",
  },
  {
    slug: WORKSPACE_PERMISSION_SCOPES.WORKSPACE_ADMIN,
    name: "Administer workspace",
    description: "Grants access to workspace-wide administration such as integrations, bots, and budgets.",
  },
]

export const API_KEY_SCOPES = {
  MESSAGES_SEARCH: WORKSPACE_PERMISSION_SCOPES.MESSAGES_SEARCH,
  STREAMS_READ: WORKSPACE_PERMISSION_SCOPES.STREAMS_READ,
  MESSAGES_READ: WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ,
  MESSAGES_WRITE: WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE,
  USERS_READ: WORKSPACE_PERMISSION_SCOPES.USERS_READ,
  MEMOS_READ: WORKSPACE_PERMISSION_SCOPES.MEMOS_READ,
  ATTACHMENTS_READ: WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_READ,
} as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES]

export interface ApiKeyPermission extends Omit<WorkspacePermission, "slug"> {
  slug: ApiKeyScope
}

const API_KEY_SCOPE_SET = new Set<ApiKeyScope>(Object.values(API_KEY_SCOPES))

/**
 * Compatibility alias during the rollout to the shared workspace permission catalog.
 * Keep API key surfaces limited to the existing public scope set.
 */
export const API_KEY_PERMISSIONS: ApiKeyPermission[] = WORKSPACE_PERMISSIONS.filter((permission) =>
  API_KEY_SCOPE_SET.has(permission.slug as ApiKeyScope)
) as ApiKeyPermission[]

// --- User-scoped API keys ---

/** Prefix for sentVia field on messages created through user-scoped API keys */
export const SENT_VIA_API_PREFIX = "api_key:" as const

/** Build the sentVia value for a user-scoped API key */
export function sentViaApiKey(keyId: string): string {
  return `${SENT_VIA_API_PREFIX}${keyId}`
}

/** Check if a sentVia value indicates it was sent via a user-scoped API key */
export function isSentViaApi(sentVia: string | null): boolean {
  return sentVia != null && sentVia.startsWith(SENT_VIA_API_PREFIX)
}

/** Wire format for user API keys (returned to frontend, key value never included) */
export interface UserApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: ApiKeyScope[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** Response when creating a user API key (includes the full key value once) */
export interface CreateUserApiKeyResponse {
  key: UserApiKey
  /** The full API key value. Only returned on creation — store it securely. */
  value: string
}

// --- Bot API keys ---

export const BOT_KEY_PREFIX = "threa_bk_" as const

/** Wire format for bot API keys (returned to frontend, key value never included) */
export interface BotApiKey {
  id: string
  botId: string
  name: string
  keyPrefix: string
  scopes: ApiKeyScope[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** Response when creating a bot API key (includes the full key value once) */
export interface CreateBotApiKeyResponse {
  key: BotApiKey
  /** The full API key value. Only returned on creation — store it securely. */
  value: string
}
