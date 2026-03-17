import { sql, type Querier } from "@threa/backend-common"
import type { LinkPreviewContentType, LinkPreviewStatus } from "@threa/types"

// =============================================================================
// Row types
// =============================================================================

export interface LinkPreview {
  id: string
  workspaceId: string
  url: string
  normalizedUrl: string
  title: string | null
  description: string | null
  imageUrl: string | null
  faviconUrl: string | null
  siteName: string | null
  contentType: LinkPreviewContentType
  status: LinkPreviewStatus
  fetchedAt: Date | null
  createdAt: Date
}

export interface InsertLinkPreviewParams {
  id: string
  workspaceId: string
  url: string
  normalizedUrl: string
  contentType: LinkPreviewContentType
}

export interface UpdateLinkPreviewParams {
  title?: string | null
  description?: string | null
  imageUrl?: string | null
  faviconUrl?: string | null
  siteName?: string | null
  contentType?: LinkPreviewContentType
  status: LinkPreviewStatus
}

export interface MessageLinkPreview {
  messageId: string
  linkPreviewId: string
  position: number
}

// =============================================================================
// Mappers
// =============================================================================

function mapRow(row: Record<string, unknown>): LinkPreview {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    url: row.url as string,
    normalizedUrl: row.normalized_url as string,
    title: row.title as string | null,
    description: row.description as string | null,
    imageUrl: row.image_url as string | null,
    faviconUrl: row.favicon_url as string | null,
    siteName: row.site_name as string | null,
    contentType: row.content_type as LinkPreviewContentType,
    status: row.status as LinkPreviewStatus,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// =============================================================================
// Repository
// =============================================================================

export const LinkPreviewRepository = {
  async insert(querier: Querier, params: InsertLinkPreviewParams): Promise<LinkPreview> {
    const result = await querier.query(
      sql`INSERT INTO link_previews (id, workspace_id, url, normalized_url, content_type, status)
          VALUES ($1, $2, $3, $4, $5, 'pending')
          ON CONFLICT (workspace_id, normalized_url) DO NOTHING
          RETURNING *`,
      [params.id, params.workspaceId, params.url, params.normalizedUrl, params.contentType]
    )
    if (result.rows.length > 0) {
      return mapRow(result.rows[0])
    }
    // Already exists — return the existing row
    return LinkPreviewRepository.findByNormalizedUrl(
      querier,
      params.workspaceId,
      params.normalizedUrl
    ) as Promise<LinkPreview>
  },

  async findById(querier: Querier, workspaceId: string, id: string): Promise<LinkPreview | null> {
    const result = await querier.query(sql`SELECT * FROM link_previews WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      id,
    ])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  async findByNormalizedUrl(querier: Querier, workspaceId: string, normalizedUrl: string): Promise<LinkPreview | null> {
    const result = await querier.query(
      sql`SELECT * FROM link_previews WHERE workspace_id = $1 AND normalized_url = $2`,
      [workspaceId, normalizedUrl]
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  async updateMetadata(
    querier: Querier,
    workspaceId: string,
    id: string,
    params: UpdateLinkPreviewParams
  ): Promise<LinkPreview | null> {
    const result = await querier.query(
      sql`UPDATE link_previews
          SET title = $3, description = $4, image_url = $5, favicon_url = $6,
              site_name = $7, content_type = $8, status = $9, fetched_at = NOW()
          WHERE workspace_id = $1 AND id = $2 AND status = 'pending'
          RETURNING *`,
      [
        workspaceId,
        id,
        params.title ?? null,
        params.description ?? null,
        params.imageUrl ?? null,
        params.faviconUrl ?? null,
        params.siteName ?? null,
        params.contentType ?? "website",
        params.status,
      ]
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  // --- Message junction ---

  async linkToMessage(
    querier: Querier,
    workspaceId: string,
    messageId: string,
    linkPreviewId: string,
    position: number
  ): Promise<void> {
    await querier.query(
      sql`INSERT INTO message_link_previews (workspace_id, message_id, link_preview_id, position)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, message_id, link_preview_id) DO NOTHING`,
      [workspaceId, messageId, linkPreviewId, position]
    )
  },

  async findByMessageId(querier: Querier, workspaceId: string, messageId: string): Promise<LinkPreview[]> {
    const result = await querier.query(
      sql`SELECT lp.* FROM link_previews lp
          JOIN message_link_previews mlp ON mlp.link_preview_id = lp.id
          WHERE mlp.workspace_id = $1 AND mlp.message_id = $2
          ORDER BY mlp.position ASC`,
      [workspaceId, messageId]
    )
    return result.rows.map(mapRow)
  },

  async findByMessageIds(
    querier: Querier,
    workspaceId: string,
    messageIds: string[]
  ): Promise<Map<string, LinkPreview[]>> {
    if (messageIds.length === 0) return new Map()

    const result = await querier.query(
      sql`SELECT lp.*, mlp.message_id, mlp.position FROM link_previews lp
          JOIN message_link_previews mlp ON mlp.link_preview_id = lp.id
          WHERE mlp.workspace_id = $1 AND mlp.message_id = ANY($2)
          ORDER BY mlp.message_id, mlp.position ASC`,
      [workspaceId, messageIds]
    )

    const map = new Map<string, LinkPreview[]>()
    for (const row of result.rows) {
      const msgId = row.message_id as string
      const preview = mapRow(row)
      const existing = map.get(msgId) ?? []
      existing.push(preview)
      map.set(msgId, existing)
    }
    return map
  },

  // --- User dismissals ---

  async dismiss(
    querier: Querier,
    workspaceId: string,
    userId: string,
    messageId: string,
    linkPreviewId: string
  ): Promise<void> {
    await querier.query(
      sql`INSERT INTO user_link_preview_dismissals (workspace_id, user_id, message_id, link_preview_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, user_id, message_id, link_preview_id) DO NOTHING`,
      [workspaceId, userId, messageId, linkPreviewId]
    )
  },

  async undismiss(
    querier: Querier,
    workspaceId: string,
    userId: string,
    messageId: string,
    linkPreviewId: string
  ): Promise<void> {
    await querier.query(
      sql`DELETE FROM user_link_preview_dismissals
          WHERE workspace_id = $1 AND user_id = $2 AND message_id = $3 AND link_preview_id = $4`,
      [workspaceId, userId, messageId, linkPreviewId]
    )
  },

  async findDismissals(
    querier: Querier,
    workspaceId: string,
    userId: string,
    messageIds: string[]
  ): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set()

    const result = await querier.query(
      sql`SELECT message_id, link_preview_id FROM user_link_preview_dismissals
          WHERE workspace_id = $1 AND user_id = $2 AND message_id = ANY($3)`,
      [workspaceId, userId, messageIds]
    )

    // Key: "messageId:linkPreviewId"
    const set = new Set<string>()
    for (const row of result.rows) {
      set.add(`${row.message_id}:${row.link_preview_id}`)
    }
    return set
  },
}
