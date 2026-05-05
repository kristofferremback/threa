import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Check, Copy, Link as LinkIcon } from "lucide-react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { invitationsApi } from "@/api/invitations"

interface CreateInviteLinkDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  /** Receives the plaintext token immediately after creation. Token is never retrievable later. */
  onTokenCreated?: (invitationId: string, token: string) => void
}

/**
 * Build the share URL from the current origin so the link reads naturally
 * on whatever frontend the admin is using (staging, PR preview, prod) without
 * the backend having to know about it.
 */
function buildJoinUrl(token: string): string {
  if (typeof window === "undefined") return `/join/${token}`
  return `${window.location.origin}/join/${token}`
}

export function CreateInviteLinkDialog({
  workspaceId,
  open,
  onOpenChange,
  onSuccess,
  onTokenCreated,
}: CreateInviteLinkDialogProps) {
  const [role, setRole] = useState<"admin" | "user">("user")
  const [note, setNote] = useState("")
  const [copied, setCopied] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      invitationsApi.createLink(workspaceId, {
        role,
        note: note.trim() || undefined,
      }),
    onSuccess: (data) => {
      setCreatedToken(data.token)
      onTokenCreated?.(data.invitation.id, data.token)
      onSuccess()
    },
  })

  const handleClose = () => {
    setRole("user")
    setNote("")
    setCopied(false)
    setCreatedToken(null)
    onOpenChange(false)
  }

  const handleCopy = async () => {
    if (!createdToken) return
    try {
      await navigator.clipboard.writeText(buildJoinUrl(createdToken))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail in insecure contexts — ignore silently.
    }
  }

  const joinUrl = createdToken ? buildJoinUrl(createdToken) : ""

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{createdToken ? "Invite link ready" : "Create invite link"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {createdToken ? (
          <div className="space-y-4 px-4 sm:px-6">
            <p className="text-sm text-muted-foreground">
              Share this link through any channel. The recipient enters their email to join — single use, expires in 7
              days.
            </p>

            <div className="space-y-2">
              <Label htmlFor="link">Share link</Label>
              <div className="flex gap-2">
                <Input
                  id="link"
                  readOnly
                  value={joinUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label={copied ? "Copied" : "Copy link"}
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We never store the full link — only its hash. Copy it now; you won't see it again.
              </p>
            </div>

            <ResponsiveDialogFooter>
              <Button onClick={handleClose} className="sm:w-auto w-full">
                Done
              </Button>
            </ResponsiveDialogFooter>
          </div>
        ) : (
          <div className="space-y-4 px-4 sm:px-6">
            <p className="text-sm text-muted-foreground">
              Generate a single-use link and share it however you want. The recipient enters their email when they open
              the link.
            </p>

            <div className="space-y-2">
              <Label htmlFor="link-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "user")}>
                <SelectTrigger id="link-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-note">Note (optional)</Label>
              <Input
                id="link-note"
                placeholder="for Simon — sent via Signal"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                Only visible to admins. Helps you remember what each link is for.
              </p>
            </div>

            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create link."}
              </p>
            )}

            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  "Creating..."
                ) : (
                  <>
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Create link
                  </>
                )}
              </Button>
            </ResponsiveDialogFooter>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
