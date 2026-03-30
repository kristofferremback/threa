import type { Socket } from "socket.io-client"
import type { QueryClient } from "@tanstack/react-query"
import { db } from "@/db"
import { joinRoomFireAndForget, joinRoomBestEffort } from "@/lib/socket-room"
import { applyWorkspaceBootstrap } from "./workspace-sync"
import { registerStreamSocketHandlers } from "./stream-sync"
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
  private cleanupFns: (() => void)[] = []
  private hasEverConnected = false
  private destroyed = false

  constructor(private deps: SyncEngineDeps) {}

  /**
   * Called when the socket connects or reconnects.
   * Triggers full bootstrap cycle: workspace → member streams.
   */
  async onConnect(socket: Socket): Promise<void> {
    if (this.destroyed) return
    const isReconnect = this.hasEverConnected
    this.hasEverConnected = true
    this.socket = socket

    if (isReconnect) {
      this.deps.syncStatus.setAllStale()
      // Clean up old stream handlers before re-registering
      this.cleanupStreamHandlers()
    }

    await this.bootstrapWorkspace(isReconnect)
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
    if (this.destroyed || !this.socket) return
    if (this.subscribedStreams.has(streamId)) {
      // Already subscribed — but if the stream bootstrap is stale (e.g.,
      // navigated away and back), the TanStack query handles refetch via
      // refetchOnMount: true. We just ensure the room is joined.
      return
    }
    this.subscribedStreams.add(streamId)

    const room = `ws:${this.deps.workspaceId}:stream:${streamId}`
    joinRoomFireAndForget(this.socket, room, new AbortController().signal, "SyncEngine")

    // Register stream-level socket handlers (IDB-only writes)
    const cleanup = registerStreamSocketHandlers(this.socket, this.deps.workspaceId, streamId, this.deps.queryClient)
    this.cleanupFns.push(cleanup)
  }

  /**
   * Unsubscribe from a stream. Called when stream view unmounts.
   * Does NOT leave the socket room (other hooks may still need it).
   */
  unsubscribeStream(streamId: string): void {
    this.subscribedStreams.delete(streamId)
    // Socket handler cleanup happens on destroy or reconnect
  }

  /**
   * Tear down all subscriptions and handlers.
   * Called when the workspace layout unmounts.
   */
  destroy(): void {
    this.destroyed = true
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
      await joinRoomBestEffort(this.socket, `ws:${workspaceId}`, "SyncEngine")

      const fetchStartedAt = Date.now()
      const bootstrap = await workspaceService.bootstrap(workspaceId)

      // Write to IDB (source of truth)
      await applyWorkspaceBootstrap(workspaceId, bootstrap, fetchStartedAt)

      // Write to TanStack cache (bridge for coordinated-loading, sidebar loading/error)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      syncStatus.set(`workspace:${workspaceId}`, "synced")

      // Subscribe all member streams
      const memberStreamIds = bootstrap.streamMemberships.map((sm) => sm.streamId)
      for (const streamId of memberStreamIds) {
        if (!this.subscribedStreams.has(streamId)) {
          // Just join the room — stream bootstrap is handled by useStreamBootstrap
          // when the stream view mounts. We pre-join so socket events flow.
          this.subscribedStreams.add(streamId)
          joinRoomFireAndForget(
            this.socket!,
            `ws:${workspaceId}:stream:${streamId}`,
            new AbortController().signal,
            "SyncEngine"
          )
        }
      }
    } catch (error) {
      const hasCachedData = (await db.workspaces.get(workspaceId)) !== undefined
      syncStatus.set(`workspace:${workspaceId}`, hasCachedData ? "stale" : "error")

      if (!hasCachedData) {
        // Propagate to TanStack so coordinated-loading shows the error
        queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), undefined)
      }
    }
  }

  private cleanupStreamHandlers(): void {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.subscribedStreams.clear()
  }

  private cleanupAllHandlers(): void {
    this.cleanupStreamHandlers()
  }
}
