import { WorkOS } from "@workos-inc/node"
import { logger } from "../logger"
import type { WorkosConfig } from "./types"

export interface ValidatedApiKey {
  id: string
  name: string
  organizationId: string
  permissions: Set<string>
}

export interface ApiKeyService {
  validateApiKey(value: string): Promise<ValidatedApiKey | null>
}

export class WorkosApiKeyService implements ApiKeyService {
  private workos: WorkOS

  constructor(config: WorkosConfig) {
    this.workos = new WorkOS(config.apiKey, { clientId: config.clientId })
  }

  async validateApiKey(value: string): Promise<ValidatedApiKey | null> {
    try {
      const { apiKey } = await this.workos.apiKeys.validateApiKey({ value })
      if (!apiKey) return null

      return {
        id: apiKey.id,
        name: apiKey.name,
        organizationId: apiKey.owner.id,
        permissions: new Set(apiKey.permissions),
      }
    } catch (error: unknown) {
      // WorkOS SDK throws for invalid keys (401/404) and for network/infra failures.
      // Invalid keys → return null (caller maps to 401).
      // Infrastructure failures → re-throw so error middleware returns 500.
      const isExpectedRejection =
        error instanceof Error && (error.message.includes("not found") || error.message.includes("invalid"))
      if (isExpectedRejection) {
        logger.debug({ error }, "API key validation rejected")
        return null
      }
      logger.warn({ error }, "API key validation infrastructure error")
      throw error
    }
  }
}
