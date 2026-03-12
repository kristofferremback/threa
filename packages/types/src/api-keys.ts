export const API_KEY_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
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
]
