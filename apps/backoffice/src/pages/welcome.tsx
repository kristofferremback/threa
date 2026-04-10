import { Link } from "react-router-dom"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useUser } from "@/auth"

export function WelcomePage() {
  // ProtectedRoute guarantees a signed-in admin renders this page, so `user`
  // is non-null in practice. We still guard with optional chaining for types.
  const user = useUser()
  const displayName = user?.name || user?.email

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome{displayName ? `, ${displayName}` : ""}.</h1>
        <p className="text-muted-foreground">
          This is the Threa backoffice — the home of everything that isn't bound to a single workspace. New sections
          (billing, platform users, audits) will land here over time.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="size-5 text-primary" />
              Workspace owner invites
            </CardTitle>
            <CardDescription>
              Send a Threa invitation to a new workspace owner. When they accept and sign in, they'll be able to create
              their own workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/invites/workspace-owners">Invite a workspace owner</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
