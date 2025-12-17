import { useAuth } from "@/auth"
import { Button } from "@/components/ui/button"
import { Navigate } from "react-router-dom"

export function LoginPage() {
  const { user, login, loading } = useAuth()

  // Redirect if already logged in
  if (user) {
    return <Navigate to="/workspaces" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Threa</h1>
          <p className="mt-2 text-muted-foreground">AI-powered knowledge chat</p>
        </div>
        <Button onClick={() => login()} disabled={loading} size="lg">
          {loading ? "Loading..." : "Sign in with WorkOS"}
        </Button>
      </div>
    </div>
  )
}
