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
} from "@/db"

/**
 * Reactively read a workspace from IndexedDB.
 */
export function useWorkspaceFromStore(workspaceId: string | undefined): CachedWorkspace | undefined {
  return useLiveQuery(() => (workspaceId ? db.workspaces.get(workspaceId) : undefined), [workspaceId], undefined)
}

/**
 * Reactively read all users for a workspace from IndexedDB.
 */
export function useWorkspaceUsers(workspaceId: string | undefined): CachedWorkspaceUser[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.workspaceUsers.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedWorkspaceUser[]
    ) ?? []
  )
}

/**
 * Reactively read all streams for a workspace from IndexedDB.
 */
export function useWorkspaceStreams(workspaceId: string | undefined): CachedStream[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.streams.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedStream[]
    ) ?? []
  )
}

/**
 * Reactively read all stream memberships for a workspace from IndexedDB.
 */
export function useWorkspaceStreamMemberships(workspaceId: string | undefined): CachedStreamMembership[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.streamMemberships.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedStreamMembership[]
    ) ?? []
  )
}

/**
 * Reactively read DM peers for a workspace from IndexedDB.
 */
export function useWorkspaceDmPeers(workspaceId: string | undefined): CachedDmPeer[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.dmPeers.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedDmPeer[]
    ) ?? []
  )
}

/**
 * Reactively read all personas for a workspace from IndexedDB.
 */
export function useWorkspacePersonas(workspaceId: string | undefined): CachedPersona[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.personas.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedPersona[]
    ) ?? []
  )
}

/**
 * Reactively read all bots for a workspace from IndexedDB.
 */
export function useWorkspaceBots(workspaceId: string | undefined): CachedBot[] {
  return (
    useLiveQuery(
      () => (workspaceId ? db.bots.where("workspaceId").equals(workspaceId).toArray() : []),
      [workspaceId],
      [] as CachedBot[]
    ) ?? []
  )
}

/**
 * Reactively read unread state for a workspace from IndexedDB.
 */
export function useWorkspaceUnreadState(workspaceId: string | undefined): CachedUnreadState | undefined {
  return useLiveQuery(() => (workspaceId ? db.unreadState.get(workspaceId) : undefined), [workspaceId], undefined)
}

/**
 * Reactively read user preferences for a workspace from IndexedDB.
 */
export function useWorkspaceUserPreferences(workspaceId: string | undefined): CachedUserPreferences | undefined {
  return useLiveQuery(() => (workspaceId ? db.userPreferences.get(workspaceId) : undefined), [workspaceId], undefined)
}
