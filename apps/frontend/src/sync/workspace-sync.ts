import { db } from "@/db"
import type { WorkspaceBootstrap } from "@threa/types"

/**
 * Shred a WorkspaceBootstrap response into individual IDB tables.
 *
 * This is a merge (not replace) — existing data is overwritten by key,
 * but entities not in the bootstrap are not deleted. Socket events may
 * have written newer data between the bootstrap snapshot and this call.
 */
export async function applyWorkspaceBootstrap(workspaceId: string, bootstrap: WorkspaceBootstrap): Promise<void> {
  const now = Date.now()
  await Promise.all([
    db.workspaces.put({ ...bootstrap.workspace, _cachedAt: now }),
    db.workspaceUsers.bulkPut(bootstrap.users.map((u) => ({ ...u, _cachedAt: now }))),
    db.streams.bulkPut(
      bootstrap.streams.map((s) => ({
        ...s,
        pinned: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.pinned,
        notificationLevel: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.notificationLevel,
        lastReadEventId: bootstrap.streamMemberships.find((sm) => sm.streamId === s.id)?.lastReadEventId,
        _cachedAt: now,
      }))
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
}
