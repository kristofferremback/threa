import { createContext, useState, useEffect, type ReactNode, type FC } from "react"
import type { User } from "./types"

type AuthContextValue = {
  isAuthenticated: boolean
  user: User | null
  state: "new" | "loading" | "loaded" | "error"
  error?: Error
}

export const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  user: null,
  state: "new",
})

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<"new" | "loading" | "loaded" | "error">("new")
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    console.log("AuthProvider: Checking authentication status", { state, user, error })
    if (state !== "new") return

    setState("loading")

    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          // Unauthorized - user is not authenticated (this is normal, not an error)
          console.log("AuthProvider: 401 - User not authenticated")
          setUser(null)
          setState("loaded")
          return
        }

        if (!res.ok) {
          console.log("AuthProvider: Non-401 error", res.status)
          setState("error")
          setUser(null) // Ensure user is null on error too
          setError(new Error("Failed to fetch auth status"))
          return
        }

        const data = (await res.json()) as User
        console.log("AuthProvider: User authenticated", data.email)
        setUser(data)
        setState("loaded")
      })
      .catch((err) => {
        console.error("AuthProvider: Fetch error", err)
        setState("error")
        setUser(null) // Ensure user is null on error
        setError(err as Error)
      })
  }, [state])

  // Listen for 401 errors from other API calls
  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      
      // If we get a 401, mark user as logged out (not an error state)
      // Only redirect if we're not already showing the login screen
      if (response.status === 401) {
        setUser(null)
        setState("loaded")
        
        // Redirect to login only if we're not already on a page that shows login
        const currentPath = window.location.pathname
        if (!currentPath.includes("/api/auth/login") && currentPath !== "/") {
          window.location.href = "/api/auth/login"
        }
      }
      
      return response
    }

    return () => {
      window.fetch = originalFetch
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: user !== null,
        user,
        state,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
