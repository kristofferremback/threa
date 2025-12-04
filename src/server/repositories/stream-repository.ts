import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for streams table.
 */
export interface StreamRow {
  id: string
  workspace_id: string
  stream_type: string
  name: string | null
  slug: string | null
  description: string | null
  topic: string | null
  parent_stream_id: string | null
  branched_from_event_id: string | null
  visibility: string
  status: string
  promoted_at: Date | null
  promoted_by: string | null
  metadata: Record<string, unknown>
  created_at: Date
  updated_at: Date
  archived_at: Date | null
  persona_id: string | null
}

/**
 * Stream with additional discovery info.
 */
export interface DiscoverableStreamRow extends StreamRow {
  is_member: boolean
  member_count: number
}

/**
 * Parameters for inserting a stream.
 */
export interface InsertStreamParams {
  id: string
  workspaceId: string
  streamType: string
  name?: string | null
  slug?: string | null
  description?: string | null
  topic?: string | null
  visibility?: string
  parentStreamId?: string | null
  branchedFromEventId?: string | null
  metadata?: Record<string, unknown>
  personaId?: string | null
}

/**
 * Parameters for updating stream type (promotion).
 */
export interface UpdateStreamTypeParams {
  streamType: string
  name: string
  slug: string
  visibility: string
  promotedBy: string
}

/**
 * Parameters for updating stream metadata.
 */
export interface UpdateStreamMetadataParams {
  name?: string | null
  description?: string | null
  topic?: string | null
}

/**
 * Repository for streams table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const StreamRepository = {
  /**
   * Find a stream by ID.
   */
  async findStreamById(client: PoolClient, streamId: string): Promise<StreamRow | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id
          FROM streams
          WHERE id = ${streamId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find a stream by workspace and slug.
   */
  async findStreamBySlug(
    client: PoolClient,
    workspaceId: string,
    slug: string,
  ): Promise<StreamRow | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id
          FROM streams
          WHERE workspace_id = ${workspaceId} AND slug = ${slug}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find thread that branched from a specific event.
   */
  async findStreamByBranchedFromEventId(
    client: PoolClient,
    eventId: string,
  ): Promise<StreamRow | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id
          FROM streams
          WHERE branched_from_event_id = ${eventId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find thread by branched_from_event_id with row lock.
   * Used for concurrent thread creation to prevent duplicates.
   */
  async findStreamByBranchedFromEventIdForUpdate(
    client: PoolClient,
    eventId: string,
  ): Promise<StreamRow | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id
          FROM streams
          WHERE branched_from_event_id = ${eventId}
          FOR UPDATE`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Check if a slug exists in a workspace.
   * Optionally excludes a specific stream ID (for update validation).
   */
  async slugExists(
    client: PoolClient,
    workspaceId: string,
    slug: string,
    excludeStreamId?: string | null,
  ): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(
      sql`SELECT EXISTS(
            SELECT 1 FROM streams
            WHERE workspace_id = ${workspaceId}
              AND slug = ${slug}
              AND (${excludeStreamId}::text IS NULL OR id != ${excludeStreamId})
          ) as exists`,
    )
    return result.rows[0].exists
  },

  /**
   * Insert a new stream.
   */
  async insertStream(client: PoolClient, params: InsertStreamParams): Promise<StreamRow> {
    const result = await client.query<StreamRow>(
      sql`INSERT INTO streams (
            id, workspace_id, stream_type, name, slug, description, topic,
            visibility, parent_stream_id, branched_from_event_id, metadata, persona_id
          )
          VALUES (
            ${params.id}, ${params.workspaceId}, ${params.streamType},
            ${params.name ?? null}, ${params.slug ?? null},
            ${params.description ?? null}, ${params.topic ?? null},
            ${params.visibility ?? "public"}, ${params.parentStreamId ?? null},
            ${params.branchedFromEventId ?? null},
            ${JSON.stringify(params.metadata ?? {})},
            ${params.personaId ?? null}
          )
          RETURNING
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id`,
    )
    return result.rows[0]
  },

  /**
   * Update stream type (for promotion from thread to channel).
   */
  async updateStreamType(
    client: PoolClient,
    streamId: string,
    params: UpdateStreamTypeParams,
  ): Promise<StreamRow> {
    const result = await client.query<StreamRow>(
      sql`UPDATE streams SET
            stream_type = ${params.streamType},
            name = ${params.name},
            slug = ${params.slug},
            visibility = ${params.visibility},
            promoted_at = NOW(),
            promoted_by = ${params.promotedBy},
            updated_at = NOW()
          WHERE id = ${streamId}
          RETURNING
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id`,
    )
    return result.rows[0]
  },

  /**
   * Update just the stream name (for auto-naming).
   */
  async updateStreamName(client: PoolClient, streamId: string, name: string): Promise<void> {
    await client.query(
      sql`UPDATE streams SET name = ${name}, updated_at = NOW() WHERE id = ${streamId}`,
    )
  },

  /**
   * Update stream metadata (name, description, topic).
   */
  async updateStreamMetadata(
    client: PoolClient,
    streamId: string,
    params: UpdateStreamMetadataParams,
  ): Promise<StreamRow> {
    const result = await client.query<StreamRow>(
      sql`UPDATE streams SET
            name = COALESCE(${params.name}, name),
            description = COALESCE(${params.description}, description),
            topic = COALESCE(${params.topic}, topic),
            updated_at = NOW()
          WHERE id = ${streamId}
          RETURNING
            id, workspace_id, stream_type, name, slug, description, topic,
            parent_stream_id, branched_from_event_id, visibility, status,
            promoted_at, promoted_by, metadata, created_at, updated_at,
            archived_at, persona_id`,
    )
    return result.rows[0]
  },

  /**
   * Archive a stream by setting archived_at.
   */
  async archiveStream(client: PoolClient, streamId: string): Promise<void> {
    await client.query(
      sql`UPDATE streams SET archived_at = NOW(), updated_at = NOW() WHERE id = ${streamId}`,
    )
  },

  /**
   * Unarchive a stream by clearing archived_at.
   */
  async unarchiveStream(client: PoolClient, streamId: string): Promise<void> {
    await client.query(
      sql`UPDATE streams SET archived_at = NULL, updated_at = NOW() WHERE id = ${streamId}`,
    )
  },

  /**
   * Find an existing DM with exact participants.
   */
  async findExistingDM(
    client: PoolClient,
    workspaceId: string,
    participantIds: string[],
  ): Promise<StreamRow | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT
            s.id, s.workspace_id, s.stream_type, s.name, s.slug, s.description, s.topic,
            s.parent_stream_id, s.branched_from_event_id, s.visibility, s.status,
            s.promoted_at, s.promoted_by, s.metadata, s.created_at, s.updated_at,
            s.archived_at, s.persona_id
          FROM streams s
          WHERE s.workspace_id = ${workspaceId}
            AND s.stream_type = 'dm'
            AND s.archived_at IS NULL
            AND (SELECT COUNT(*) FROM stream_members sm
                 WHERE sm.stream_id = s.id AND sm.left_at IS NULL) = ${participantIds.length}
            AND NOT EXISTS (
              SELECT 1 FROM unnest(${participantIds}::text[]) as pid
              WHERE pid NOT IN (
                SELECT user_id FROM stream_members sm2
                WHERE sm2.stream_id = s.id AND sm2.left_at IS NULL
              )
            )`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find discoverable (public) streams in a workspace.
   * Returns streams with membership status and member count.
   */
  async findDiscoverableStreams(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ): Promise<DiscoverableStreamRow[]> {
    const result = await client.query<DiscoverableStreamRow>(
      sql`SELECT
            s.id, s.workspace_id, s.stream_type, s.name, s.slug, s.description, s.topic,
            s.parent_stream_id, s.branched_from_event_id, s.visibility, s.status,
            s.promoted_at, s.promoted_by, s.metadata, s.created_at, s.updated_at,
            s.archived_at, s.persona_id,
            CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
            (SELECT COUNT(*)::int FROM stream_members WHERE stream_id = s.id AND left_at IS NULL) as member_count
          FROM streams s
          LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = ${userId} AND sm.left_at IS NULL
          WHERE s.workspace_id = ${workspaceId}
            AND s.archived_at IS NULL
            AND s.stream_type = 'channel'
            AND s.visibility = 'public'
          ORDER BY s.name`,
    )
    return result.rows
  },
}
