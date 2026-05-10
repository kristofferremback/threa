import type { WorkspacePermissionSlug } from "./workspace-permissions"

// API-key scopes draw from the same catalog as workspace permissions; persisted
// keys are clamped at request time against the owner's effective workspace
// permissions in the regional middleware.

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
  scopes: WorkspacePermissionSlug[]
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
  scopes: WorkspacePermissionSlug[]
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
