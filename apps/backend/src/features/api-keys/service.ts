import type { Pool } from "pg"
import { ApiKeyChannelAccessRepository } from "./repository"

interface ApiKeyChannelServiceDeps {
  pool: Pool
}

export class ApiKeyChannelService {
  private pool: Pool

  constructor(deps: ApiKeyChannelServiceDeps) {
    this.pool = deps.pool
  }

  async getAccessibleStreamIdsForApiKey(workspaceId: string, apiKeyId: string): Promise<string[]> {
    const [publicStreamIds, grantedStreamIds] = await Promise.all([
      ApiKeyChannelAccessRepository.getPublicStreamIds(this.pool, workspaceId),
      ApiKeyChannelAccessRepository.getAccessibleStreamIds(this.pool, workspaceId, apiKeyId),
    ])

    return [...new Set([...publicStreamIds, ...grantedStreamIds])]
  }
}
