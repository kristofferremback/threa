export const API_KEY_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
  STREAMS_READ: "streams:read",
  MESSAGES_READ: "messages:read",
  MESSAGES_WRITE: "messages:write",
  USERS_READ: "users:read",
} as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES]

export interface ApiKeyPermission {
  slug: ApiKeyScope
  name: string
  description: string
}

/**
 * Human-readable permission definitions for API keys.
 * Used in the UI and as the source of truth for WorkOS dashboard configuration.
 *
 * WorkOS setup: Authorization > Configuration > Organization API key permissions
 */
export const API_KEY_PERMISSIONS: ApiKeyPermission[] = [
  {
    slug: API_KEY_SCOPES.MESSAGES_SEARCH,
    name: "Search messages",
    description:
      "Grants access to search messages in public streams in a workspace. Application level stream grants can extend permissions to private streams.",
  },
  {
    slug: API_KEY_SCOPES.STREAMS_READ,
    name: "Read streams",
    description: "Grants access to list and search accessible streams in a workspace.",
  },
  {
    slug: API_KEY_SCOPES.MESSAGES_READ,
    name: "Read messages",
    description: "Grants access to read messages in accessible streams.",
  },
  {
    slug: API_KEY_SCOPES.MESSAGES_WRITE,
    name: "Write messages",
    description: "Grants access to send, update, and delete messages in accessible streams.",
  },
  {
    slug: API_KEY_SCOPES.USERS_READ,
    name: "Read users",
    description: "Grants access to list and search workspace users.",
  },
]

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
