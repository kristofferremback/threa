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
        if (!res.ok) {
          setState("error")
          setError(new Error("Failed to fetch auth status"))
          return
        }

        const data = (await res.json()) as User
        setUser(data)
        setState("loaded")
      })
      .catch((err) => {
        setState("error")
        setError(err as Error)
      })
  }, [state])

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
