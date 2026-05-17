// One-shot, workspace-keyed handoff from the SW-message handler (which runs
// outside React, with no AccountScope context) to WorkspaceLayout's
// account-switch hook. The notification carries the recipient account's WorkOS
// user id; the hook reads it once on mount and resolves/flips the active
// account so the deep link opens under the right identity.

let pending: { workspaceId: string; workosUserId: string } | null = null

export function setNotificationIntent(workspaceId: string, workosUserId: string): void {
  pending = { workspaceId, workosUserId }
}

/**
 * Returns the pending recipient WorkOS user id iff it was set for this exact
 * workspace, clearing it so it fires at most once. A mismatched workspace (a
 * later, unrelated mount) leaves the intent untouched and returns null.
 */
export function takeNotificationIntent(workspaceId: string): string | null {
  if (pending?.workspaceId !== workspaceId) return null
  const id = pending.workosUserId
  pending = null
  return id
}
