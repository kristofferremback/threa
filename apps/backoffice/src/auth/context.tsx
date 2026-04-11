import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"
import { API_BASE, ApiError, api } from "@/api/client"
import type { AuthState, BackofficeUser } from "./types"

interface AuthContextValue extends AuthState {
  login: (redirectTo?: string) => void
  logout: () => void
  refetch: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Backoffice auth provider.
 *
 * Fetches `/api/backoffice/me` to determine both authentication state AND
 * platform-admin authorisation in a single call. Unlike the main frontend,
 * there's no IndexedDB cleanup or push subscription teardown on logout —
 * the backoffice is a thin server-state UI.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  })

  const fetchUser = useCallback(async () => {
    try {
      const user = await api.get<BackofficeUser>("/api/backoffice/me")
      setState({ user, loading: false, error: null })
    } catch (err) {
      // 401 = unauthenticated → render the login screen
      if (ApiError.isApiError(err) && err.status === 401) {
        setState({ user: null, loading: false, error: null })
        return
      }
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

  const logout = useCallback(() => {
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
