import { useEffect } from "react"
import { accountsApi } from "@/api"
import { ApiError } from "@/api/client"
import { useAccountScope } from "@/auth/account-scope"
import { useAuth } from "@/auth"
import { setNotificationIntent, takeNotificationIntent } from "@/lib/notification-intent"

/**
 * Cross-account notification-click handler. A push for a *parked* account
 * carries that account's WorkOS user id; `main.tsx` stashes it (keyed to the
 * workspace) and navigates the deep link, so on mount the URL is already
 * correct but the active account may be the wrong one.
 *
 * This hook reads the one-shot intent and, if it names a different account,
 * asks the control plane (identity `resolve` form) which signed-in account
 * owns it, then flips in place (PR-4a `switchAccount`). The keyed remount
 * re-bootstraps the same `workspaceId` under the owning account — no
 * navigation here (`main.tsx` already navigated; the module-singleton router's
 * location survives the remount).
 *
 * - intent === active account, or no intent -> no-op (common case).
 * - 404 `ACCOUNT_NOT_SIGNED_IN`: that account isn't on this browser -> full
 *   re-auth that lands back on the deep link.
 * - other resolve errors (network / `WORKSPACE_NOT_RESOLVABLE`) -> benign
 *   no-op; `useResolveOrBounce` is the safety net for the already-navigated
 *   URL.
 *
 * The intent is one-shot (`takeNotificationIntent` clears it), so the effect
 * re-running can't re-trigger; a cleanup flag drops a late resolve after
 * unmount or workspace change. If the effect tears down before the attempt
 * settles (StrictMode's throwaway first mount, or a fast unmount), the cleanup
 * hands the unconsumed intent back so the retained mount still sees it.
 * Mirrors `useResolveOrBounce`.
 */
export function useNotificationAccountSwitch(workspaceId: string): void {
  const { switchAccount, activeWorkosUserId } = useAccountScope()
  const { login } = useAuth()

  useEffect(() => {
    const intentUserId = takeNotificationIntent(workspaceId)
    if (!intentUserId || intentUserId === activeWorkosUserId) return

    let ignore = false
    let settled = false
    void (async () => {
      try {
        const { ownerUserId } = await accountsApi.resolveIdentity(intentUserId, workspaceId)
        if (ignore) return
        settled = true
        if (ownerUserId === activeWorkosUserId) return
        await switchAccount(ownerUserId)
      } catch (e) {
        if (ignore) return
        settled = true
        if (ApiError.isApiError(e) && e.code === "ACCOUNT_NOT_SIGNED_IN") {
          login(`/w/${workspaceId}`)
        }
      }
    })()
    return () => {
      ignore = true
      if (!settled) setNotificationIntent(workspaceId, intentUserId)
    }
  }, [workspaceId, activeWorkosUserId, switchAccount, login])
}
