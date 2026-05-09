import {
  WORKSPACE_PERMISSION_SCOPES,
  WORKSPACE_PERMISSIONS,
  type WorkspacePermission,
  type WorkspacePermissionSlug,
} from "./workspace-permissions"

/**
 * API-key scopes are a subset of the unified workspace permission catalog
 * (`packages/types/src/workspace-permissions.ts`). Persisted API keys store a
 * subset of these slugs and are clamped at request time against the owner's
 * current workspace permissions in the regional middleware.
 */
export const API_KEY_SCOPES = WORKSPACE_PERMISSION_SCOPES

export type ApiKeyScope = WorkspacePermissionSlug

export type ApiKeyPermission = WorkspacePermission

/**
 * Human-readable permission definitions used by the WorkOS sync script and the
 * API-key UI. Re-exported from the unified catalog so the two cannot drift.
 *
 * WorkOS setup: Authorization > Configuration > Organization API key permissions
 */
export const API_KEY_PERMISSIONS: ApiKeyPermission[] = WORKSPACE_PERMISSIONS

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
