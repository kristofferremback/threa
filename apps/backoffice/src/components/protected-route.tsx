import { useEffect } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/auth"
import { BackofficeShell } from "@/components/layout/backoffice-shell"

/**
 * Gate for all signed-in backoffice routes.
 *
 * Four outcomes:
 * 1. loading          → placeholder while `/api/backoffice/me` is in flight
 * 2. unauthenticated  → kick to WorkOS login with a return path
 * 3. not authorised   → redirect to `/not-authorized` so the user sees a
 *                        helpful page instead of a silent bounce
 * 4. authorised admin → render the shell + the current route
 */
export function ProtectedRoute() {
  const { user, loading, login } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (!loading && !user) {
      login(location.pathname + location.search)
    }
  }, [loading, user, login, location.pathname, location.search])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading backoffice…
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Redirecting to sign in…
      </div>
    )
  }

  if (!user.isPlatformAdmin) {
    return <Navigate to="/not-authorized" replace />
  }

  return <BackofficeShell />
}
