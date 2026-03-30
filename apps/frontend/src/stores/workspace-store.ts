import { useLiveQuery } from "dexie-react-hooks"
import {
  db,
  type CachedWorkspace,
  type CachedWorkspaceUser,
  type CachedStream,
  type CachedStreamMembership,
  type CachedDmPeer,
  type CachedPersona,
  type CachedBot,
  type CachedUnreadState,
  type CachedUserPreferences,
  type CachedWorkspaceMetadata,
} from "@/db"

// =============================================================================
// In-memory cache — populated by applyWorkspaceBootstrap, used as the default
// value for useLiveQuery so the first synchronous render returns real data
// instead of empty arrays. This eliminates the one-frame flash that useLiveQuery
// causes (it's always async on first mount).
//
// The cache is NOT the source of truth — IDB is. The cache only serves as the
// initial value. Once useLiveQuery resolves (next render), IDB data takes over
// and subsequent updates flow reactively through useLiveQuery.
// =============================================================================

const cache = {
  workspaces: new Map<string, CachedWorkspace>(),
  users: new Map<string, CachedWorkspaceUser[]>(),
  streams: new Map<string, CachedStream[]>(),
  memberships: new Map<string, CachedStreamMembership[]>(),
  dmPeers: new Map<string, CachedDmPeer[]>(),
  personas: new Map<string, CachedPersona[]>(),
  bots: new Map<string, CachedBot[]>(),
  unreadState: new Map<string, CachedUnreadState>(),
  userPreferences: new Map<string, CachedUserPreferences>(),
  metadata: new Map<string, CachedWorkspaceMetadata>(),
}

/**
 * Populate the in-memory cache from a workspace bootstrap response.
 * Called by applyWorkspaceBootstrap after writing to IDB.
 */
export function seedWorkspaceCache(
  workspaceId: string,
  data: {
    workspace: CachedWorkspace
    users: CachedWorkspaceUser[]
    streams: CachedStream[]
    memberships: CachedStreamMembership[]
    dmPeers: CachedDmPeer[]
    personas: CachedPersona[]
    bots: CachedBot[]
    unreadState?: CachedUnreadState
    userPreferences?: CachedUserPreferences
    metadata?: CachedWorkspaceMetadata
  }
): void {
  cache.workspaces.set(workspaceId, data.workspace)
  cache.users.set(workspaceId, data.users)
  cache.streams.set(workspaceId, data.streams)
  cache.memberships.set(workspaceId, data.memberships)
  cache.dmPeers.set(workspaceId, data.dmPeers)
  cache.personas.set(workspaceId, data.personas)
  cache.bots.set(workspaceId, data.bots)
  if (data.unreadState) cache.unreadState.set(workspaceId, data.unreadState)
  if (data.userPreferences) cache.userPreferences.set(workspaceId, data.userPreferences)
  if (data.metadata) cache.metadata.set(workspaceId, data.metadata)
}

// =============================================================================
// Store hooks — useLiveQuery for reactivity, in-memory cache for first render
// =============================================================================

export function useWorkspaceFromStore(workspaceId: string | undefined): CachedWorkspace | undefined {
  return useLiveQuery(
    () => (workspaceId ? db.workspaces.get(workspaceId) : undefined),
    [workspaceId],
    workspaceId ? cache.workspaces.get(workspaceId) : undefined
  )
}

export function useWorkspaceUsers(workspaceId: string | undefined): CachedWorkspaceUser[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.workspaceUsers.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.users.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspaceStreams(workspaceId: string | undefined): CachedStream[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.streams.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.streams.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspaceStreamMemberships(workspaceId: string | undefined): CachedStreamMembership[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.streamMemberships.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.memberships.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspaceDmPeers(workspaceId: string | undefined): CachedDmPeer[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.dmPeers.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.dmPeers.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspacePersonas(workspaceId: string | undefined): CachedPersona[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.personas.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.personas.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspaceBots(workspaceId: string | undefined): CachedBot[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.bots.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      workspaceId ? (cache.bots.get(workspaceId) ?? []) : []
    ) ?? []
  )
}

export function useWorkspaceUnreadState(workspaceId: string | undefined): CachedUnreadState | undefined {
  return useLiveQuery(
    () => (workspaceId ? db.unreadState.get(workspaceId) : undefined),
    [workspaceId],
    workspaceId ? cache.unreadState.get(workspaceId) : undefined
  )
}

export function useWorkspaceUserPreferences(workspaceId: string | undefined): CachedUserPreferences | undefined {
  return useLiveQuery(
    () => (workspaceId ? db.userPreferences.get(workspaceId) : undefined),
    [workspaceId],
    workspaceId ? cache.userPreferences.get(workspaceId) : undefined
  )
}

export function useWorkspaceMetadata(workspaceId: string | undefined): CachedWorkspaceMetadata | undefined {
  return useLiveQuery(
    () => (workspaceId ? db.workspaceMetadata.get(workspaceId) : undefined),
    [workspaceId],
    workspaceId ? cache.metadata.get(workspaceId) : undefined
  )
}
