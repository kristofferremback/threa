import { db } from "@/db"
import type { WorkspaceBootstrap } from "@threa/types"

/**
 * Shred a WorkspaceBootstrap response into individual IDB tables.
 *
 * For workspace-scoped entities (streams, users, memberships, etc.), this
 * is a REPLACE: entities not in the bootstrap snapshot are deleted if they
 * were written before this bootstrap (`_cachedAt < now`). Entities written
 * concurrently by socket handlers (`_cachedAt >= now`) are preserved.
 *
 * This prevents stale data from accumulating across environments or DB resets.
 */
export async function applyWorkspaceBootstrap(
  workspaceId: string,
  bootstrap: WorkspaceBootstrap,
  fetchStartedAt?: number
): Promise<void> {
  const now = Date.now()

  // Build membership lookup for O(1) access when merging onto streams
  const membershipByStream = new Map(bootstrap.streamMemberships.map((sm) => [sm.streamId, sm]))

  await Promise.all([
    db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now }),
    db.workspaceUsers.bulkPut(bootstrap.users.map((u) => ({ ...u, _cachedAt: now }))),
    db.streams.bulkPut(
      bootstrap.streams.map((s) => {
        const membership = membershipByStream.get(s.id)
        return {
          ...s,
          pinned: membership?.pinned,
          notificationLevel: membership?.notificationLevel,
          lastReadEventId: membership?.lastReadEventId,
          _cachedAt: now,
        }
      })
    ),
    db.streamMemberships.bulkPut(
      bootstrap.streamMemberships.map((sm) => ({
        ...sm,
        id: `${workspaceId}:${sm.streamId}`,
        workspaceId,
        _cachedAt: now,
      }))
    ),
    db.dmPeers.bulkPut(
      bootstrap.dmPeers.map((dp) => ({
        ...dp,
        id: `${workspaceId}:${dp.streamId}`,
        workspaceId,
        _cachedAt: now,
      }))
    ),
    db.personas.bulkPut(bootstrap.personas.map((p) => ({ ...p, _cachedAt: now }))),
    db.bots.bulkPut(bootstrap.bots.map((b) => ({ ...b, _cachedAt: now }))),
    db.unreadState.put({
      id: workspaceId,
      workspaceId,
      unreadCounts: bootstrap.unreadCounts,
      mentionCounts: bootstrap.mentionCounts,
      activityCounts: bootstrap.activityCounts,
      unreadActivityCount: bootstrap.unreadActivityCount,
      mutedStreamIds: bootstrap.mutedStreamIds,
      _cachedAt: now,
    }),
    db.userPreferences.put({
      ...bootstrap.userPreferences,
      id: workspaceId,
      workspaceId,
      _cachedAt: now,
    }),
    db.workspaceMetadata.put({
      id: workspaceId,
      workspaceId,
      emojis: bootstrap.emojis,
      emojiWeights: bootstrap.emojiWeights,
      commands: bootstrap.commands,
      _cachedAt: now,
    }),
  ])

  // Clean up stale entities: anything in IDB for this workspace that
  // wasn't in the bootstrap AND was written before this bootstrap.
  // Entities with _cachedAt >= now were written concurrently by socket
  // handlers and must be preserved.
  // Use the pre-fetch timestamp for stale cleanup. Entities written by
  // socket handlers DURING the fetch have _cachedAt > fetchStartedAt and
  // survive. Only truly stale entities (from before we started fetching)
  // are removed. If no fetchStartedAt provided, skip cleanup entirely.
  if (fetchStartedAt !== undefined) {
    await cleanupStaleEntities(workspaceId, bootstrap, fetchStartedAt)
  }
}

async function cleanupStaleEntities(workspaceId: string, bootstrap: WorkspaceBootstrap, now: number): Promise<void> {
  const bootstrapStreamIds = new Set(bootstrap.streams.map((s) => s.id))
  const bootstrapUserIds = new Set(bootstrap.users.map((u) => u.id))
  const bootstrapMembershipIds = new Set(bootstrap.streamMemberships.map((sm) => `${workspaceId}:${sm.streamId}`))
  const bootstrapDmPeerIds = new Set(bootstrap.dmPeers.map((dp) => `${workspaceId}:${dp.streamId}`))
  const bootstrapPersonaIds = new Set(bootstrap.personas.map((p) => p.id))
  const bootstrapBotIds = new Set(bootstrap.bots.map((b) => b.id))

  await Promise.all([
    deleteStale(db.streams, "workspaceId", workspaceId, bootstrapStreamIds, now),
    deleteStale(db.workspaceUsers, "workspaceId", workspaceId, bootstrapUserIds, now),
    deleteStale(db.streamMemberships, "workspaceId", workspaceId, bootstrapMembershipIds, now),
    deleteStale(db.dmPeers, "workspaceId", workspaceId, bootstrapDmPeerIds, now),
    deleteStale(db.personas, "workspaceId", workspaceId, bootstrapPersonaIds, now),
    deleteStale(db.bots, "workspaceId", workspaceId, bootstrapBotIds, now),
  ])
}

async function deleteStale(
  table: {
    where: (field: string) => {
      equals: (value: string) => { toArray: () => Promise<Array<{ id: string; _cachedAt: number }>> }
    }
    bulkDelete: (ids: string[]) => Promise<void>
  },
  scopeField: string,
  scopeValue: string,
  keepIds: Set<string>,
  now: number
): Promise<void> {
  const all = await table.where(scopeField).equals(scopeValue).toArray()
  const toDelete = all.filter((entity) => !keepIds.has(entity.id) && entity._cachedAt < now).map((e) => e.id)
  if (toDelete.length > 0) {
    await table.bulkDelete(toDelete)
  }
}
