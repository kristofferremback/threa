// Last workspace the user had open. Read at the `/` entry route so a returning
// user is redirected straight to `/w/:id` (which renders from IndexedDB)
// instead of waiting on the control-plane `/api/workspaces` round trip just to
// discover where to go. Purely a navigation hint: the workspace layout still
// enforces auth and membership, and a stale/wrong id simply falls back to the
// normal bootstrap path. Cleared on logout so a different account can't inherit it.
const STORAGE_KEY = "threa-last-workspace"

export function getLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setLastWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, workspaceId)
  } catch {
    // Storage unavailable
  }
}

export function clearLastWorkspaceId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable
  }
}
