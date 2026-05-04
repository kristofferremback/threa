import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useClaimScheduled, useReleaseScheduled, useUpdateScheduled, useHeartbeatScheduled } from "@/hooks"
import { toast } from "sonner"
import { parseMarkdown } from "@threa/prosemirror"

interface ScheduledEditDialogProps {
  workspaceId: string
  scheduled: ScheduledMessageView | null
  onClose: () => void
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Edit modal for the page surface. Claims the lock on open, releases on close,
 * heartbeats every 30s while open. Past-time semantics: when scheduled_for is
 * already in the past, the primary action label flips to "Send" and the
 * server's PATCH handler atomically performs the send (Save = Send).
 *
 * v1 uses plain markdown textarea + datetime-local input — full ProseMirror
 * composer reuse is a follow-up. Backend accepts contentJson + contentMarkdown
 * already; we send markdown only here and rely on the next edit through the
 * full composer (or message-edit flow) to reconcile contentJson if needed.
 */
export function ScheduledEditDialog({ workspaceId, scheduled, onClose }: ScheduledEditDialogProps) {
  const claimMutation = useClaimScheduled(workspaceId)
  const releaseMutation = useReleaseScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const heartbeatMutation = useHeartbeatScheduled(workspaceId)

  const [lockToken, setLockToken] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [scheduledFor, setScheduledFor] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const acquiringRef = useRef(false)

  const open = scheduled !== null

  // Reset local state when the row id changes — guards against the dialog
  // being reused for a different scheduled message without an explicit close
  // step. Without this, stale lockToken / content / scheduledFor from the
  // previous row would persist into the next claim.
  const previousIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = scheduled?.id ?? null
    if (previousIdRef.current !== id) {
      setLockToken(null)
      setContent("")
      setScheduledFor("")
      setError(null)
      previousIdRef.current = id
    }
  }, [scheduled?.id])

  // Claim on open. Releases happen on close (in `handleClose`) — never in
  // the cleanup of this effect because the dialog can re-render mid-claim
  // and we'd accidentally release a token we just acquired.
  useEffect(() => {
    if (!open || !scheduled || acquiringRef.current || lockToken) return
    acquiringRef.current = true
    claimMutation
      .mutateAsync(scheduled.id)
      .then((res) => {
        setLockToken(res.lockToken)
        setContent(res.scheduled.contentMarkdown)
        setScheduledFor(toDatetimeLocal(res.scheduled.scheduledFor))
        setError(null)
      })
      .catch((err: Error) => {
        setError(err.message || "Could not start editing")
      })
      .finally(() => {
        acquiringRef.current = false
      })
    // claimMutation is a stable mutation handle from useMutation; we
    // intentionally re-acquire only when the dialog opens or the row id
    // changes.
  }, [open, scheduled, lockToken, claimMutation])

  // Heartbeat while the dialog is open. Skipped during the brief acquiring
  // window so we don't fire a heartbeat against a token that hasn't landed
  // yet.
  useEffect(() => {
    if (!open || !scheduled || !lockToken) return
    const interval = setInterval(() => {
      heartbeatMutation.mutate({ id: scheduled.id, lockToken })
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open, scheduled, lockToken, heartbeatMutation])

  const handleClose = () => {
    if (scheduled && lockToken) {
      releaseMutation.mutate({ id: scheduled.id, lockToken })
    }
    setLockToken(null)
    setContent("")
    setScheduledFor("")
    setError(null)
    onClose()
  }

  const isPast = useMemo(() => {
    if (!scheduledFor) return false
    return new Date(scheduledFor).getTime() <= Date.now()
  }, [scheduledFor])

  const handleSave = async () => {
    if (!scheduled || !lockToken) return
    try {
      // Re-derive contentJson from the edited markdown so the canonical
      // ProseMirror representation stays in sync (INV-58). Otherwise the row
      // would carry stale contentJson at fire time and the live message would
      // ship the pre-edit document.
      const contentJson = parseMarkdown(content)
      await updateMutation.mutateAsync({
        id: scheduled.id,
        input: {
          contentJson,
          contentMarkdown: content,
          scheduledFor: new Date(scheduledFor).toISOString(),
          lockToken,
        },
      })
      toast.success(isPast ? "Sent" : "Updated")
      handleClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not save"
      setError(message)
    }
  }

  const isLoadingClaim = open && !lockToken && !error
  const isSaving = updateMutation.isPending

  let body: React.ReactNode = null
  if (isLoadingClaim) {
    body = (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Acquiring lock…
      </div>
    )
  } else if (error) {
    body = <div className="text-sm text-destructive">{error}</div>
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Send at</label>
          <Input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            disabled={isSaving}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Message</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            disabled={isSaving}
            className="resize-y"
          />
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isPast ? "Send scheduled message" : "Edit scheduled message"}</DialogTitle>
          {isPast && (
            <DialogDescription>
              Scheduled time has passed — this message will be sent as soon as you finish editing.
            </DialogDescription>
          )}
          {!isPast && lockToken && (
            <DialogDescription>Editing — release the lock by closing this dialog.</DialogDescription>
          )}
        </DialogHeader>

        {body}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSaving}>
            {isPast && lockToken ? "Send unchanged" : "Cancel"}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!lockToken || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isPast ? "Send" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
