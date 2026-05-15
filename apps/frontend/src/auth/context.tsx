import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"
import { API_BASE } from "@/api/client"
import { clearAllCachedData } from "@/db"
import type { AccountSummary, AuthState, User } from "./types"

declare global {
  interface Window {
    __eagerAuthPromise?: Promise<User | null>
  }
}

interface AuthContextValue extends AuthState {
  login: (redirectTo?: string) => void
  logout: () => void
  refetch: () => Promise<void>
  /** Start the WorkOS "add another account" flow. Returns via OAuth redirect. */
  addAccount: (redirectTo?: string) => void
  /** Promote a parked alt to active. Identified by stable WorkOS userId. Hard-reloads after to swap the per-account DB. */
  switchAccount: (targetUserId: string) => Promise<void>
  /**
   * Remove an account from the jar. Pass the full AccountSummary so the caller
   * doesn't have to know that dead alts must be addressed by slot index (their
   * userId is `null`) while authenticated accounts use a stable userId.
   */
  removeAccount: (account: AccountSummary) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

const ACTIVE_USER_KEY = "threa_active_user"

/**
 * The DB module reads `localStorage[ACTIVE_USER_KEY]` at module load to pick
 * the per-account Dexie name (`threa_<userId>`). When `/me` reveals a userId
 * that doesn't match what was in localStorage, we update localStorage and hard-
 * reload so the next module load opens the correct DB. The reload is a no-op
 * for the common case (refresh while still on the same account) since the
 * stored userId already matches.
 *
 * Cross-tab sync: a "threa-auth" BroadcastChannel notifies sibling tabs of
 * switches/removes so they reload too — otherwise a switch in tab A would
 * leave tab B writing into the wrong account's DB.
 */
function ensureDbMatchesUser(userId: string): void {
  const stored = localStorage.getItem(ACTIVE_USER_KEY)
  if (stored !== userId) {
    localStorage.setItem(ACTIVE_USER_KEY, userId)
    // Only reload if a prior account was active — first-ever login has nothing
    // cached under the legacy "threa" DB worth preserving, so a reload is the
    // simplest way to move to "threa_<userId>".
    if (stored && stored !== userId) {
      window.location.reload()
      return
    }
    if (!stored) {
      // First login: reload once so subsequent code reads the per-account DB.
      window.location.reload()
    }
  }
}

interface AccountsListResponse {
  accounts: AccountSummary[]
  maxAccounts: number
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    accounts: [],
    maxAccounts: 1,
  })

  const fetchAccounts = useCallback(async (): Promise<AccountsListResponse | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts`, { credentials: "include" })
      if (res.status === 401) return null
      if (!res.ok) return null
      return (await res.json()) as AccountsListResponse
    } catch {
      return null
    }
  }, [])

  const fetchUser = useCallback(async () => {
    try {
      // Consume the eager auth promise started in index.html before the bundle loaded.
      // If the eager promise rejected (network error, 500, etc.) we fall through
      // to a fresh fetch so error handling works correctly.
      let user: User | null = null
      let resolvedFromEager = false
      const eagerPromise = window.__eagerAuthPromise
      if (eagerPromise) {
        window.__eagerAuthPromise = undefined
        try {
          user = await eagerPromise
          resolvedFromEager = true
        } catch {
          // Eager fetch failed — fall through to regular fetch
        }
      }

      if (!resolvedFromEager) {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
        if (res.status === 401) {
          setState({ user: null, loading: false, error: null, accounts: [], maxAccounts: 1 })
          localStorage.removeItem(ACTIVE_USER_KEY)
          return
        }
        if (!res.ok) throw new Error("Failed to fetch user")
        user = (await res.json()) as User
      }

      if (!user) {
        setState({ user: null, loading: false, error: null, accounts: [], maxAccounts: 1 })
        localStorage.removeItem(ACTIVE_USER_KEY)
        return
      }

      // Make sure the per-account Dexie name matches the active user. If this
      // is a first login or the user just switched accounts, this triggers a
      // hard reload — fetchUser doesn't return after that.
      ensureDbMatchesUser(user.id)

      const accountsResp = await fetchAccounts()
      setState({
        user,
        loading: false,
        error: null,
        accounts: accountsResp?.accounts ?? [
          { slot: "active", userId: user.id, email: user.email, name: user.name, status: "active" },
        ],
        maxAccounts: accountsResp?.maxAccounts ?? 1,
      })
    } catch (err) {
      setState({
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
        accounts: [],
        maxAccounts: 1,
      })
    }
  }, [fetchAccounts])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Cross-tab account sync: when another tab switches/removes an account, this
  // tab is stale — its cookie jar is the same, but the per-account DB handle
  // it opened at module load points at the old user. A hard reload is the
  // safest way to re-derive every per-account piece (DB name, query client,
  // push subscription, ...).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel("threa-auth")
    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      const type = event.data?.type
      if (type === "switched" || type === "removed" || type === "added") {
        window.location.reload()
      }
    }
    return () => channel.close()
  }, [])

  const login = useCallback((redirectTo?: string) => {
    const url = redirectTo
      ? `${API_BASE}/api/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`
      : `${API_BASE}/api/auth/login`
    window.location.href = url
  }, [])

  const addAccount = useCallback((redirectTo?: string) => {
    const target = redirectTo ?? window.location.pathname + window.location.search
    const url = `${API_BASE}/api/auth/login?intent=add&redirect_to=${encodeURIComponent(target)}`
    window.location.href = url
  }, [])

  const broadcast = useCallback((type: "switched" | "removed" | "added") => {
    if (typeof BroadcastChannel === "undefined") return
    try {
      const channel = new BroadcastChannel("threa-auth")
      channel.postMessage({ type })
      channel.close()
    } catch {
      // BroadcastChannel can throw in some isolated contexts (e.g. iframes);
      // a missing broadcast just means sibling tabs need to refresh manually.
    }
  }, [])

  const switchAccount = useCallback(
    async (targetUserId: string) => {
      const res = await fetch(`${API_BASE}/api/accounts/switch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      })
      if (!res.ok) {
        throw new Error(`Switch failed: ${res.status}`)
      }
      // 204 means the target was already active — no body, no DB swap needed.
      if (res.status !== 204) {
        const body = (await res.json()) as { active: { userId: string } | null }
        if (body.active) {
          localStorage.setItem(ACTIVE_USER_KEY, body.active.userId)
        }
      }
      broadcast("switched")
      window.location.reload()
    },
    [broadcast]
  )

  const removeAccount = useCallback(
    async (account: AccountSummary) => {
      // Authenticated accounts (active or parked) use a stable userId; dead
      // alts have no resolvable userId, so the slot index is the only handle.
      const body = account.userId !== null ? { targetUserId: account.userId } : { slot: account.slot as number }
      const res = await fetch(`${API_BASE}/api/accounts/remove`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`Remove failed: ${res.status}`)
      }
      const respBody = (await res.json()) as { active: { userId: string } | null }
      if (respBody.active) {
        localStorage.setItem(ACTIVE_USER_KEY, respBody.active.userId)
      } else {
        localStorage.removeItem(ACTIVE_USER_KEY)
      }
      broadcast("removed")
      window.location.reload()
    },
    [broadcast]
  )

  const logout = useCallback(async () => {
    // Clean up push subscriptions on logout:
    // 1. Tell backend to remove all records for this browser's endpoint (cross-workspace)
    // 2. Unsubscribe from the browser push service to prevent post-logout notifications
    try {
      const registration = await navigator.serviceWorker?.ready
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch(`${API_BASE}/api/push/cleanup-endpoint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {})
        await subscription.unsubscribe()
      }
    } catch {
      // Best-effort — don't block logout if push cleanup fails
    }
    await clearAllCachedData().catch(() => {})
    localStorage.removeItem(ACTIVE_USER_KEY)
    window.location.href = `${API_BASE}/api/auth/logout`
  }, [])

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refetch: fetchUser,
    addAccount,
    switchAccount,
    removeAccount,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
