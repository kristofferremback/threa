import { useContext } from "react"
import { AuthContext } from "./context"

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export function useUser() {
  const { user } = useAuth()
  return user
}

export function useRequireAuth() {
  const auth = useAuth()
  if (!auth.loading && !auth.user) {
    auth.login(window.location.pathname)
  }
  return auth
}
