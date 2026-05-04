import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { StreamTypes, type JSONContent, type ScheduledMessageView } from "@threa/types"
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
import {
  useClaimScheduled,
  useReleaseScheduled,
  useUpdateScheduled,
  useHeartbeatScheduled,
  useStreamBootstrap,
} from "@/hooks"
import { useAttachments } from "@/hooks/use-attachments"
import { useWorkspaceStreams, useWorkspaceUsers } from "@/stores/workspace-store"
import { useUser } from "@/auth"
import type { MentionStreamContext } from "@/hooks/use-mentionables"
import { toast } from "sonner"
import { collectAttachmentReferenceIds, serializeToMarkdown } from "@threa/prosemirror"
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

  // Mention/channel/emoji context — RichEditor pulls workspace users, channels,
  // and emojis from useParams + workspace store, but @channel/@here broadcast
  // mentions need explicit `streamContext` keyed to the destination stream.
  // Without this, the picker would surface broadcast mentions for streams the
  // user can't actually broadcast to (server-side validation would still
  // reject, but the UX is misleading).
  const streamContext = useDestinationStreamContext(workspaceId, scheduled?.streamId)

  // Attachment uploads on paste/drop. Reuses the same uploader the live
  // composer uses, scoped to this workspace. The editor handles per-node
  // status (uploading → uploaded) via the attachment-reference node's attrs;
  // we only need to pass `uploadFile` and the running image count.
  const attachmentsHook = useAttachments(workspaceId)

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
      // Snapshot the editor's live JSON. RichEditor flushes via onChange, but
      // reading the handle gives the canonical state even mid-typing (matches
      // how the live composer reads on submit).
      const liveJson = (editorRef.current?.getEditor()?.getJSON() as JSONContent | undefined) ?? contentJson
      const contentMarkdown = serializeToMarkdown(liveJson)
      // Reconcile attachment_ids with whatever the editor currently shows.
      // Existing chips that the user deleted disappear from the JSON; new
      // paste/drop uploads land as attachment-reference nodes. The union of
      // (existing-untouched, newly-pasted) is exactly what's in contentJson.
      const attachmentIds = collectAttachmentReferenceIds(liveJson)
      await updateMutation.mutateAsync({
        id: scheduled.id,
        input: {
          contentJson: liveJson,
          contentMarkdown,
          scheduledFor: new Date(scheduledFor).toISOString(),
          attachmentIds,
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
              onFileUpload={attachmentsHook.uploadFile}
              imageCount={attachmentsHook.imageCount}
              placeholder="Edit message…"
              ariaLabel="Edit scheduled message"
              messageSendMode="cmdEnter"
              disabled={isSaving}
              autoFocus
              blurOnEscape
              scopeId={scheduled?.id}
              streamContext={streamContext}
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

/**
 * Compose a `MentionStreamContext` for the scheduled message's destination
 * stream — same shape `MessageInput` builds for the live composer. Without
 * this, broadcast mentions (@channel / @here) would surface for streams the
 * user can't broadcast to. Threads inherit access from their root stream.
 *
 * Returns `undefined` when the destination stream isn't known yet (dialog
 * still loading) so the editor falls back to no-broadcast-mentions rather
 * than wrong ones.
 */
function useDestinationStreamContext(
  workspaceId: string,
  destinationStreamId: string | undefined
): MentionStreamContext | undefined {
  const idbStreams = useWorkspaceStreams(workspaceId)
  const stream = useMemo(
    () => (destinationStreamId ? idbStreams.find((s) => s.id === destinationStreamId) : undefined),
    [idbStreams, destinationStreamId]
  )
  const rootStreamId = stream?.rootStreamId ?? null

  // Bootstrap of the access stream (root for threads, self for everything
  // else) carries the member list + bot grants the editor needs to filter
  // user mentions. Same pattern as message-input.
  const { data: currentBootstrap } = useStreamBootstrap(workspaceId, destinationStreamId ?? "", {
    enabled: !!destinationStreamId && !rootStreamId,
  })
  const { data: rootBootstrap } = useStreamBootstrap(workspaceId, rootStreamId ?? "", {
    enabled: !!rootStreamId,
  })
  const accessBootstrap = rootStreamId ? rootBootstrap : currentBootstrap

  const currentUser = useUser()
  const workspaceUsers = useWorkspaceUsers(workspaceId)
  const currentUserRole = useMemo(
    () => workspaceUsers.find((u) => u.workosUserId === currentUser?.id)?.role,
    [workspaceUsers, currentUser?.id]
  )

  return useMemo<MentionStreamContext | undefined>(() => {
    if (!stream) return undefined
    const ctx: MentionStreamContext = { streamType: stream.type }
    if (stream.type === StreamTypes.THREAD && stream.rootStreamId) {
      const rootStream = idbStreams.find((s) => s.id === stream.rootStreamId)
      if (rootStream) ctx.rootStreamType = rootStream.type
    }
    if (accessBootstrap?.members) {
      const ids = new Set(accessBootstrap.members.map((m) => m.memberId))
      for (const botId of accessBootstrap.botMemberIds ?? []) ids.add(botId)
      ctx.memberIds = ids
    }
    if (accessBootstrap?.botMemberIds) ctx.botMemberIds = new Set(accessBootstrap.botMemberIds)
    ctx.canInviteBots = currentUserRole === "admin" || currentUserRole === "owner"
    return ctx
  }, [stream, idbStreams, accessBootstrap, currentUserRole])
}
