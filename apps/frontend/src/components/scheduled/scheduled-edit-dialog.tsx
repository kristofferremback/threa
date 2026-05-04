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
import { useUpdateScheduled, useLockScheduledForEdit, isLocalScheduledId } from "@/hooks"
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

/**
 * Edit modal for scheduled messages.
 *
 * Concurrency: optimistic CAS on `updatedAt` + worker pause-while-editing.
 * The dialog opens immediately seeded from the row the caller already has
 * (IDB or socket-fresh). On mount it fires `lockForEdit` once (no await,
 * no heartbeat) which bumps `edit_active_until` for ~10 minutes — the
 * worker checks this fence and defers firing while it's in the future, so
 * we don't ship mid-edit content. On save the PATCH carries
 * `expectedUpdatedAt = scheduled.updatedAt`; server CAS rejects with 409
 * STALE_VERSION if the row moved on. First save wins, second save toasts
 * and refreshes.
 *
 * Past-time saves transition `pending → sending → sent` atomically inside
 * the same PATCH on the backend (Save = Send semantics).
 */
export function ScheduledEditDialog({ workspaceId, scheduled, onClose }: ScheduledEditDialogProps) {
  const isMobile = useIsMobile()
  const updateMutation = useUpdateScheduled(workspaceId)
  const lockMutation = useLockScheduledForEdit(workspaceId)

  const [contentJson, setContentJson] = useState<JSONContent>(EMPTY_DOC)
  const [sendDate, setSendDate] = useState<string>("")
  const [sendTime, setSendTime] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null)
  const editorRef = useRef<RichEditorHandle | null>(null)

  const idbStreams = useWorkspaceStreams(workspaceId)
  const destinationStream = useMemo(
    () => (scheduled?.streamId ? idbStreams.find((s) => s.id === scheduled.streamId) : undefined),
    [idbStreams, scheduled?.streamId]
  )
  const streamContext = useMentionStreamContext(workspaceId, destinationStream)
  const attachmentsHook = useAttachments(workspaceId)

  const open = scheduled !== null
  const isLocalRow = scheduled ? isLocalScheduledId(scheduled.id) : false

  // The `updatedAt` the editor opened against — sent on save as
  // `expectedUpdatedAt` for the optimistic-CAS. Captured once when the dialog
  // opens; if the row changes underneath us, the CAS rejects on save.
  const expectedUpdatedAt = scheduled?.updatedAt ?? null

  // Seed editor state when the row id changes. Re-seeding mid-edit is
  // intentionally not done — that would clobber the user's in-progress edits
  // every time a socket event arrived.
  const previousIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = scheduled?.id ?? null
    if (previousIdRef.current === id) return
    previousIdRef.current = id

    if (!scheduled) {
      setContentJson(EMPTY_DOC)
      setSendDate("")
      setSendTime("")
      setError(null)
      setFormatOpen(false)
      setMobileExpanded(false)
      attachmentsHook.clear()
      return
    }

    const at = new Date(scheduled.scheduledFor)
    // Append a trailing paragraph if the doc ends in a block-level atom
    // (quote-reply, shared-message). Without this, mobile users can't tap
    // a position after the atom — the gap-cursor has no tap target.
    setContentJson(ensureTrailingParagraph(scheduled.contentJson || EMPTY_DOC))
    setSendDate(toDateInputValue(at))
    setSendTime(toTimeInputValue(at))
    setError(null)
    setFormatOpen(false)
    setMobileExpanded(false)
    attachmentsHook.clear()

    // Fire-and-forget: pause the worker so it doesn't send mid-edit. Local
    // placeholders haven't been persisted yet, so the lock would 404 — skip.
    // No heartbeat; the TTL is generous and a save 409s cleanly if it lapses.
    if (!isLocalScheduledId(scheduled.id)) {
      lockMutation.mutate(scheduled.id)
    }
  }, [scheduled, attachmentsHook, lockMutation])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

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
      // Local-only rows haven't been confirmed by the server yet, so the
      // update API would 404. The schedule_message op will land shortly;
      // until then, surface a benign hint and bail.
      toast.info("Scheduling… try again in a moment")
      return
    }
    try {
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

  const isSaving = updateMutation.isPending

  const description = (() => {
    if (isLocalRow) return "Saving to the server… you can edit once the schedule lands."
    if (isPast) return "Scheduled time has passed — this message will be sent as soon as you finish editing."
    return null
  })()

  const cancelLabel = isPast ? "Send unchanged" : "Cancel"
  const saveLabel = isPast ? "Send" : "Save"
  const title = isPast ? "Send scheduled message" : "Edit scheduled message"

  const editorElement = (
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

  // Mobile: Drawer with the editor filling its body. Padding lives INSIDE
  // .tiptap so a tap anywhere on the visible editor area focuses it — no
  // dead zone between the visual edge and the contenteditable.
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
          disabled={isSaving || isLocalRow}
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
        <DrawerContent className={mobileExpanded ? "!h-[100dvh] rounded-t-none" : "min-h-[75dvh] max-h-[85dvh]"}>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>

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
              disabled={isSaving}
              density="compact"
            />

            {/* Editor wrapper — the .tiptap inside fills the wrapper via
                min-h-full and carries the typing padding. No border, no bg,
                no inner padding on the wrapper itself, so visual edges and
                the tap target line up exactly. */}
            <div
              data-inline-edit
              className="flex-1 min-h-0 overflow-y-auto [&_.tiptap]:!pt-0 [&_.tiptap]:!pb-0 [&_.tiptap_p]:!leading-relaxed [&_.tiptap]:max-h-none [&_.tiptap]:min-h-full [&_.tiptap]:px-3 [&_.tiptap]:py-3"
            >
              {error ? <div className="px-3 py-3 text-sm text-destructive">{error}</div> : editorElement}
            </div>
          </div>

          {fileInput}

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

  // Desktop: centered Dialog. Editor area uses internal .tiptap padding so
  // a click anywhere within the visible editor focuses it.
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
            disabled={isSaving}
            density="compact"
          />

          <div
            data-inline-edit
            className="rounded-md border bg-background overflow-hidden [&_.tiptap]:!pt-0 [&_.tiptap]:!pb-0 [&_.tiptap]:overflow-y-auto [&_.tiptap]:px-3 [&_.tiptap]:py-3 [&_.tiptap]:min-h-[14rem] [&_.tiptap]:max-h-[24rem]"
          >
            {error ? <div className="px-3 py-3 text-sm text-destructive">{error}</div> : editorElement}
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
                    <Button type="button" size="sm" onClick={handleSave} disabled={isSaving || isLocalRow}>
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
