import { createContext, useContext } from "react"
import type { Socket } from "socket.io-client"
import type { QueryClient } from "@tanstack/react-query"
import { db } from "@/db"
import { joinRoomFireAndForget, joinRoomBestEffort } from "@/lib/socket-room"
import { applyWorkspaceBootstrap, registerWorkspaceSocketHandlers } from "./workspace-sync"
import { registerStreamSocketHandlers } from "./stream-sync"
import { processOperationQueue } from "./operation-queue"
import { SyncStatusStore } from "./sync-status"
import { workspaceKeys } from "@/hooks/use-workspaces"
import type { WorkspaceBootstrap } from "@threa/types"

interface SyncEngineDeps {
  workspaceId: string
  syncStatus: SyncStatusStore
  queryClient: QueryClient
  workspaceService: { bootstrap: (workspaceId: string) => Promise<WorkspaceBootstrap> }
  streamService: {
    bootstrap: (workspaceId: string, streamId: string) => Promise<import("@threa/types").StreamBootstrap>
  }
  messageService?: {
    update: (workspaceId: string, messageId: string, data: any) => Promise<any>
    delete: (workspaceId: string, messageId: string) => Promise<void>
  }
  reactionService?: {
    add: (workspaceId: string, messageId: string, emoji: string) => Promise<void>
    remove: (workspaceId: string, messageId: string, emoji: string) => Promise<void>
  }
}

/**
 * Owns the full sync lifecycle for a workspace:
 * - Workspace bootstrap (subscribe-then-fetch, INV-53)
 * - Stream subscriptions (subscribe-then-fetch per stream)
 * - Socket handler registration (workspace + stream level)
 * - Reconnection (re-bootstrap everything)
 * - Sync status tracking
 *
 * Constructed once per workspace and provided via context.
 * Testable without React (plain class, no hooks).
 */
export class SyncEngine {
  private socket: Socket | null = null
  private subscribedStreams = new Set<string>()
  private streamHandlerCleanups = new Map<string, () => void>()
  private workspaceHandlerCleanup: (() => void) | null = null
  private hasEverConnected = false
  /** Whether the engine has been destroyed. Public for ref-check re-creation. */
  isDestroyed = false

  // Ref-like state updated by the React layer
  private currentStreamId: string | undefined = undefined
  private currentUser: { id: string } | null = null
  /** Last workspace bootstrap error, if any. Consumers can check this for 404/403 handling. */
  lastWorkspaceError: unknown = null

  readonly workspaceId: string

  constructor(private deps: SyncEngineDeps) {
    this.workspaceId = deps.workspaceId
  }

  /** Update the current stream ID (called from React when route changes). */
  setCurrentStreamId(id: string | undefined): void {
    this.currentStreamId = id
  }

  /** Update the current auth user (called from React when auth state settles). */
  setCurrentUser(user: { id: string } | null): void {
    this.currentUser = user
  }

  /**
   * Called when the socket connects or reconnects.
   * Triggers full bootstrap cycle: workspace → member streams.
   */
  async onConnect(socket: Socket): Promise<void> {
    if (this.isDestroyed) return
    const isReconnect = this.hasEverConnected
    this.hasEverConnected = true
    this.socket = socket

    if (isReconnect) {
      this.deps.syncStatus.setAllStale()
      // Clean up old handlers before re-registering
      this.cleanupWorkspaceHandlers()
      this.cleanupStreamHandlers()
    }

    // Register workspace-level socket handlers (stream:created, stream:updated, etc.)
    this.workspaceHandlerCleanup = registerWorkspaceSocketHandlers(
      socket,
      this.deps.workspaceId,
      this.deps.queryClient,
      {
        getCurrentStreamId: () => this.currentStreamId,
        getCurrentUser: () => this.currentUser,
        subscribeStream: (streamId: string) => void this.subscribeStream(streamId),
      }
    )

    await this.bootstrapWorkspace(isReconnect)

    // Process pending offline operations (edits, deletes, reactions)
    this.kickOperationQueue()
  }

  /**
   * Called when the socket disconnects.
   */
  onDisconnect(): void {
    this.deps.syncStatus.setAllStale()
  }

  /**
   * Subscribe to a stream: join room, register handlers, fetch bootstrap.
   * Called by stream view components when they mount.
   * Idempotent — no-op if already subscribed.
   */
  async subscribeStream(streamId: string): Promise<void> {
    if (this.isDestroyed || !this.socket) return
    if (this.subscribedStreams.has(streamId)) return
    this.subscribedStreams.add(streamId)

    const room = `ws:${this.deps.workspaceId}:stream:${streamId}`
    joinRoomFireAndForget(this.socket, room, new AbortController().signal, "SyncEngine")

    // Register stream-level socket handlers (IDB-only writes)
    const cleanup = registerStreamSocketHandlers(this.socket, this.deps.workspaceId, streamId, this.deps.queryClient)
    this.streamHandlerCleanups.set(streamId, cleanup)
  }

  /**
   * Unsubscribe from a stream. Called when stream view unmounts.
   * Cleans up the stream's socket handlers to prevent accumulation.
   */
  unsubscribeStream(streamId: string): void {
    this.subscribedStreams.delete(streamId)
    const cleanup = this.streamHandlerCleanups.get(streamId)
    if (cleanup) {
      cleanup()
      this.streamHandlerCleanups.delete(streamId)
    }
  }

  /**
   * Kick the offline operation queue (edits, deletes, reactions).
   * Called on connect and can be called after enqueueOperation.
   */
  kickOperationQueue(): void {
    if (!this.deps.messageService) return
    void processOperationQueue(
      this.deps.messageService,
      this.deps.reactionService ?? { add: async () => {}, remove: async () => {} },
      () => this.socket !== null && !this.isDestroyed
    )
  }

  /**
   * Re-trigger workspace bootstrap (e.g., user clicks "Retry" in sidebar error).
   */
  retryWorkspace(): void {
    if (!this.socket) return
    void this.bootstrapWorkspace(false)
  }

  /**
   * Tear down all subscriptions and handlers.
   * Called when the workspace layout unmounts.
   */
  destroy(): void {
    this.isDestroyed = true
    this.cleanupAllHandlers()
    this.subscribedStreams.clear()
    this.socket = null
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private async bootstrapWorkspace(_isReconnect: boolean): Promise<void> {
    if (!this.socket) return
    const { workspaceId, syncStatus, queryClient, workspaceService } = this.deps

    syncStatus.set(`workspace:${workspaceId}`, "syncing")

    try {
      // Subscribe-then-fetch (INV-53)
      console.log("[SyncEngine] joining workspace room")
      await joinRoomBestEffort(this.socket, `ws:${workspaceId}`, "SyncEngine")
      console.log("[SyncEngine] fetching bootstrap")

      const fetchStartedAt = Date.now()
      const bootstrap = await workspaceService.bootstrap(workspaceId)

      // Write to IDB (source of truth)
      await applyWorkspaceBootstrap(workspaceId, bootstrap, fetchStartedAt)

      // Write to TanStack cache (bridge for coordinated-loading, sidebar loading/error)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      this.lastWorkspaceError = null
      syncStatus.set(`workspace:${workspaceId}`, "synced")

      // Subscribe all member streams
      const memberStreamIds = bootstrap.streamMemberships.map((sm) => sm.streamId)
      // Subscribe all member streams: join rooms + register socket handlers.
      // On reconnect, cleanupStreamHandlers() already cleared the old handlers,
      // so these are fresh registrations.
      for (const streamId of memberStreamIds) {
        if (!this.subscribedStreams.has(streamId)) {
          this.subscribedStreams.add(streamId)
          joinRoomFireAndForget(
            this.socket!,
            `ws:${workspaceId}:stream:${streamId}`,
            new AbortController().signal,
            "SyncEngine"
          )
          const cleanup = registerStreamSocketHandlers(this.socket!, workspaceId, streamId, this.deps.queryClient)
          this.streamHandlerCleanups.set(streamId, cleanup)
        }
      }
    } catch (error) {
      this.lastWorkspaceError = error
      const hasCachedData = (await db.workspaces.get(workspaceId)) !== undefined
      syncStatus.set(`workspace:${workspaceId}`, hasCachedData ? "stale" : "error")

      if (!hasCachedData) {
        // Propagate to TanStack so coordinated-loading shows the error
        queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), undefined)
      }
    }
  }

  private cleanupWorkspaceHandlers(): void {
    if (this.workspaceHandlerCleanup) {
      this.workspaceHandlerCleanup()
      this.workspaceHandlerCleanup = null
    }
  }

  private cleanupStreamHandlers(): void {
    for (const cleanup of this.streamHandlerCleanups.values()) cleanup()
    this.streamHandlerCleanups.clear()
    this.subscribedStreams.clear()
  }

  private cleanupAllHandlers(): void {
    this.cleanupWorkspaceHandlers()
    this.cleanupStreamHandlers()
  }
}

// React context for accessing the SyncEngine from any component
export const SyncEngineContext = createContext<SyncEngine | null>(null)

export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncEngineContext)
  if (!engine) throw new Error("useSyncEngine must be used within a SyncEngineContext provider")
  return engine
}
