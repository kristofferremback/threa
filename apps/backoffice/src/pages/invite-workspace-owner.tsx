import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/api/client"

interface InvitationResponse {
  invitation: {
    id: string
    email: string
    expiresAt: string
  }
}

function inviteWorkspaceOwner(email: string): Promise<InvitationResponse> {
  return api.post<InvitationResponse>("/api/backoffice/workspace-owner-invitations", { email })
}

function getErrorMessage(error: unknown): string | null {
  if (!error) return null
  if (ApiError.isApiError(error)) return error.message
  return "Something went wrong"
}

export function InviteWorkspaceOwnerPage() {
  const [email, setEmail] = useState("")

  const mutation = useMutation({
    mutationFn: (payload: string) => inviteWorkspaceOwner(payload),
    onSuccess: () => setEmail(""),
  })

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email) return
    mutation.mutate(email)
  }

  const errorMessage = getErrorMessage(mutation.error)

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Invite a workspace owner</h1>
        <p className="text-sm text-muted-foreground">
          Sends a Threa invitation via WorkOS. When the invitee accepts and signs in, they can create their own
          workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New invitation</CardTitle>
          <CardDescription>Enter the email address of the person you want to invite.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="owner@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={mutation.isPending}
              />
            </div>

            {mutation.isSuccess ? (
              <p className="text-sm text-primary">
                Invitation sent to <span className="font-medium">{mutation.data.invitation.email}</span>.
              </p>
            ) : null}

            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

            <div>
              <Button type="submit" disabled={mutation.isPending || !email}>
                {mutation.isPending ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
