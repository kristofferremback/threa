/**
 * Seed TanStack Query cache from IndexedDB on cold start.
 *
 * The app already persists workspace bootstrap data (workspace, users, streams,
 * personas) to IndexedDB on every successful fetch. This module reads that
 * cached data back at startup and pre-populates the TanStack Query cache so the
 * UI can render immediately with stale data while the fresh network fetch runs
 * in the background.
 */
import {
  db,
  type CachedWorkspace,
  type CachedWorkspaceUser,
  type CachedStream,
  type CachedStreamMembership,
  type CachedDmPeer,
  type CachedPersona,
  type CachedBot,
} from "@/db"
import { getQueryClient } from "@/contexts/query-client"
import { workspaceKeys } from "@/hooks/use-workspaces"
import type { WorkspaceBootstrap, Workspace } from "@threa/types"
import { DEFAULT_USER_PREFERENCES } from "@threa/types"
import type { WorkspaceListResult } from "@/api/workspaces"

/**
 * Extract the workspace ID from the current URL path.
 * Matches `/w/:workspaceId` and `/w/:workspaceId/...`.
 */
function getWorkspaceIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/w\/([^/]+)/)
  return match ? match[1] : null
}

/**
 * Seed workspace list and bootstrap queries from IndexedDB.
 * Best-effort: errors are swallowed so the app always falls through to
 * normal network fetching.
 */
export async function seedCacheFromIndexedDB(): Promise<void> {
  try {
    const queryClient = getQueryClient()

    // Seed workspace list for instant redirect on WorkspaceSelectPage.
    // Skip if a real fetch already populated the cache (guards against the
    // unlikely race where this async seed completes after a network response).
    const cachedWorkspaces = await db.workspaces.toArray()
    if (cachedWorkspaces.length > 0 && !queryClient.getQueryData(workspaceKeys.list())) {
      const workspaces: Workspace[] = cachedWorkspaces.map((w: CachedWorkspace) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        createdBy: "",
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }))

      queryClient.setQueryData<WorkspaceListResult>(workspaceKeys.list(), {
        workspaces,
        pendingInvitations: [],
      })
      // Mark stale immediately so useWorkspaces refetches on mount.
      // Without this, the 30s staleTime suppresses the network fetch and
      // pendingInvitations stays empty until the timer expires.
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.list(),
        refetchType: "none",
      })
    }

    // Seed workspace bootstrap if we're navigating to a workspace
    const workspaceId = getWorkspaceIdFromUrl()
    if (!workspaceId) return

    const [workspace, users, streams, memberships, dmPeers, personas, bots] = await Promise.all([
      db.workspaces.get(workspaceId),
      db.workspaceUsers.where("workspaceId").equals(workspaceId).toArray(),
      db.streams.where("workspaceId").equals(workspaceId).toArray(),
      db.streamMemberships.where("workspaceId").equals(workspaceId).toArray(),
      db.dmPeers.where("workspaceId").equals(workspaceId).toArray(),
      db.personas.where("workspaceId").equals(workspaceId).toArray(),
      db.bots.where("workspaceId").equals(workspaceId).toArray(),
    ])

    // Only seed if we have meaningful cached data
    if (!workspace || streams.length === 0) return

    const bootstrap: WorkspaceBootstrap = {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        createdBy: "",
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      users: users.map((u: CachedWorkspaceUser) => ({
        id: u.id,
        workspaceId: u.workspaceId,
        workosUserId: u.workosUserId,
        email: u.email,
        role: u.role,
        slug: u.slug,
        name: u.name,
        description: u.description,
        avatarUrl: u.avatarUrl,
        timezone: u.timezone,
        locale: u.locale,
        pronouns: null,
        phone: null,
        githubUsername: null,
        setupCompleted: u.setupCompleted,
        joinedAt: u.joinedAt,
      })),
      streams: streams.map((s: CachedStream) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        type: s.type,
        displayName: s.displayName,
        slug: s.slug,
        description: s.description,
        visibility: s.visibility,
        parentStreamId: s.parentStreamId,
        parentMessageId: s.parentMessageId,
        rootStreamId: s.rootStreamId,
        companionMode: s.companionMode,
        companionPersonaId: s.companionPersonaId,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        archivedAt: s.archivedAt,
        lastMessagePreview: null,
      })),
      streamMemberships: memberships.map((sm: CachedStreamMembership) => ({
        streamId: sm.streamId,
        memberId: sm.memberId,
        pinned: sm.pinned,
        pinnedAt: sm.pinnedAt,
        notificationLevel: sm.notificationLevel,
        lastReadEventId: sm.lastReadEventId,
        lastReadAt: sm.lastReadAt,
        joinedAt: sm.joinedAt,
      })),
      dmPeers: dmPeers.map((dp: CachedDmPeer) => ({
        userId: dp.userId,
        streamId: dp.streamId,
      })),
      personas: personas.map((p: CachedPersona) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        slug: p.slug,
        name: p.name,
        description: p.description,
        avatarEmoji: p.avatarEmoji,
        systemPrompt: p.systemPrompt,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        enabledTools: p.enabledTools,
        managedBy: p.managedBy,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      bots: bots.map((b: CachedBot) => ({
        id: b.id,
        workspaceId: b.workspaceId,
        name: b.name,
        description: b.description,
        avatarEmoji: b.avatarEmoji,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
      emojis: [],
      emojiWeights: {},
      commands: [],
      // Counters start empty — fresh data fills them in
      unreadCounts: {},
      mentionCounts: {},
      activityCounts: {},
      unreadActivityCount: 0,
      mutedStreamIds: [],
      userPreferences: {
        ...DEFAULT_USER_PREFERENCES,
        workspaceId,
        // userId is unavailable at seed time (no auth context yet).
        // Consumers that need the real userId (e.g. useWorkspaceUserId) resolve
        // it via workosUserId from the auth context, so this empty value is safe.
        // The real bootstrap fetch fills it in once the socket connects.
        userId: "",
        createdAt: "",
        updatedAt: "",
      },
    }

    // Skip if a real fetch already populated the cache (same race guard as above).
    if (queryClient.getQueryData(workspaceKeys.bootstrap(workspaceId))) return

    // Seed the cache and immediately invalidate so TanStack Query knows a
    // refetch is needed. The query is disabled until the socket connects, so
    // invalidation won't trigger an immediate fetch — but once the socket
    // connects and enables the query, it will refetch fresh data. Meanwhile,
    // the seeded data lets the UI render immediately.
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)
    void queryClient.invalidateQueries({
      queryKey: workspaceKeys.bootstrap(workspaceId),
      refetchType: "none",
    })
  } catch {
    // Best-effort: fall through to normal network fetching
  }
}
