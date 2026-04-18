import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { invitationsApi } from "@/api/invitations"
import type { SendInvitationsResponse, WorkspaceRole } from "@threa/types"

function compatibilityRoleForInvite(roleSlug: string, roles: WorkspaceRole[]): "admin" | "user" {
  const role = roles.find((candidate) => candidate.slug === roleSlug)
  if (!role) {
    return roleSlug === "admin" ? "admin" : "user"
  }

  return role.permissions.includes("members:write") || role.permissions.includes("workspace:admin") ? "admin" : "user"
}

interface InviteDialogProps {
  workspaceId: string
  roles: WorkspaceRole[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function InviteDialog({ workspaceId, roles, open, onOpenChange, onSuccess }: InviteDialogProps) {
  const [emailsText, setEmailsText] = useState("")
  const [roleSlug, setRoleSlug] = useState("")
  const [result, setResult] = useState<SendInvitationsResponse | null>(null)

  useEffect(() => {
    if (!roleSlug && roles.length > 0) {
      setRoleSlug(roles[0].slug)
    }
  }, [roleSlug, roles])

  const sendMutation = useMutation({
    mutationFn: () => {
      const emails = emailsText
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0)

      return invitationsApi.send(workspaceId, {
        emails,
        role: compatibilityRoleForInvite(roleSlug, roles),
        roleSlug,
      })
    },
    onSuccess: (data) => {
      setResult(data)
      onSuccess()
    },
  })

  const handleClose = () => {
    setEmailsText("")
    setRoleSlug(roles[0]?.slug ?? "")
    setResult(null)
    onOpenChange(false)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Invite Users</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {result ? (
          <div className="space-y-4 px-4 sm:px-6">
            {result.sent.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Sent {result.sent.length} invitation{result.sent.length !== 1 ? "s" : ""}
                </p>
                {result.sent.map((inv) => (
                  <p key={inv.id} className="text-sm text-muted-foreground">
                    {inv.email} · {inv.assignedRole?.name ?? inv.roleSlug}
                  </p>
                ))}
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Skipped {result.skipped.length}</p>
                {result.skipped.map((s, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    {s.email} — {s.reason === "already_user" ? "Already a user" : "Invitation already pending"}
                  </p>
                ))}
              </div>
            )}

            <ResponsiveDialogFooter>
              <Button onClick={handleClose} className="sm:w-auto w-full">
                Done
              </Button>
            </ResponsiveDialogFooter>
          </div>
        ) : (
          <div className="space-y-4 px-4 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="emails">Email addresses</Label>
              <Textarea
                id="emails"
                placeholder="Enter emails, one per line or comma-separated"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={roleSlug} onValueChange={setRoleSlug}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.slug} value={role.slug}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !emailsText.trim() || !roleSlug}
              >
                {sendMutation.isPending ? "Sending..." : "Send Invitations"}
              </Button>
            </ResponsiveDialogFooter>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
