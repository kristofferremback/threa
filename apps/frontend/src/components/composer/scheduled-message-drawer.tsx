import { useEffect, useMemo, useRef, useState } from "react"
import { Clock, ChevronLeft } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { formatRelativeTime } from "@/lib/dates"
import { stripMarkdownToInline } from "@/lib/markdown"
import { usePreferences } from "@/contexts"
import { toDateInput, toTimeInput, parseDateTimeInput } from "@/lib/schedule-presets"
import { SchedulePresetList, ScheduledActionsList } from "./schedule-ui"
import type { ScheduledPickerItem } from "./scheduled-picker"

type Mode = "actions" | "edit" | "change-time"

const PAUSE_OFFSET_MS = 24 * 60 * 60 * 1000

function getPreview(contentMarkdown: unknown): string {
  const md = typeof contentMarkdown === "string" ? contentMarkdown : ""
  const stripped = stripMarkdownToInline(md).trim()
  return stripped.length > 0 ? stripped : "Empty message"
}

interface ScheduledMessageDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ScheduledPickerItem | null
  onSendNow: (id: string) => void
  onEditSave: (id: string, contentMarkdown: string, originalScheduledAt: string) => void
  onChangeTime: (id: string, scheduledAt: Date) => void
  onDelete: (id: string) => void
}

export function ScheduledMessageDrawer({
  open,
  onOpenChange,
  item,
  onSendNow,
  onEditSave,
  onChangeTime,
  onDelete,
}: ScheduledMessageDrawerProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<Mode>("actions")
  const [editText, setEditText] = useState("")
  const [changeMode, setChangeMode] = useState<"presets" | "custom">("presets")
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const originalScheduledAtRef = useRef<string | null>(null)
  const hasPausedRef = useRef(false)
  const pausedItemIdRef = useRef<string | null>(null)
  const onChangeTimeRef = useRef(onChangeTime)
  onChangeTimeRef.current = onChangeTime
  const now = useMemo(() => new Date(), [open, mode])
  const minDate = useMemo(() => toDateInput(new Date()), [open, mode])

  useEffect(() => {
    if (!open) {
      if (hasPausedRef.current && pausedItemIdRef.current && originalScheduledAtRef.current) {
        onChangeTimeRef.current(pausedItemIdRef.current, new Date(originalScheduledAtRef.current))
      }
      hasPausedRef.current = false
      originalScheduledAtRef.current = null
      pausedItemIdRef.current = null
    }
    setMode("actions")
    setEditText("")
    setChangeMode("presets")
    setCustomDate("")
    setCustomTime("")
  }, [open, item?.id])

  if (!item) return null

  const preview = getPreview(item.contentMarkdown)
  const attachmentCount = item.attachmentIds?.length ?? 0

  const handleSendNow = () => {
    onOpenChange(false)
    onSendNow(item.id)
  }

  const handleDelete = () => {
    onOpenChange(false)
    onDelete(item.id)
  }

  const handleEnterEdit = () => {
    const currentMd = typeof item.contentMarkdown === "string" ? item.contentMarkdown : ""
    setEditText(currentMd)
    originalScheduledAtRef.current = item.scheduledAt
    pausedItemIdRef.current = item.id
    const originalMs = new Date(item.scheduledAt).getTime()
    const pauseMs = Date.now() + PAUSE_OFFSET_MS
    const pausedTime = new Date(Math.max(originalMs, pauseMs))
    if (pausedTime.getTime() > originalMs) {
      onChangeTime(item.id, pausedTime)
      hasPausedRef.current = true
    }
    setMode("edit")
  }

  const handleEditSave = () => {
    onEditSave(item.id, editText, originalScheduledAtRef.current ?? item.scheduledAt)
    hasPausedRef.current = false
    onOpenChange(false)
  }

  const handleEditCancel = () => {
    if (originalScheduledAtRef.current && pausedItemIdRef.current && hasPausedRef.current) {
      onChangeTime(pausedItemIdRef.current, new Date(originalScheduledAtRef.current))
      hasPausedRef.current = false
    }
    setEditText("")
    setMode("actions")
  }

  const handleChangeTimePreset = (date: Date) => {
    onChangeTime(item.id, date)
    onOpenChange(false)
  }

  const openChangeTimeCustom = () => {
    const baseline = new Date(Date.now() + 15 * 60_000)
    setCustomDate(toDateInput(baseline))
    setCustomTime(toTimeInput(baseline))
    setChangeMode("custom")
  }

  const handleChangeTimeCustom = () => {
    const parsed = parseDateTimeInput(customDate, customTime, timezone)
    if (!parsed) return
    handleChangeTimePreset(parsed)
  }

  const actionsVariant = isMobile ? "drawer" : "popover"

  const innerContent = (
    <div className={isMobile ? "flex flex-col px-5 pt-3 pb-6 pb-safe" : "flex flex-col gap-4"}>
      {mode === "actions" && (
        <>
          {isMobile ? (
            <DrawerTitle className="text-lg font-semibold mb-1">Scheduled message</DrawerTitle>
          ) : (
            <DialogTitle className="text-lg font-semibold">Scheduled message</DialogTitle>
          )}

          <div className="rounded-lg border bg-muted/30 px-4 py-3 mb-4">
            <p className="text-sm line-clamp-3 break-words">{preview}</p>
            {attachmentCount > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
              </p>
            )}
            <div className="flex items-center gap-1 mt-2 text-xs">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {formatRelativeTime(new Date(item.scheduledAt), now, undefined, { terse: true })}
              </span>
            </div>
            {item.streamDisplayName && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{item.streamDisplayName}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <ScheduledActionsList
              variant={actionsVariant}
              onSendNow={handleSendNow}
              onEdit={handleEnterEdit}
              onChangeTime={() => {
                setChangeMode("presets")
                setMode("change-time")
              }}
              onDelete={handleDelete}
            />
          </div>
        </>
      )}

      {mode === "edit" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 -ml-2 rounded-full"
                onClick={handleEditCancel}
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              {isMobile ? (
                <DrawerTitle className="text-lg font-semibold">Edit message</DrawerTitle>
              ) : (
                <DialogTitle className="text-lg font-semibold">Edit message</DialogTitle>
              )}
            </div>
            <Button variant="default" size="sm" className="h-9 px-4" onClick={handleEditSave}>
              Save
            </Button>
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full min-h-[120px] rounded-lg border border-input bg-muted/30 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
            placeholder="Type your message…"
            autoFocus
          />
        </>
      )}

      {mode === "change-time" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {changeMode === "custom" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 -ml-2 rounded-full"
                  onClick={() => setChangeMode("presets")}
                  aria-label="Back to presets"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              )}
              {isMobile ? (
                <DrawerTitle className="text-lg font-semibold">
                  {changeMode === "custom" ? "Pick a time" : "Change time"}
                </DrawerTitle>
              ) : (
                <DialogTitle className="text-lg font-semibold">
                  {changeMode === "custom" ? "Pick a time" : "Change time"}
                </DialogTitle>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
              onClick={() => {
                setChangeMode("presets")
                setMode("actions")
              }}
            >
              Cancel
            </Button>
          </div>

          {changeMode === "presets" ? (
            <SchedulePresetList
              variant={actionsVariant}
              onSelect={handleChangeTimePreset}
              onCustomClick={openChangeTimeCustom}
              now={now}
              timezone={timezone}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</span>
                  <input
                    type="date"
                    value={customDate}
                    min={minDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</span>
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </label>
              </div>
              <Button
                className="w-full h-12 text-base"
                onClick={handleChangeTimeCustom}
                disabled={!customDate || !customTime}
              >
                Change time
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">{innerContent}</DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{innerContent}</DialogContent>
    </Dialog>
  )
}
