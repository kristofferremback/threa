import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { AuthState, User } from "./types"

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
      const res = await fetch("/api/auth/me", { credentials: "include" })

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
      ? `/api/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`
      : "/api/auth/login"
    window.location.href = url
  }, [])

  const logout = useCallback(() => {
    window.location.href = "/api/auth/logout"
  }, [])

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refetch: fetchUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
