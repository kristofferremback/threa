import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { Editor } from "@tiptap/react"
import { type JSONContent, type ScheduledMessageView } from "@threa/types"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { RichEditor, EditorActionBar, EditorToolbar } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import { DateTimeField } from "@/components/forms/date-time-field"
import { parseLocalDateTime, toDateInputValue, toTimeInputValue } from "@/lib/dates"
import { useIsMobile } from "@/hooks/use-mobile"
import { useClaimScheduled, useUpdateScheduled, useHeartbeatScheduled, isLocalScheduledId } from "@/hooks"
import { useMentionStreamContext } from "@/hooks/use-mentionables"
import { useAttachments } from "@/hooks/use-attachments"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { materializePendingAttachmentReferences } from "@/components/timeline/message-input"
import { toast } from "sonner"
import { collectAttachmentReferenceIds, serializeToMarkdown } from "@threa/prosemirror"
import { EMPTY_DOC, ensureTrailingParagraph } from "@/lib/prosemirror-utils"
import { cn } from "@/lib/utils"

interface ScheduledEditDialogProps {
  workspaceId: string
  scheduled: ScheduledMessageView | null
  onClose: () => void
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Edit modal for scheduled messages.
 *
 * Concurrency model — first-save-wins via optimistic CAS on `updatedAt`.
 * There is no exclusive editor lock: opening the editor on device A doesn't
 * block device B; both can edit. The first save wins, and the second device's
 * Save surfaces a `STALE_VERSION` toast that prompts a refresh. While any
 * editor session is open, the worker fence (`editActiveUntil`) keeps the
 * row from firing — claim/heartbeat bumps it; stop heartbeating and the
 * fence expires, freeing the worker to fire when due.
 *
 * Mobile layout follows `MessageEditForm` verbatim — Drawer with content-
 * driven `max-h-[85dvh]` and an optional fullscreen toggle. The editor body
 * fills the drawer via `flex-1 min-h-0` so long messages get the full
 * viewport. Desktop renders a centered Dialog.
 *
 * Past-time saves transition `pending → sending → sent` atomically inside
 * the same PATCH on the backend (Save = Send semantics).
 */
export function ScheduledEditDialog({ workspaceId, scheduled, onClose }: ScheduledEditDialogProps) {
  const isMobile = useIsMobile()
  const claimMutation = useClaimScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const heartbeatMutation = useHeartbeatScheduled(workspaceId)

  const [contentJson, setContentJson] = useState<JSONContent>(EMPTY_DOC)
  // Send-at split into date + time so users can change just the time without
  // resetting the date — same shape ReminderPickerSheet uses for the saved-
  // message reminder picker.
  const [sendDate, setSendDate] = useState<string>("")
  const [sendTime, setSendTime] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null)
  /**
   * The `updatedAt` ISO the client claimed against. Sent on save as
   * `expectedUpdatedAt` for the optimistic-CAS — first save wins, second
   * save's PATCH 409s with STALE_VERSION.
   */
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const acquiringRef = useRef(false)
  const editorRef = useRef<RichEditorHandle | null>(null)

  // Mention/broadcast filtering follows the destination stream's access — the
  // hook handles thread→root bootstrap, member sets, and the bot-invite gate.
  const idbStreams = useWorkspaceStreams(workspaceId)
  const destinationStream = useMemo(
    () => (scheduled?.streamId ? idbStreams.find((s) => s.id === scheduled.streamId) : undefined),
    [idbStreams, scheduled?.streamId]
  )
  const streamContext = useMentionStreamContext(workspaceId, destinationStream)
  const attachmentsHook = useAttachments(workspaceId)

  const open = scheduled !== null
  const isLocalRow = scheduled ? isLocalScheduledId(scheduled.id) : false

  // Reset local state when the row id changes — guards against the dialog
  // being reused for a different scheduled message without an explicit close.
  const previousIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = scheduled?.id ?? null
    if (previousIdRef.current !== id) {
      setContentJson(EMPTY_DOC)
      setSendDate("")
      setSendTime("")
      setError(null)
      setFormatOpen(false)
      setMobileExpanded(false)
      setExpectedUpdatedAt(null)
      setIsReady(false)
      attachmentsHook.clear()
      previousIdRef.current = id
    }
  }, [scheduled?.id, attachmentsHook])

  // Local-only rows haven't been persisted yet, so claim would 404. Seed the
  // editor directly from the optimistic IDB row instead — the user can still
  // tweak the message; on save the operation queue replays the schedule with
  // the new content rather than the original.
  useEffect(() => {
    if (!open || !scheduled || isReady) return
    if (isLocalRow) {
      const at = new Date(scheduled.scheduledFor)
      setContentJson(ensureTrailingParagraph(scheduled.contentJson || EMPTY_DOC))
      setSendDate(toDateInputValue(at))
      setSendTime(toTimeInputValue(at))
      setExpectedUpdatedAt(scheduled.updatedAt)
      setIsReady(true)
      return
    }
    if (acquiringRef.current) return
    acquiringRef.current = true
    claimMutation
      .mutateAsync(scheduled.id)
      .then((res) => {
        const at = new Date(res.scheduled.scheduledFor)
        // Append a trailing paragraph if the doc ends in a block-level atom
        // (quote-reply, shared-message). Without this, mobile users can't tap
        // a position after the atom — the gap-cursor has no tap target.
        setContentJson(ensureTrailingParagraph(res.scheduled.contentJson || EMPTY_DOC))
        setSendDate(toDateInputValue(at))
        setSendTime(toTimeInputValue(at))
        setExpectedUpdatedAt(res.scheduled.updatedAt)
        setError(null)
        setIsReady(true)
      })
      .catch((err: Error) => {
        setError(err.message || "Could not start editing")
      })
      .finally(() => {
        acquiringRef.current = false
      })
  }, [open, scheduled, isReady, isLocalRow, claimMutation])

  // Heartbeat the worker fence while the dialog is open. Anonymous — no lock
  // token; any session bumping the fence keeps the worker out.
  useEffect(() => {
    if (!open || !scheduled || isLocalRow) return
    const interval = setInterval(() => {
      heartbeatMutation.mutate(scheduled.id)
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [open, scheduled, isLocalRow, heartbeatMutation])

  const handleClose = useCallback(() => {
    setContentJson(EMPTY_DOC)
    setSendDate("")
    setSendTime("")
    setError(null)
    setFormatOpen(false)
    setMobileExpanded(false)
    setExpectedUpdatedAt(null)
    setIsReady(false)
    attachmentsHook.clear()
    onClose()
  }, [attachmentsHook, onClose])

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
    if (!scheduled || !sendAtDate || !expectedUpdatedAt) return
    if (isLocalRow) {
      // Local-only rows can't be saved through the update API yet — the
      // server doesn't know about them. Surface a benign hint and let the
      // schedule-message op queue catch up. (Future: cancel the queued op
      // and re-enqueue with the new content.)
      toast.info("Scheduling… try again in a moment")
      return
    }
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
          expectedUpdatedAt,
        },
      })
      toast.success(isPast ? "Sent" : "Updated")
      handleClose()
    } catch (err: unknown) {
      // STALE_VERSION (HTTP 409 with code SCHEDULED_MESSAGE_STALE_VERSION) is
      // surfaced as a toast that prompts a refresh — the row was edited
      // elsewhere and the user's local view is behind. Other errors keep the
      // dialog open so the user can retry.
      const isStaleVersion =
        err && typeof err === "object" && "code" in err && err.code === "SCHEDULED_MESSAGE_STALE_VERSION"
      if (isStaleVersion) {
        toast.error("This message was edited elsewhere — refreshing…")
        handleClose()
        return
      }
      const message = err instanceof Error ? err.message : "Could not save"
      setError(message)
    }
  }, [
    scheduled,
    contentJson,
    sendAtDate,
    expectedUpdatedAt,
    isLocalRow,
    isPast,
    updateMutation,
    handleClose,
    attachmentsHook,
  ])

  const isLoadingClaim = open && !isReady && !error
  const isSaving = updateMutation.isPending

  const description = (() => {
    if (isLocalRow) return "Saving to the server… you can edit once the schedule lands."
    if (isPast) return "Scheduled time has passed — this message will be sent as soon as you finish editing."
    return null
  })()

  const cancelLabel = isPast ? "Send unchanged" : "Cancel"
  const saveLabel = isPast ? "Send" : "Save"
  const title = isPast ? "Send scheduled message" : "Edit scheduled message"

  const editorBody = (() => {
    if (isLoadingClaim) {
      return (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening…
        </div>
      )
    }
    if (error) {
      return <div className="text-sm text-destructive">{error}</div>
    }
    return (
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
        autoFocus={!isMobile}
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
    )
  })()

  // Hidden file input — attach button below triggers it. Lives outside the
  // editor body so its focus state doesn't interact with the editor's
  // handle-passing.
  const fileInput = (
    <input
      ref={attachmentsHook.fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={attachmentsHook.handleFileSelect}
      disabled={isSaving}
    />
  )

  // Mobile: clone of MessageEditForm's drawer shape — content-driven
  // `max-h-[85dvh]` (or `!h-[100dvh]` when expanded), editor fills via
  // `flex-1 min-h-0`, action bar pinned at bottom inside the drawer.
  if (isMobile) {
    const mobileTrailingActions = (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs shrink-0"
          onPointerDown={(e) => e.preventDefault()}
          onClick={handleClose}
          disabled={isSaving}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs shrink-0"
          onPointerDown={(e) => e.preventDefault()}
          onClick={handleSave}
          disabled={!isReady || isSaving || isLocalRow}
        >
          {isSaving ? "Saving…" : saveLabel}
        </Button>
      </>
    )

    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) handleClose()
        }}
      >
        <DrawerContent
          className={
            mobileExpanded
              ? "!h-[100dvh] rounded-t-none"
              : // min-h keeps the drawer comfortably tall even with a short
                // message — short notes shouldn't render in a cramped 30%
                // sliver. max-h leaves room for the OS status bar / drag.
                "min-h-[75dvh] max-h-[85dvh]"
          }
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>

          {/* Body: pt-5 visually balances pb-[max(20px,safe)] on the action
              bar below — the vaul drag handle takes ~24px on its own but
              reads as decorative, not as padding, so the title still needs
              breathing room from it. */}
          <div className="flex flex-col flex-1 min-h-0 px-4 pt-5 gap-4">
            <div>
              <p className="text-base font-semibold">{title}</p>
              {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
            </div>

            <DateTimeField
              date={sendDate}
              time={sendTime}
              onDateChange={setSendDate}
              onTimeChange={setSendTime}
              disabled={isSaving || !isReady}
              density="compact"
            />

            {/* Editor fills the remaining drawer height — same shape as
                MessageEditForm so long messages don't scroll inside a tiny
                window inside a full-screen drawer. */}
            <div
              data-inline-edit
              className="flex-1 min-h-0 overflow-y-auto rounded-md border bg-background [&_.tiptap]:!pt-0 [&_.tiptap_p]:!leading-relaxed [&_.tiptap]:max-h-none [&_.tiptap]:min-h-full [&_.tiptap]:px-3 [&_.tiptap]:py-2"
            >
              {editorBody}
            </div>
          </div>

          {fileInput}

          {/* Action bar: pt-3 separates it visually from the editor card; the
              bottom uses max(20px, safe-area) so phones without an inset still
              get thumb-comfortable padding rather than an 8px hairline. */}
          <div
            className="px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
          >
            <EditorActionBar
              editorHandle={editorRef.current}
              disabled={isSaving}
              formatOpen={formatOpen}
              onFormatOpenChange={setFormatOpen}
              mobileExpanded={mobileExpanded}
              onMobileExpandedChange={setMobileExpanded}
              showAttach
              onAttachClick={() => attachmentsHook.fileInputRef.current?.click()}
              showExpand={false}
              trailingContent={mobileTrailingActions}
            />
            {formatOpen && (
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
        </DrawerContent>
      </Drawer>
    )
  }

  // Desktop: centered Dialog with the same primitives.
  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <DateTimeField
            date={sendDate}
            time={sendTime}
            onDateChange={setSendDate}
            onTimeChange={setSendTime}
            disabled={isSaving || !isReady}
            density="compact"
          />

          <div
            className={cn(
              "rounded-md border bg-background",
              // Wider min-h so a short scheduled note doesn't shrink the
              // dialog down to a strip; max-h leaves room for the action bar
              // + buttons before the dialog hits its sm:max-w-lg footprint.
              "[&_.tiptap]:overflow-y-auto [&_.tiptap]:px-3 [&_.tiptap]:py-2",
              "[&_.tiptap]:min-h-[14rem] [&_.tiptap]:max-h-[24rem]"
            )}
          >
            {editorBody}
            {fileInput}
            <div className="border-t px-3 py-2">
              <EditorActionBar
                editorHandle={editorRef.current}
                disabled={isSaving}
                formatOpen={formatOpen}
                onFormatOpenChange={setFormatOpen}
                showAttach
                onAttachClick={() => attachmentsHook.fileInputRef.current?.click()}
                showExpand={false}
                trailingContent={
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={handleClose} disabled={isSaving}>
                      {cancelLabel}
                    </Button>
                    <Button type="button" size="sm" onClick={handleSave} disabled={!isReady || isSaving || isLocalRow}>
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {saveLabel}
                    </Button>
                  </>
                }
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
