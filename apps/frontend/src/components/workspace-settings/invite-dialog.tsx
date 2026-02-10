import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { invitationsApi } from "@/api/invitations"
import type { SendInvitationsResponse } from "@threa/types"

interface InviteDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function InviteDialog({ workspaceId, open, onOpenChange, onSuccess }: InviteDialogProps) {
  const [emailsText, setEmailsText] = useState("")
  const [role, setRole] = useState<"admin" | "member">("member")
  const [result, setResult] = useState<SendInvitationsResponse | null>(null)

  const sendMutation = useMutation({
    mutationFn: () => {
      const emails = emailsText
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0)

      return invitationsApi.send(workspaceId, { emails, role })
    },
    onSuccess: (data) => {
      setResult(data)
      onSuccess()
    },
  })

  const handleClose = () => {
    setEmailsText("")
    setRole("member")
    setResult(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            {result.sent.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Sent {result.sent.length} invitation{result.sent.length !== 1 ? "s" : ""}
                </p>
                {result.sent.map((inv) => (
                  <p key={inv.id} className="text-sm text-muted-foreground">
                    {inv.email}
                  </p>
                ))}
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Skipped {result.skipped.length}</p>
                {result.skipped.map((s, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    {s.email} — {s.reason}
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
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending || !emailsText.trim()}>
                {sendMutation.isPending ? "Sending..." : "Send Invitations"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
