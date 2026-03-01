const STORAGE_PREFIX = "threa-last-stream"

function getKey(userId: string, workspaceId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${workspaceId}`
}

export function getLastStreamId(userId: string, workspaceId: string): string | null {
  try {
    return localStorage.getItem(getKey(userId, workspaceId))
  } catch {
    return null
  }
}

export function setLastStreamId(userId: string, workspaceId: string, streamId: string): void {
  try {
    localStorage.setItem(getKey(userId, workspaceId), streamId)
  } catch {
    // Storage unavailable
  }
}
