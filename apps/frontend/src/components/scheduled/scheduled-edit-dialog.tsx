import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { JSONContent, ScheduledMessageView } from "@threa/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RichEditor } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { useIsMobile } from "@/hooks/use-mobile"
import { useClaimScheduled, useReleaseScheduled, useUpdateScheduled, useHeartbeatScheduled } from "@/hooks"
import { toast } from "sonner"
import { serializeToMarkdown } from "@threa/prosemirror"
import { EMPTY_DOC } from "@/lib/prosemirror-utils"

interface ScheduledEditDialogProps {
  workspaceId: string
  scheduled: ScheduledMessageView | null
  onClose: () => void
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Edit modal for the page surface (and the in-composer popover). Claims the
 * lock on open, heartbeats every 30s, releases on close. Past-time semantics:
 * when scheduled_for is already in the past, the primary action label flips
 * to "Send" and the server's PATCH atomically performs the send (Save = Send).
 *
 * Uses the same `RichEditor` primitive `MessageEditForm` uses so editing a
 * scheduled message gets the full chrome (formatting, mentions, slash
 * commands) — not a plain textarea. Attachment changes are out of scope for
 * v1; the create path supports them and the edit path keeps the existing
 * attachment_ids untouched.
 *
 * Mobile uses a `<Drawer>` bottom sheet matching the live message-edit-form
 * pattern; desktop uses a centered `<Dialog>`.
 */
export function ScheduledEditDialog({ workspaceId, scheduled, onClose }: ScheduledEditDialogProps) {
  const isMobile = useIsMobile()
  const claimMutation = useClaimScheduled(workspaceId)
  const releaseMutation = useReleaseScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const heartbeatMutation = useHeartbeatScheduled(workspaceId)

  const [lockToken, setLockToken] = useState<string | null>(null)
  const [contentJson, setContentJson] = useState<JSONContent>(EMPTY_DOC)
  const [scheduledFor, setScheduledFor] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const acquiringRef = useRef(false)
  const editorRef = useRef<RichEditorHandle | null>(null)

  const open = scheduled !== null

  // Reset local state when the row id changes — guards against the dialog
  // being reused for a different scheduled message without an explicit close.
  const previousIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = scheduled?.id ?? null
    if (previousIdRef.current !== id) {
      setLockToken(null)
      setContentJson(EMPTY_DOC)
      setScheduledFor("")
      setError(null)
      previousIdRef.current = id
    }
  }, [scheduled?.id])

  // Claim on open. Releases happen on close (in `handleClose`) — never in the
  // cleanup of this effect because the dialog can re-render mid-claim and we'd
  // accidentally release a token we just acquired.
  useEffect(() => {
    if (!open || !scheduled || acquiringRef.current || lockToken) return
    acquiringRef.current = true
    claimMutation
      .mutateAsync(scheduled.id)
      .then((res) => {
        setLockToken(res.lockToken)
        setContentJson(res.scheduled.contentJson || EMPTY_DOC)
        setScheduledFor(toDatetimeLocal(res.scheduled.scheduledFor))
        setError(null)
      })
      .catch((err: Error) => {
        setError(err.message || "Could not start editing")
      })
      .finally(() => {
        acquiringRef.current = false
      })
  }, [open, scheduled, lockToken, claimMutation])

  // Heartbeat while the dialog is open.
  useEffect(() => {
    if (!open || !scheduled || !lockToken) return
    const interval = setInterval(() => {
      heartbeatMutation.mutate({ id: scheduled.id, lockToken })
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open, scheduled, lockToken, heartbeatMutation])

  const handleClose = useCallback(() => {
    if (scheduled && lockToken) {
      releaseMutation.mutate({ id: scheduled.id, lockToken })
    }
    setLockToken(null)
    setContentJson(EMPTY_DOC)
    setScheduledFor("")
    setError(null)
    onClose()
  }, [scheduled, lockToken, releaseMutation, onClose])

  const isPast = useMemo(() => {
    if (!scheduledFor) return false
    return new Date(scheduledFor).getTime() <= Date.now()
  }, [scheduledFor])

  const setRichEditorHandle = useCallback((handle: RichEditorHandle | null) => {
    editorRef.current = handle
  }, [])

  const handleSave = useCallback(async () => {
    if (!scheduled || !lockToken) return
    try {
      // Snapshot the editor's live JSON (RichEditor only flushes on blur via
      // `onChange`; reading the editor handle gives us the current state even
      // mid-typing, matching how the live composer flushes on submit).
      const liveJson = (editorRef.current?.getEditor()?.getJSON() as JSONContent | undefined) ?? contentJson
      const contentMarkdown = serializeToMarkdown(liveJson)
      await updateMutation.mutateAsync({
        id: scheduled.id,
        input: {
          contentJson: liveJson,
          contentMarkdown,
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
  }, [scheduled, lockToken, contentJson, scheduledFor, isPast, updateMutation, handleClose])

  const isLoadingClaim = open && !lockToken && !error
  const isSaving = updateMutation.isPending

  const description = (() => {
    if (isPast) {
      return "Scheduled time has passed — this message will be sent as soon as you finish editing."
    }
    if (lockToken) {
      return "Editing — release the lock by closing this dialog."
    }
    return null
  })()

  const body = (() => {
    if (isLoadingClaim) {
      return (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Acquiring lock…
        </div>
      )
    }
    if (error) {
      return <div className="text-sm text-destructive">{error}</div>
    }
    return (
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
          <div className="rounded-md border bg-background [&_.tiptap]:min-h-[6rem] [&_.tiptap]:max-h-72 [&_.tiptap]:overflow-y-auto">
            <RichEditor
              ref={setRichEditorHandle}
              value={contentJson}
              onChange={setContentJson}
              onSubmit={handleSave}
              placeholder="Edit message…"
              ariaLabel="Edit scheduled message"
              messageSendMode="cmdEnter"
              disabled={isSaving}
              autoFocus
              blurOnEscape
            />
          </div>
        </div>
      </div>
    )
  })()

  const cancelLabel = isPast && lockToken ? "Send unchanged" : "Cancel"
  const saveLabel = isPast ? "Send" : "Save"
  const title = isPast ? "Send scheduled message" : "Edit scheduled message"

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) handleClose()
        }}
      >
        <DrawerContent className="max-h-[92dvh]">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="flex flex-col gap-3 px-4 pb-[max(8px,env(safe-area-inset-bottom))] pt-1">
            <div>
              <p className="text-sm font-medium">{title}</p>
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            {body}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={isSaving}>
                {cancelLabel}
              </Button>
              <Button type="button" onClick={handleSave} disabled={!lockToken || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {saveLabel}
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {body}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSaving}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!lockToken || isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saveLabel}
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
