import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { ArrowLeft, CalendarClock, CheckCircle2, Pause, Pencil, Play, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ScheduledMessageStatuses, type JSONContent, type ScheduledMessageView } from "@threa/types"
import {
  useDeleteScheduledMessage,
  useEditLockScheduledMessage,
  usePauseScheduledMessage,
  useResumeScheduledMessage,
  useScheduledMessagesList,
  useSendScheduledMessageNow,
  useUpdateScheduledMessage,
} from "@/hooks"
import { useAttachments } from "@/hooks/use-attachments"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { Button, buttonVariants } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SidebarToggle } from "@/components/layout"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MessageComposer } from "@/components/composer"
import { formatRelativeTime } from "@/lib/dates"
import { stripMarkdownToInline } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { extractUploadedAttachments, materializePendingAttachmentReferences } from "@/components/timeline/message-input"

type ScheduledTab = "scheduled" | "sent"

const TABS: { value: ScheduledTab; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
]

export function ScheduledPage() {
  const { workspaceId, tab: tabParam } = useParams<{ workspaceId: string; tab?: string }>()

  if (!workspaceId) return null
  if (tabParam === "scheduled") return <Navigate to={`/w/${workspaceId}/scheduled`} replace />
  if (tabParam !== undefined && tabParam !== "sent") return <Navigate to={`/w/${workspaceId}/scheduled`} replace />

  const tab: ScheduledTab = tabParam === "sent" ? "sent" : "scheduled"
  return <ScheduledPageInner workspaceId={workspaceId} tab={tab} />
}

function ScheduledPageInner({ workspaceId, tab }: { workspaceId: string; tab: ScheduledTab }) {
  const [inFlightId, setInFlightId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<ScheduledMessageView | null>(null)
  const { items, isLoading } = useScheduledMessagesList(workspaceId)
  const pauseMutation = usePauseScheduledMessage(workspaceId)
  const resumeMutation = useResumeScheduledMessage(workspaceId)
  const sendNowMutation = useSendScheduledMessageNow(workspaceId)
  const deleteMutation = useDeleteScheduledMessage(workspaceId)

  const visibleItems = useMemo(
    () =>
      items.filter((item) =>
        tab === "sent" ? item.status === ScheduledMessageStatuses.SENT : isUnsentScheduledMessage(item)
      ),
    [items, tab]
  )
  const groups = useMemo(() => groupByStream(visibleItems), [visibleItems])

  const runAction = useCallback(
    async (item: ScheduledMessageView, action: () => Promise<unknown>, success: string) => {
      if (inFlightId) return
      setInFlightId(item.id)
      try {
        await action()
        toast.success(success)
      } catch {
        toast.error("Could not update scheduled message")
      } finally {
        setInFlightId(null)
      }
    },
    [inFlightId]
  )

  let content: ReactNode
  if (isLoading && items.length === 0) {
    content = <div className="p-4 text-sm text-muted-foreground">Loading scheduled messages...</div>
  } else if (visibleItems.length === 0) {
    content = (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {tab === "sent" ? "No sent scheduled messages" : "No scheduled messages"}
      </div>
    )
  } else {
    content = (
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        {groups.map((group) => (
          <section key={group.key} className="border-b">
            <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-2 backdrop-blur">
              <h2 className="truncate text-xs font-medium text-muted-foreground">{group.label}</h2>
            </div>
            <div className="divide-y">
              {group.items.map((item) => (
                <ScheduledRow
                  key={item.id}
                  item={item}
                  workspaceId={workspaceId}
                  disabled={inFlightId === item.id}
                  onEdit={() => setEditingItem(item)}
                  onPause={() =>
                    runAction(
                      item,
                      () => pauseMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                      "Scheduled message paused"
                    )
                  }
                  onResume={() =>
                    runAction(
                      item,
                      () => resumeMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                      "Scheduled message resumed"
                    )
                  }
                  onSendNow={() =>
                    runAction(
                      item,
                      () => sendNowMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                      "Scheduled to send now"
                    )
                  }
                  onDelete={() =>
                    runAction(
                      item,
                      () => deleteMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                      "Scheduled message deleted"
                    )
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  const tabHref = (next: ScheduledTab) =>
    next === "scheduled" ? `/w/${workspaceId}/scheduled` : `/w/${workspaceId}/scheduled/sent`

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarToggle location="page" />
          <Link
            to={`/w/${workspaceId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}
            aria-label="Back to workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="truncate font-semibold">Scheduled</h1>
          </div>
        </div>

        <Tabs value={tab}>
          <TabsList className="h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} asChild>
                <Link to={tabHref(t.value)} className="px-2.5 py-1 text-xs">
                  {t.label}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-1">{content}</main>
      </ScrollArea>

      {editingItem && (
        <ScheduledEditDialog workspaceId={workspaceId} item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}

function ScheduledRow({
  item,
  workspaceId,
  disabled,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
}: {
  item: ScheduledMessageView
  workspaceId: string
  disabled: boolean
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onSendNow: () => void
  onDelete: () => void
}) {
  const mutable = isMutableScheduledMessage(item)
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const preventNavigationUntilRef = useRef(0)
  const openDrawer = useCallback(() => {
    if (!mutable) return
    preventNavigationUntilRef.current = Date.now() + 750
    setDrawerOpen(true)
  }, [mutable])
  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && mutable,
  })

  const handleAction = useCallback((action: () => void) => {
    setDrawerOpen(false)
    action()
  }, [])

  return (
    <>
      <article className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
        <Link
          to={
            item.status === ScheduledMessageStatuses.SENT && item.sentMessageId
              ? `/w/${workspaceId}/s/${item.streamId}?m=${item.sentMessageId}`
              : `/w/${workspaceId}/s/${item.streamId}`
          }
          onClick={(event) => {
            if (preventNavigationUntilRef.current > Date.now()) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
          onTouchStart={isMobile && mutable ? longPress.handlers.onTouchStart : undefined}
          onTouchEnd={isMobile && mutable ? longPress.handlers.onTouchEnd : undefined}
          onTouchMove={isMobile && mutable ? longPress.handlers.onTouchMove : undefined}
          onContextMenu={isMobile && mutable ? longPress.handlers.onContextMenu : undefined}
          className={cn(
            "min-w-0 flex-1 text-left",
            isMobile && mutable && "select-none",
            longPress.isPressed && "opacity-70 transition-opacity duration-100"
          )}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusIcon status={item.status} />
            <span className="capitalize">{item.status}</span>
            <span>·</span>
            <span>{timestampLabel(item)}</span>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-sm">{preview(item)}</p>
        </Link>

        {mutable && (
          <div className="hidden shrink-0 items-center gap-1 self-end sm:flex sm:self-start">
            <IconAction label="Edit scheduled message" icon={Pencil} disabled={disabled} onClick={onEdit} />
            {item.status === ScheduledMessageStatuses.PAUSED ? (
              <IconAction label="Resume" icon={Play} disabled={disabled} onClick={onResume} />
            ) : (
              <IconAction label="Pause" icon={Pause} disabled={disabled} onClick={onPause} />
            )}
            <IconAction label="Send now" icon={Send} disabled={disabled} onClick={onSendNow} />
            <IconAction label="Delete" icon={Trash2} destructive disabled={disabled} onClick={onDelete} />
          </div>
        )}
      </article>

      {isMobile && mutable && (
        <ScheduledActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          item={item}
          disabled={disabled}
          onEdit={() => handleAction(onEdit)}
          onPause={() => handleAction(onPause)}
          onResume={() => handleAction(onResume)}
          onSendNow={() => handleAction(onSendNow)}
          onDelete={() => handleAction(onDelete)}
        />
      )}
    </>
  )
}

function ScheduledActionDrawer({
  open,
  onOpenChange,
  item,
  disabled,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ScheduledMessageView
  disabled: boolean
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onSendNow: () => void
  onDelete: () => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerTitle className="sr-only">Scheduled message actions</DrawerTitle>

        <div className="px-4 pt-1 pb-3">
          <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
            <p className="mb-1 text-sm font-medium text-foreground">{item.streamName ?? "Conversation"}</p>
            <p className="mb-1 text-[13px] text-muted-foreground">{timestampLabel(item)}</p>
            <p className="line-clamp-3 text-sm leading-snug text-foreground/80">{preview(item)}</p>
          </div>
        </div>

        <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          <DrawerAction label="Edit" icon={Pencil} disabled={disabled} onClick={onEdit} />
          {item.status === ScheduledMessageStatuses.PAUSED ? (
            <DrawerAction label="Resume" icon={Play} disabled={disabled} onClick={onResume} />
          ) : (
            <DrawerAction label="Pause" icon={Pause} disabled={disabled} onClick={onPause} />
          )}
          <DrawerAction label="Send now" icon={Send} disabled={disabled} onClick={onSendNow} />
          <Separator className="mx-3 my-1 bg-border/50" />
          <DrawerAction destructive label="Delete" icon={Trash2} disabled={disabled} onClick={onDelete} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function DrawerAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        destructive ? "text-destructive active:bg-destructive/10" : "active:bg-muted/80"
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0", destructive ? "text-destructive" : "text-muted-foreground")} />
      <span>{label}</span>
    </button>
  )
}

function ScheduledEditDialog({
  workspaceId,
  item,
  onClose,
}: {
  workspaceId: string
  item: ScheduledMessageView
  onClose: () => void
}) {
  const updateMutation = useUpdateScheduledMessage(workspaceId)
  const editLockMutation = useEditLockScheduledMessage(workspaceId)
  const {
    pendingAttachments,
    getPendingAttachmentsSnapshot,
    fileInputRef,
    handleFileSelect,
    uploadFile,
    removeAttachment,
    isUploading,
    hasFailed,
    restore: restoreAttachments,
    imageCount,
  } = useAttachments(workspaceId)
  const [content, setContent] = useState<JSONContent>(item.contentJson)
  const [date, setDate] = useState(() => toDateInput(new Date(item.scheduledAt)))
  const [time, setTime] = useState(() => toTimeInput(new Date(item.scheduledAt)))
  const [lockReady, setLockReady] = useState(item.status === ScheduledMessageStatuses.EDITING)
  const [foregroundLocking, setForegroundLocking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const lockPromiseRef = useRef<Promise<ScheduledMessageView> | null>(null)
  const hasLockRef = useRef(item.status === ScheduledMessageStatuses.EDITING)
  const versionRef = useRef(item.version)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const updateMutationRef = useRef(updateMutation.mutateAsync)
  updateMutationRef.current = updateMutation.mutateAsync
  const editLockMutationRef = useRef(editLockMutation.mutateAsync)
  editLockMutationRef.current = editLockMutation.mutateAsync

  useEffect(() => {
    setContent(item.contentJson)
    setDate(toDateInput(new Date(item.scheduledAt)))
    setTime(toTimeInput(new Date(item.scheduledAt)))
    versionRef.current = item.version
    restoreAttachments(extractUploadedAttachments(item.contentJson))
  }, [item.contentJson, item.id, item.scheduledAt, item.version, restoreAttachments])

  useEffect(() => {
    if (item.status === ScheduledMessageStatuses.EDITING) {
      hasLockRef.current = true
      setLockReady(true)
      return
    }
    let cancelled = false
    const lock = () =>
      editLockMutationRef.current({
        scheduledId: item.id,
        expectedVersion: item.version,
      })

    const msUntilSend = Date.parse(item.scheduledAt) - Date.now()
    const lockPromise = msUntilSend <= 30_000 ? lock() : retryScheduledEditLock(lock, 3)
    lockPromiseRef.current = lockPromise

    if (msUntilSend <= 30_000) setForegroundLocking(true)

    void lockPromise
      .then((locked) => {
        if (cancelled) {
          void releaseScheduledEdit(updateMutationRef.current, locked.id, locked.version)
          return
        }
        hasLockRef.current = true
        versionRef.current = locked.version
        setLockReady(true)
      })
      .catch(() => {
        if (cancelled) return
        if (msUntilSend <= 30_000) {
          toast.error("Could not open scheduled message for editing")
          onCloseRef.current()
          return
        }
        toast.error("Scheduled message may send before edits are saved")
      })
      .finally(() => {
        if (!cancelled) setForegroundLocking(false)
      })

    return () => {
      cancelled = true
    }
  }, [item.id, item.scheduledAt, item.status, item.version])

  const handleClose = () => {
    if (hasLockRef.current) {
      void releaseScheduledEdit(updateMutationRef.current, item.id, versionRef.current)
    }
    onClose()
  }

  const handleSubmit = async (editorContent?: JSONContent) => {
    const scheduledAt = buildLocalDateTime(date, time)
    if (!date || !time || isNaN(scheduledAt.getTime())) {
      toast.error("Choose a valid scheduled time")
      return
    }

    let expectedVersion = versionRef.current
    const msUntilSend = Date.parse(item.scheduledAt) - Date.now()
    if (msUntilSend <= 30_000 && !lockReady && lockPromiseRef.current) {
      try {
        const locked = await lockPromiseRef.current
        versionRef.current = locked.version
        hasLockRef.current = true
        expectedVersion = locked.version
      } catch {
        toast.error("Could not open scheduled message for editing")
        onClose()
        return
      }
    }

    setIsSaving(true)
    const liveContent = editorContent ?? content
    const normalizedContent = materializePendingAttachmentReferences(liveContent, getPendingAttachmentsSnapshot())
    const uploaded = extractUploadedAttachments(normalizedContent)
    try {
      await updateMutationRef.current({
        scheduledId: item.id,
        input: {
          contentJson: normalizedContent,
          attachmentIds: uploaded.length > 0 ? uploaded.map((attachment) => attachment.id) : undefined,
          scheduledAt: scheduledAt.toISOString(),
          expectedVersion,
        },
      })
      toast.success("Scheduled message updated")
      onClose()
    } catch {
      try {
        if (!lockReady && lockPromiseRef.current) {
          const locked = await lockPromiseRef.current
          expectedVersion = locked.version
          await updateMutationRef.current({
            scheduledId: item.id,
            input: {
              contentJson: normalizedContent,
              attachmentIds: uploaded.length > 0 ? uploaded.map((attachment) => attachment.id) : undefined,
              scheduledAt: scheduledAt.toISOString(),
              expectedVersion,
            },
          })
          toast.success("Scheduled message updated")
          onClose()
          return
        }
      } catch {
        // Fall through to the generic failure toast below.
      }
      toast.error("Could not update scheduled message")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && handleClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl" drawerClassName="max-h-[92dvh]">
        <ResponsiveDialogHeader className="border-b px-4 py-3 sm:px-0 sm:pb-3 sm:pt-0">
          <ResponsiveDialogTitle className="text-base">Edit scheduled message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs">
            {item.streamName ?? "Conversation"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex flex-col gap-3 px-4 py-3 sm:px-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                min={toDateInput(new Date())}
                onChange={(event) => setDate(event.target.value)}
                className="h-9 rounded border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Time</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="h-9 rounded border bg-background px-2 text-sm"
              />
            </label>
          </div>

          {foregroundLocking ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              Opening scheduled message...
            </div>
          ) : (
            <MessageComposer
              content={content}
              onContentChange={setContent}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={removeAttachment}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              onFileUpload={uploadFile}
              imageCount={imageCount}
              onSubmit={handleSubmit}
              canSubmit={!isUploading && !isSaving}
              isSubmitting={isSaving}
              hasFailed={hasFailed}
              submitLabel="Save scheduled message"
              submittingLabel="Saving..."
              submitIcon="save"
              scopeId={item.id}
              autoFocus
            />
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function isUnsentScheduledMessage(item: ScheduledMessageView): boolean {
  return item.status !== ScheduledMessageStatuses.SENT && item.status !== ScheduledMessageStatuses.DELETED
}

function isMutableScheduledMessage(item: ScheduledMessageView): boolean {
  return (
    item.status === ScheduledMessageStatuses.SCHEDULED ||
    item.status === ScheduledMessageStatuses.PAUSED ||
    item.status === ScheduledMessageStatuses.EDITING ||
    item.status === ScheduledMessageStatuses.FAILED
  )
}

function groupByStream(
  items: ScheduledMessageView[]
): Array<{ key: string; label: string; items: ScheduledMessageView[] }> {
  const groups = new Map<string, { key: string; label: string; items: ScheduledMessageView[] }>()
  for (const item of items) {
    const key = item.streamId
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      continue
    }
    groups.set(key, {
      key,
      label: item.streamName ?? "Conversation",
      items: [item],
    })
  }
  return [...groups.values()]
}

async function retryScheduledEditLock(lock: () => Promise<ScheduledMessageView>, attempts: number) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await lock()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError
}

async function releaseScheduledEdit(
  mutateAsync: ReturnType<typeof useUpdateScheduledMessage>["mutateAsync"],
  scheduledId: string,
  expectedVersion: number
) {
  await mutateAsync({
    scheduledId,
    input: { expectedVersion },
  }).catch(() => {})
}

function formatScheduledAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function preview(item: ScheduledMessageView): string {
  const text = stripMarkdownToInline(item.contentMarkdown).trim()
  if (text) return text
  if (item.attachmentIds.length > 0) {
    return `${item.attachmentIds.length} attachment${item.attachmentIds.length === 1 ? "" : "s"}`
  }
  return "Empty message"
}

function timestampLabel(item: ScheduledMessageView): string {
  if (item.status === ScheduledMessageStatuses.SENT && item.sentAt) {
    return `Sent ${formatRelativeTime(new Date(item.sentAt), new Date(), undefined, { terse: true })}`
  }
  return `Sends ${formatScheduledAt(item.scheduledAt)}`
}

function StatusIcon({ status }: { status: ScheduledMessageView["status"] }) {
  if (status === ScheduledMessageStatuses.SENT) return <CheckCircle2 className="h-3.5 w-3.5" />
  if (status === ScheduledMessageStatuses.PAUSED || status === ScheduledMessageStatuses.EDITING) {
    return <Pause className="h-3.5 w-3.5" />
  }
  return <CalendarClock className="h-3.5 w-3.5" />
}

function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn("h-8 w-8", destructive && "text-destructive hover:text-destructive hover:bg-destructive/10")}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildLocalDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  if (!year || !month || !day || hour === undefined || minute === undefined) return new Date(Number.NaN)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}
