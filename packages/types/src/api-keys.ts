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
