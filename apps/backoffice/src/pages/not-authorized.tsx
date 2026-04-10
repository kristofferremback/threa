import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/auth"

export function NotAuthorizedPage() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Not authorised</CardTitle>
          <CardDescription>
            You're signed in, but your account doesn't have access to the Threa backoffice.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {user ? (
            <p>
              Signed in as <span className="font-medium text-foreground">{user.email}</span>. If you think this is a
              mistake, ask a platform admin to grant you access.
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={logout}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
