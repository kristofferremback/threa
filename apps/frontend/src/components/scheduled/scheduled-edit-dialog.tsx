import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { Editor } from "@tiptap/react"
import { type JSONContent, type ScheduledMessageView } from "@threa/types"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { RichEditor, EditorActionBar, EditorToolbar } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import { DateTimeField } from "@/components/forms/date-time-field"
import { parseLocalDateTime, toDateInputValue, toTimeInputValue } from "@/lib/dates"
import { useIsMobile } from "@/hooks/use-mobile"
import { useClaimScheduled, useReleaseScheduled, useUpdateScheduled, useHeartbeatScheduled } from "@/hooks"
import { useMentionStreamContext } from "@/hooks/use-mentionables"
import { useAttachments } from "@/hooks/use-attachments"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { materializePendingAttachmentReferences } from "@/components/timeline/message-input"
import { toast } from "sonner"
import { collectAttachmentReferenceIds, serializeToMarkdown } from "@threa/prosemirror"
import { EMPTY_DOC, ensureTrailingParagraph } from "@/lib/prosemirror-utils"

interface ScheduledEditDialogProps {
  workspaceId: string
  scheduled: ScheduledMessageView | null
  onClose: () => void
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Edit modal for the page surface (and the in-composer popover). Hosts the
 * same editor primitives the live composer uses — `RichEditor` for the body,
 * `EditorActionBar` for the chrome row (attach / format / mention / emoji).
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
 * Send-at uses split `<input type="date">` + `<input type="time">` (same
 * primitive the reminder picker sheet uses) instead of `datetime-local`, so
 * users can change just the time without resetting the date.
 *
 * Mobile renders as a `<Drawer>` bottom sheet (matches `MessageEditForm`);
 * desktop renders as a centered `<Dialog>`. No fullscreen-expand affordance
 * — the dialog/drawer is already the dominant surface.
 */
export function ScheduledEditDialog({ workspaceId, scheduled, onClose }: ScheduledEditDialogProps) {
  const isMobile = useIsMobile()
  const claimMutation = useClaimScheduled(workspaceId)
  const releaseMutation = useReleaseScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const heartbeatMutation = useHeartbeatScheduled(workspaceId)

  const [lockToken, setLockToken] = useState<string | null>(null)
  const [contentJson, setContentJson] = useState<JSONContent>(EMPTY_DOC)
  // Send-at split into date + time so users can change just the time without
  // resetting the date — same shape ReminderPickerSheet uses for the saved-
  // message reminder picker.
  const [sendDate, setSendDate] = useState<string>("")
  const [sendTime, setSendTime] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null)
  const acquiringRef = useRef(false)
  const editorRef = useRef<RichEditorHandle | null>(null)

  // Mention/broadcast filtering follows the destination stream's access — the
  // hook handles thread→root bootstrap, member sets, and the bot-invite gate.
  // Without this, @channel / @here would offer streams the user can't broadcast to.
  const idbStreams = useWorkspaceStreams(workspaceId)
  const destinationStream = useMemo(
    () => (scheduled?.streamId ? idbStreams.find((s) => s.id === scheduled.streamId) : undefined),
    [idbStreams, scheduled?.streamId]
  )
  const streamContext = useMentionStreamContext(workspaceId, destinationStream)
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
      setSendDate("")
      setSendTime("")
      setError(null)
      setFormatOpen(false)
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
        const at = new Date(res.scheduled.scheduledFor)
        setLockToken(res.lockToken)
        // Append a trailing paragraph if the doc ends in a block-level atom
        // (quote-reply, shared-message). Without this, mobile users can't tap
        // a position after the atom — the gap-cursor has no tap target.
        setContentJson(ensureTrailingParagraph(res.scheduled.contentJson || EMPTY_DOC))
        setSendDate(toDateInputValue(at))
        setSendTime(toTimeInputValue(at))
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
    setSendDate("")
    setSendTime("")
    setError(null)
    setFormatOpen(false)
    attachmentsHook.clear()
    onClose()
  }, [scheduled, lockToken, releaseMutation, attachmentsHook, onClose])

  const sendAtDate = useMemo(() => parseLocalDateTime(sendDate, sendTime), [sendDate, sendTime])

  const isPast = useMemo(() => {
    if (!sendAtDate) return false
    return sendAtDate.getTime() <= Date.now()
  }, [sendAtDate])

  const setRichEditorHandle = useCallback((handle: RichEditorHandle | null) => {
    editorRef.current = handle
    const next = handle?.getEditor() ?? null
    setToolbarEditor((cur) => (cur === next ? cur : next))
  }, [])

  const handleSave = useCallback(async () => {
    if (!scheduled || !lockToken || !sendAtDate) return
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
          scheduledFor: sendAtDate.toISOString(),
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
  }, [scheduled, lockToken, contentJson, sendAtDate, isPast, updateMutation, handleClose, attachmentsHook])

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

  // Desktop renders Save / Cancel inside the action bar's trailing slot to keep
  // the dialog compact. Mobile gets a dedicated row below the editor — the
  // action bar is already wide on a 360px phone, and stacking two text buttons
  // into the trailing slot caused them to truncate.
  const desktopTrailingActions = !isMobile ? (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isSaving}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={handleSave} disabled={!lockToken || isSaving}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {saveLabel}
      </Button>
    </>
  ) : undefined

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
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        <DateTimeField
          date={sendDate}
          time={sendTime}
          onDateChange={setSendDate}
          onTimeChange={setSendTime}
          disabled={isSaving}
          density="compact"
        />
        <div className="flex flex-1 min-h-0 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</span>
          {/* Editor card. Mobile lets the editor body fill the drawer (capped
              at 60dvh as a guard); desktop keeps the original 18rem cap so the
              centered Dialog stays compact. */}
          <div className="flex flex-1 min-h-0 flex-col rounded-md border bg-background [&_.tiptap]:overflow-y-auto [&_.tiptap]:px-3 [&_.tiptap]:py-2 [&_.tiptap]:min-h-[8rem] [&_.tiptap]:max-h-[60dvh] sm:[&_.tiptap]:max-h-72">
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
              // Auto-focus only on desktop; on mobile the keyboard would cover
              // the date/time field before the user could review it.
              autoFocus={!isMobile}
              // The selection-driven floating toolbar conflicts with the OS
              // native selection popup on mobile — same call MessageInput makes.
              disableSelectionToolbar={isMobile}
              blurOnEscape
              scopeId={scheduled?.id}
              streamContext={streamContext}
              staticToolbarOpen={!isMobile && formatOpen}
              belowToolbarContent={
                attachmentsHook.pendingAttachments.length > 0 ? (
                  <div className="px-3 pt-1 pb-2 border-b border-border/50 [&>div]:mb-0">
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
            <div className="border-t px-3 py-2">
              <EditorActionBar
                editorHandle={editorRef.current}
                disabled={isSaving}
                formatOpen={formatOpen}
                onFormatOpenChange={setFormatOpen}
                showAttach
                onAttachClick={() => attachmentsHook.fileInputRef.current?.click()}
                // Drawer/dialog is the dominant surface; the action bar's
                // expand toggle is redundant here.
                showExpand={false}
                trailingContent={desktopTrailingActions}
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
        {isMobile && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="flex-1 h-11"
              onClick={handleClose}
              disabled={isSaving}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 h-11"
              onClick={handleSave}
              disabled={!lockToken || isSaving}
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saveLabel}
            </Button>
          </div>
        )}
      </div>
    )
  })()

  return (
    // disableSnapPoints: skip vaul's 80%-snap default so the action row + safe
    // area stay above the fold (matches MessageEditForm's content-driven
    // drawer shape). Cap at 92dvh so a long message scrolls inside the editor
    // rather than pushing the action row off-screen.
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && handleClose()} disableSnapPoints>
      <ResponsiveDialogContent desktopClassName="sm:max-w-lg" drawerClassName="max-h-[92dvh]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          {description && <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        {/* Body wrapper. Mobile takes flex-1 so the editor can grow; desktop
            falls through to DialogContent's built-in padding. Bottom padding
            applies safe-area inset on iOS so the trailing action row sits above
            the home indicator. */}
        <div className="flex flex-1 min-h-0 flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:p-0 sm:pb-0">
          {editorBody}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
