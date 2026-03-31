import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"
import { API_BASE } from "@/api/client"
import { clearAllCachedData } from "@/db"
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

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  })

  const fetchUser = useCallback(async () => {
    try {
      // Consume the eager auth promise started in index.html before the bundle loaded.
      // If the eager promise rejected (network error, 500, etc.) we fall through
      // to a fresh fetch so error handling works correctly.
      const eagerPromise = window.__eagerAuthPromise
      if (eagerPromise) {
        window.__eagerAuthPromise = undefined
        try {
          const user = await eagerPromise
          setState({ user, loading: false, error: null })
          return
        } catch {
          // Eager fetch failed — fall through to regular fetch
        }
      }

      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })

      if (res.status === 401) {
        setState({ user: null, loading: false, error: null })
        return
      }

      if (!res.ok) {
        throw new Error("Failed to fetch user")
      }

      const user: User = await res.json()
      setState({ user, loading: false, error: null })
    } catch (err) {
      setState({
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      })
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
