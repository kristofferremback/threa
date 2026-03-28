import { createHash, randomBytes, timingSafeEqual } from "crypto"
import type { Pool } from "pg"
import { UserApiKeyRepository, type UserApiKeyRow } from "./repository"
import { userApiKeyId } from "../../lib/id"
import { HttpError } from "../../lib/errors"
import type { ApiKeyScope } from "@threa/types"
import { API_KEY_SCOPES } from "@threa/types"

const KEY_PREFIX = "threa_uk_"
const KEY_BYTE_LENGTH = 32 // 256-bit random key
const STORED_PREFIX_LENGTH = 8 // chars stored for identification (after threa_uk_)

const ALL_SCOPES = new Set(Object.values(API_KEY_SCOPES))
const MAX_ACTIVE_KEYS_PER_USER = 25

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function generateKeyValue(): string {
  return KEY_PREFIX + randomBytes(KEY_BYTE_LENGTH).toString("base64url")
}

export interface ValidatedUserApiKey {
  id: string
  workspaceId: string
  userId: string
  name: string
  scopes: Set<string>
}

export class UserApiKeyService {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async createKey(params: {
    workspaceId: string
    userId: string
    name: string
    scopes: ApiKeyScope[]
    expiresAt: Date | null
  }): Promise<{ row: UserApiKeyRow; value: string }> {
    // Validate scopes
    for (const scope of params.scopes) {
      if (!ALL_SCOPES.has(scope)) {
        throw new HttpError(`Invalid scope: ${scope}`, { status: 400, code: "INVALID_SCOPE" })
      }
    }

    if (params.scopes.length === 0) {
      throw new HttpError("At least one scope is required", { status: 400, code: "INVALID_SCOPE" })
    }

    // Enforce per-user key limit
    const existing = await UserApiKeyRepository.listByUser(this.pool, params.workspaceId, params.userId)
    const activeCount = existing.filter((k) => !k.revokedAt).length
    if (activeCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new HttpError(`Maximum of ${MAX_ACTIVE_KEYS_PER_USER} active API keys per user`, {
        status: 400,
        code: "KEY_LIMIT_REACHED",
      })
    }

    const value = generateKeyValue()
    const keyHash = hashKey(value)
    const keyPrefix = value.slice(KEY_PREFIX.length, KEY_PREFIX.length + STORED_PREFIX_LENGTH)

    const row = await UserApiKeyRepository.insert(this.pool, {
      id: userApiKeyId(),
      workspaceId: params.workspaceId,
      userId: params.userId,
      name: params.name,
      keyHash,
      keyPrefix,
      scopes: params.scopes,
      expiresAt: params.expiresAt,
    })

    return { row, value }
  }

  async listKeys(workspaceId: string, userId: string): Promise<UserApiKeyRow[]> {
    return UserApiKeyRepository.listByUser(this.pool, workspaceId, userId)
  }

  async revokeKey(workspaceId: string, userId: string, keyId: string): Promise<void> {
    const key = await UserApiKeyRepository.findById(this.pool, workspaceId, keyId)
    if (!key || key.userId !== userId) {
      throw new HttpError("API key not found", { status: 404, code: "NOT_FOUND" })
    }
    if (key.revokedAt) {
      throw new HttpError("API key already revoked", { status: 400, code: "ALREADY_REVOKED" })
    }
    await UserApiKeyRepository.revoke(this.pool, workspaceId, keyId)
  }

  /**
   * Validate a user API key value. Returns the key context if valid, null otherwise.
   * Also updates last_used_at as a fire-and-forget side effect.
   */
  async validateKey(value: string): Promise<ValidatedUserApiKey | null> {
    if (!value.startsWith(KEY_PREFIX)) return null

    const keyPrefix = value.slice(KEY_PREFIX.length, KEY_PREFIX.length + STORED_PREFIX_LENGTH)
    const candidates = await UserApiKeyRepository.findActiveByPrefix(this.pool, keyPrefix)
    if (candidates.length === 0) return null

    const keyHash = hashKey(value)
    const keyHashBuf = Buffer.from(keyHash, "hex")
    const match = candidates.find((k) => {
      const candidateBuf = Buffer.from(k.keyHash, "hex")
      return candidateBuf.length === keyHashBuf.length && timingSafeEqual(candidateBuf, keyHashBuf)
    })
    if (!match) return null

    // Fire-and-forget last_used_at update — non-critical, don't block response
    UserApiKeyRepository.touchLastUsed(this.pool, match.id).catch(() => {})

    return {
      id: match.id,
      workspaceId: match.workspaceId,
      userId: match.userId,
      name: match.name,
      scopes: new Set(match.scopes),
    }
  }
}
