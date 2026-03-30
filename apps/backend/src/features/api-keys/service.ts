import type { Pool } from "pg"
import { sql } from "../../db"
import { ApiKeyChannelAccessRepository } from "./repository"
import { SearchRepository } from "../search"
import { StreamRepository } from "../streams"

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

  async isStreamAccessibleForApiKey(workspaceId: string, apiKeyId: string, streamId: string): Promise<boolean> {
    const result = await this.pool.query(
      sql`SELECT EXISTS(
        SELECT 1 FROM streams
        WHERE id = ${streamId} AND workspace_id = ${workspaceId} AND archived_at IS NULL
          AND (
            visibility = 'public'
            OR id IN (
              SELECT stream_id FROM api_key_channel_access
              WHERE workspace_id = ${workspaceId} AND api_key_id = ${apiKeyId} AND stream_id = ${streamId}
            )
          )
      ) AS accessible`
    )
    return result.rows[0].accessible
  }

  async getPublicStreamIds(workspaceId: string): Promise<string[]> {
    return SearchRepository.getPublicStreams(this.pool, workspaceId)
  }

  async isStreamPublic(workspaceId: string, streamId: string): Promise<boolean> {
    return StreamRepository.isPublic(this.pool, workspaceId, streamId)
  }
}
