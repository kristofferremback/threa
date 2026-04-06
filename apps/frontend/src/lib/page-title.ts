import { useSyncExternalStore } from "react"

const BASE_TITLE = "Threa"

let streamName: string | null = null
let listeners: Array<() => void> = []

function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function getSnapshot() {
  return streamName
}

export function setPageStreamName(name: string | null) {
  if (name === streamName) return
  streamName = name
  emitChange()
}

export function usePageStreamName(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function buildPageTitle(unreadCount: number, name: string | null = streamName): string {
  const parts: string[] = []
  if (unreadCount > 0) parts.push(`(${unreadCount})`)
  if (name) parts.push(name)
  parts.push(BASE_TITLE)
  return parts.join(" | ")
}
