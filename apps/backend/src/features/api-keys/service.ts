import type { Pool } from "pg"
import { ApiKeyChannelAccessRepository } from "./repository"
import { SearchRepository } from "../search"

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
      SearchRepository.getPublicStreams(this.pool, workspaceId),
      ApiKeyChannelAccessRepository.getGrantedStreamIds(this.pool, workspaceId, apiKeyId),
    ])

    return [...new Set([...publicStreamIds, ...grantedStreamIds])]
  }
}
