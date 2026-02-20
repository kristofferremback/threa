import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { invitationsApi } from "@/api/invitations"
import type { SendWorkspaceCreationInvitationsResponse } from "@threa/types"

interface WorkspaceCreationInviteDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function parseEmails(emailsText: string): string[] {
  return [
    ...new Set(
      emailsText
        .split(/[,\n]/)
        .map((email) => email.trim())
        .filter((email) => email.length > 0)
    ),
  ]
}

export function WorkspaceCreationInviteDialog({
  workspaceId,
  open,
  onOpenChange,
  onSuccess,
}: WorkspaceCreationInviteDialogProps) {
  const [emailsText, setEmailsText] = useState("")
  const [result, setResult] = useState<SendWorkspaceCreationInvitationsResponse | null>(null)

  const sendMutation = useMutation({
    mutationFn: () => invitationsApi.sendWorkspaceCreation(workspaceId, { emails: parseEmails(emailsText) }),
    onSuccess: (data) => {
      setResult(data)
      onSuccess?.()
    },
  })

  const handleClose = () => {
    setEmailsText("")
    setResult(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Workspace Creators</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            {result.sent.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Sent {result.sent.length} workspace creation invite{result.sent.length !== 1 ? "s" : ""}
                </p>
                {result.sent.map((email) => (
                  <p key={email} className="text-sm text-muted-foreground">
                    {email}
                  </p>
                ))}
              </div>
            )}

            {result.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Failed {result.failed.length}</p>
                {result.failed.map((entry) => (
                  <p key={entry.email} className="text-sm text-muted-foreground">
                    {entry.email} — {entry.error}
                  </p>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-creation-emails">Email addresses</Label>
              <Textarea
                id="workspace-creation-emails"
                placeholder="Enter emails, one per line or comma-separated"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                rows={4}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending || !emailsText.trim()}>
                {sendMutation.isPending ? "Sending..." : "Send Invites"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
