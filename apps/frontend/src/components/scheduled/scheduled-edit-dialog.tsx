import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { Editor } from "@tiptap/react"
import { StreamTypes, type JSONContent, type ScheduledMessageView } from "@threa/types"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RichEditor, EditorActionBar, EditorToolbar, DocumentEditorModal } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
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
import { materializePendingAttachmentReferences } from "@/components/timeline/message-input"
import { toast } from "sonner"
import { collectAttachmentReferenceIds, parseMarkdown, serializeToMarkdown } from "@threa/prosemirror"
import { EMPTY_DOC } from "@/lib/prosemirror-utils"

interface ScheduledEditDialogProps {
  workspaceId: string
  scheduled: ScheduledMessageView | null
  onClose: () => void
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Edit modal for the page surface (and the in-composer popover). Hosts the
 * same editor primitives the live composer uses — `RichEditor` for the body,
 * `EditorActionBar` for the chrome row (attach / format / mention / emoji,
 * plus a desktop expand affordance that pops into `DocumentEditorModal`).
 *
 * The lock/claim flow:
 *   - claim on open, heartbeat every 30s, release on close
 *   - past-time saves flip the action label to "Send" and the server PATCHes
 *     atomically into a send (Save = Send semantics)
 *
 * Attachments:
 *   - existing attachment-reference nodes ride along inside `contentJson`
 *     and render inline; users can delete them like any other node
 *   - new files via the attach button or paste/drop go through the same
 *     `useAttachments` pipeline as the live composer; on save we run
 *     `materializePendingAttachmentReferences` to fold pending uploads into
 *     the final JSON, then `collectAttachmentReferenceIds` to recompute the
 *     attachment_ids array
 *
 * Mobile renders as a `<Drawer>` bottom sheet (matches `MessageEditForm`);
 * desktop renders as a centered `<Dialog>`. Desktop also exposes
 * `DocumentEditorModal` as the fullscreen-edit affordance — same component
 * the live composer uses for its expand button, so the two share visual
 * vocabulary.
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
  const [formatOpen, setFormatOpen] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [docEditorOpen, setDocEditorOpen] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null)
  const acquiringRef = useRef(false)
  const editorRef = useRef<RichEditorHandle | null>(null)

  const streamContext = useDestinationStreamContext(workspaceId, scheduled?.streamId)
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
      setFormatOpen(false)
      setMobileExpanded(false)
      setDocEditorOpen(false)
      attachmentsHook.clear()
      previousIdRef.current = id
    }
  }, [scheduled?.id, attachmentsHook])

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
    setFormatOpen(false)
    setMobileExpanded(false)
    setDocEditorOpen(false)
    attachmentsHook.clear()
    onClose()
  }, [scheduled, lockToken, releaseMutation, attachmentsHook, onClose])

  const isPast = useMemo(() => {
    if (!scheduledFor) return false
    return new Date(scheduledFor).getTime() <= Date.now()
  }, [scheduledFor])

  const setRichEditorHandle = useCallback((handle: RichEditorHandle | null) => {
    editorRef.current = handle
    const next = handle?.getEditor() ?? null
    setToolbarEditor((cur) => (cur === next ? cur : next))
  }, [])

  const handleSave = useCallback(async () => {
    if (!scheduled || !lockToken) return
    try {
      // Snapshot the editor's live JSON, then fold any still-pending
      // attachment uploads into the document so they ride along on save —
      // mirrors the live composer's submit path. `collectAttachmentReferenceIds`
      // then captures the union of (existing-untouched, newly-pasted,
      // button-added) attachments for the row's array.
      const liveJson = (editorRef.current?.getEditor()?.getJSON() as JSONContent | undefined) ?? contentJson
      const materialized = materializePendingAttachmentReferences(
        liveJson,
        attachmentsHook.getPendingAttachmentsSnapshot()
      )
      const contentMarkdown = serializeToMarkdown(materialized)
      const attachmentIds = collectAttachmentReferenceIds(materialized)
      await updateMutation.mutateAsync({
        id: scheduled.id,
        input: {
          contentJson: materialized,
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
  }, [scheduled, lockToken, contentJson, scheduledFor, isPast, updateMutation, handleClose, attachmentsHook])

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

  const cancelLabel = isPast && lockToken ? "Send unchanged" : "Cancel"
  const saveLabel = isPast ? "Send" : "Save"
  const title = isPast ? "Send scheduled message" : "Edit scheduled message"

  const trailingActions = (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isSaving}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={handleSave} disabled={!lockToken || isSaving}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {saveLabel}
      </Button>
    </>
  )

  const editorBody = (() => {
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
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Message</label>
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
              staticToolbarOpen={!isMobile && formatOpen}
              belowToolbarContent={
                attachmentsHook.pendingAttachments.length > 0 ? (
                  <div className="pt-1 pb-2 border-b border-border/50 [&>div]:mb-0">
                    <PendingAttachments
                      attachments={attachmentsHook.pendingAttachments}
                      onRemove={attachmentsHook.removeAttachment}
                    />
                  </div>
                ) : null
              }
            />
            {/* Hidden file input — attach button below triggers it. */}
            <input
              ref={attachmentsHook.fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={attachmentsHook.handleFileSelect}
              disabled={isSaving}
            />
            <div className="border-t px-2 py-1.5">
              <EditorActionBar
                editorHandle={editorRef.current}
                disabled={isSaving}
                formatOpen={formatOpen}
                onFormatOpenChange={setFormatOpen}
                mobileExpanded={mobileExpanded}
                onMobileExpandedChange={setMobileExpanded}
                showAttach
                onAttachClick={() => attachmentsHook.fileInputRef.current?.click()}
                showDesktopExpand={!isMobile}
                onDesktopExpandClick={() => setDocEditorOpen(true)}
                trailingContent={trailingActions}
              />
              {/* Mobile inline format toolbar — desktop uses the static toolbar
                  baked into RichEditor when staticToolbarOpen is true. */}
              {isMobile && formatOpen && (
                <EditorToolbar
                  editor={toolbarEditor}
                  isVisible
                  inline
                  inlinePosition="below"
                  linkPopoverOpen={linkPopoverOpen}
                  onLinkPopoverOpenChange={setLinkPopoverOpen}
                  showSpecialInputControls
                />
              )}
            </div>
          </div>
        </div>
      </div>
    )
  })()

  // Fullscreen "expand" pop-out — desktop only. Lets the user write in a
  // distraction-free editor for long messages, syncing content back to the
  // dialog on dismiss. Same pattern the live composer uses.
  const fullscreenModal = !isMobile && (
    <DocumentEditorModal
      open={docEditorOpen}
      onOpenChange={setDocEditorOpen}
      initialContent={serializeToMarkdown(contentJson)}
      streamName="scheduled message"
      onSend={async (markdown) => {
        const json = parseMarkdown(markdown)
        setContentJson(json)
        setDocEditorOpen(false)
        // Defer save until the dialog reads the new state; the user clicked
        // "send" inside the fullscreen, so finalize the dialog save too.
        setTimeout(() => handleSave(), 0)
      }}
      onDismiss={(markdown) => {
        setContentJson(parseMarkdown(markdown))
      }}
    />
  )

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) handleClose()
        }}
      >
        <DrawerContent className={mobileExpanded ? "!h-[100dvh] rounded-t-none" : "max-h-[92dvh]"}>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="flex flex-col gap-3 px-4 pb-[max(8px,env(safe-area-inset-bottom))] pt-1">
            <div>
              <p className="text-sm font-medium">{title}</p>
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            {editorBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {editorBody}
        </DialogContent>
      </Dialog>
      {fullscreenModal}
    </>
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
