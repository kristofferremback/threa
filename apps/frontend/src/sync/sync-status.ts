import { createContext, useContext, useSyncExternalStore } from "react"

export type SyncStatus = "idle" | "syncing" | "synced" | "stale" | "error"

type Listener = () => void

/**
 * Transient session-state store for per-resource sync status.
 * Not persisted to IndexedDB — sync status resets on page reload.
 *
 * Keys follow the convention:
 *   "workspace:{workspaceId}" — workspace bootstrap sync
 *   "stream:{streamId}"      — stream bootstrap sync
 */
export class SyncStatusStore {
  private statuses = new Map<string, SyncStatus>()
  private listeners = new Map<string, Set<Listener>>()
  private globalListeners = new Set<Listener>()

  get(key: string): SyncStatus {
    return this.statuses.get(key) ?? "idle"
  }

  set(key: string, status: SyncStatus): void {
    if (this.statuses.get(key) === status) return
    this.statuses.set(key, status)
    this.notify(key)
  }

  setAllStale(): void {
    for (const key of this.statuses.keys()) {
      this.statuses.set(key, "stale")
    }
    // Notify all key-specific listeners
    for (const [, listeners] of this.listeners) {
      for (const listener of listeners) listener()
    }
    for (const listener of this.globalListeners) listener()
  }

  subscribe(key: string, listener: Listener): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(key)
    }
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => this.globalListeners.delete(listener)
  }

  /** Check if any resource is currently syncing */
  isAnySyncing(): boolean {
    for (const status of this.statuses.values()) {
      if (status === "syncing") return true
    }
    return false
  }

  private notify(key: string): void {
    const listeners = this.listeners.get(key)
    if (listeners) {
      for (const listener of listeners) listener()
    }
    for (const listener of this.globalListeners) listener()
  }
}

export const SyncStatusContext = createContext<SyncStatusStore | null>(null)

function useSyncStatusStore(): SyncStatusStore {
  const store = useContext(SyncStatusContext)
  if (!store) throw new Error("useSyncStatus must be used within a SyncStatusContext provider")
  return store
}

/**
 * Subscribe to sync status for a specific resource key.
 * Returns the current SyncStatus and re-renders only when that key changes.
 */
export function useSyncStatus(key: string): SyncStatus {
  const store = useSyncStatusStore()
  return useSyncExternalStore(
    (cb) => store.subscribe(key, cb),
    () => store.get(key)
  )
}

/**
 * Subscribe to whether any resource is currently syncing.
 * Useful for showing a global loading indicator.
 */
export function useIsAnySyncing(): boolean {
  const store = useSyncStatusStore()
  return useSyncExternalStore(
    (cb) => store.subscribeGlobal(cb),
    () => store.isAnySyncing()
  )
}
