import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"
import { API_BASE } from "@/api/client"
import { clearAllCachedData } from "@/db"
import { getCachedUser, setCachedUser, clearCachedUser } from "@/lib/cached-user"
import { clearLastWorkspaceId } from "@/lib/last-workspace"
import type { AuthState, User } from "./types"

declare global {
  interface Window {
    __eagerAuthPromise?: Promise<User | null>
  }
}

interface AuthContextValue extends AuthState {
  login: (redirectTo?: string) => void
  logout: () => void
  refetch: () => Promise<void>
}

// Best-effort push cleanup must never delay the logout redirect for long.
// When the SW is healthy this completes in well under a second; the cap only
// fires when `serviceWorker.ready` never settles (stranded worker).
const PUSH_CLEANUP_TIMEOUT_MS = 2000

// Identity revalidation is a background refresh — the UI already rendered from
// the cached user — so its only job here is to never leak a hung request on a
// dead network. Generous because it never blocks first paint. The eager
// pre-bundle fetch in index.html bounds itself with the same value as a raw
// 15000 (it can't import this constant) — keep the two in sync.
const AUTH_REVALIDATE_TIMEOUT_MS = 15000

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Render instantly from the cached display identity (the httpOnly cookie is
  // still the credential — this is display-only). `loading` stays true only
  // for a genuinely cold first visit so the app doesn't gate on the network.
  const [state, setState] = useState<AuthState>(() => {
    const cachedUser = getCachedUser()
    return { user: cachedUser, loading: !cachedUser, error: null }
  })

  const fetchUser = useCallback(async () => {
    // A 401 is the only authoritative "you are signed out" signal: clear the
    // cached identity and drop to the login redirect.
    const onUnauthenticated = () => {
      clearCachedUser()
      setState({ user: null, loading: false, error: null })
    }
    // Network failure / timeout / 5xx during background revalidation must not
    // sign a returning user out — keep the cached identity so the app stays
    // usable offline. Only a cold visit with no cache falls through to login.
    const onRevalidateFailure = (message: string) => {
      const cachedUser = getCachedUser()
      setState({
        user: cachedUser,
        loading: false,
        error: cachedUser ? null : message,
      })
    }

    try {
      // Consume the eager auth promise started in index.html before the bundle
      // loaded. It resolves to the User, or null on 401; it rejects on network
      // error / 5xx, in which case we fall through to a fresh, bounded fetch.
      const eagerPromise = window.__eagerAuthPromise
      if (eagerPromise) {
        window.__eagerAuthPromise = undefined
        try {
          const user = await eagerPromise
          if (user) {
            setCachedUser(user)
            setState({ user, loading: false, error: null })
          } else {
            onUnauthenticated()
          }
          return
        } catch {
          // Eager fetch failed — fall through to regular fetch
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AUTH_REVALIDATE_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`${API_BASE}/api/auth/me`, {
          credentials: "include",
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (res.status === 401) {
        onUnauthenticated()
        return
      }

      if (!res.ok) {
        throw new Error("Failed to fetch user")
      }

      const user: User = await res.json()
      setCachedUser(user)
      setState({ user, loading: false, error: null })
    } catch (err) {
      onRevalidateFailure(err instanceof Error ? err.message : "Unknown error")
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const login = useCallback((redirectTo?: string) => {
    const url = redirectTo
      ? `${API_BASE}/api/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`
      : `${API_BASE}/api/auth/login`
    window.location.href = url
  }, [])

  const logout = useCallback(async () => {
    // Clean up push subscriptions on logout:
    // 1. Tell backend to remove all records for this browser's endpoint (cross-workspace)
    // 2. Unsubscribe from the browser push service to prevent post-logout notifications
    //
    // `navigator.serviceWorker.ready` only resolves once a worker is active and
    // never rejects, so a worker stranded in "installing" (common with the dev
    // injectManifest module SW) would hang this step — and the redirect below —
    // forever. Cap the whole best-effort block so logout always proceeds.
    const pushCleanup = (async () => {
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
    })()
    await Promise.race([
      pushCleanup,
      new Promise<void>((resolve) => setTimeout(resolve, PUSH_CLEANUP_TIMEOUT_MS)),
    ]).catch(() => {})
    clearCachedUser()
    clearLastWorkspaceId()
    await clearAllCachedData().catch(() => {})
    window.location.href = `${API_BASE}/api/auth/logout`
  }, [])

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refetch: fetchUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
