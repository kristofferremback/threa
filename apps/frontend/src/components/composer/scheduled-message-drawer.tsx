import { useEffect, useMemo, useRef, useState } from "react"
import { Clock, Edit2, CircleSlash, ArrowUp, ChevronLeft, Calendar as CalendarIcon } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/dates"
import { stripMarkdownToInline } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { SCHEDULE_PRESETS, computeScheduledAt } from "@/lib/schedule-presets"
import type { ScheduledPickerItem } from "./scheduled-picker"

type DrawerMode = "actions" | "edit" | "change-time"

const PAUSE_OFFSET_MS = 24 * 60 * 60 * 1000 // Push 24h out while editing to prevent accidental fire

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
  const [mode, setMode] = useState<DrawerMode>("actions")
  const [editText, setEditText] = useState("")
  const [changeMode, setChangeMode] = useState<"presets" | "custom">("presets")
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const originalScheduledAtRef = useRef<string | null>(null)
  const hasPausedRef = useRef(false)
  const now = useMemo(() => new Date(), [open, mode])
  const minDate = useMemo(() => toDateInput(new Date()), [open, mode])

  // Reset state when drawer opens/closes, or when the item changes while open
  useEffect(() => {
    if (!open) {
      // If we paused, restore the original time before closing
      if (hasPausedRef.current && item && originalScheduledAtRef.current) {
        onChangeTime(item.id, new Date(originalScheduledAtRef.current))
      }
      hasPausedRef.current = false
      originalScheduledAtRef.current = null
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

  // ── Edit mode ──────────────────────────────────────────────────────────

  const handleEnterEdit = () => {
    const currentMd = typeof item.contentMarkdown === "string" ? item.contentMarkdown : ""
    setEditText(currentMd)
    originalScheduledAtRef.current = item.scheduledAt
    // Pause: push scheduled time 24h out so it won't fire during editing
    onChangeTime(item.id, new Date(Date.now() + PAUSE_OFFSET_MS))
    hasPausedRef.current = true
    setMode("edit")
  }

  const handleEditSave = () => {
    onEditSave(item.id, editText, originalScheduledAtRef.current ?? item.scheduledAt)
    hasPausedRef.current = false
    onOpenChange(false)
  }

  const handleEditCancel = () => {
    // Restore original scheduled time before going back
    if (originalScheduledAtRef.current && hasPausedRef.current) {
      onChangeTime(item.id, new Date(originalScheduledAtRef.current))
      hasPausedRef.current = false
    }
    setEditText("")
    setMode("actions")
  }

  // ── Change time mode ───────────────────────────────────────────────────

  const handleEnterChangeTime = () => {
    setChangeMode("presets")
    setCustomDate("")
    setCustomTime("")
    setMode("change-time")
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
    if (!customDate || !customTime) return
    const parsed = new Date(`${customDate}T${customTime}`)
    if (isNaN(parsed.getTime())) return
    handleChangeTimePreset(parsed)
  }

  const handleBackFromChangeTime = () => {
    setChangeMode("presets")
    setCustomDate("")
    setCustomTime("")
    setMode("actions")
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <div className="flex flex-col px-5 pt-3 pb-6 pb-safe">
          {mode === "actions" && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-1">
                <DrawerTitle className="text-lg font-semibold">Scheduled message</DrawerTitle>
              </div>

              {/* Preview card */}
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

              {/* Actions */}
              <div className="flex flex-col gap-1">
                <DrawerMenuButton onClick={handleSendNow}>
                  <ArrowUp className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-left">Send now</span>
                </DrawerMenuButton>
                <DrawerMenuButton onClick={handleEnterEdit}>
                  <Edit2 className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-left">Edit message</span>
                </DrawerMenuButton>
                <DrawerMenuButton onClick={handleEnterChangeTime}>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-left">Change time</span>
                </DrawerMenuButton>
                <DrawerMenuButton onClick={handleDelete} className="text-destructive">
                  <CircleSlash className="h-4 w-4" />
                  <span className="flex-1 text-left">Delete</span>
                </DrawerMenuButton>
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
                  <DrawerTitle className="text-lg font-semibold">Edit message</DrawerTitle>
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
                  <DrawerTitle className="text-lg font-semibold">
                    {changeMode === "custom" ? "Pick a time" : "Change time"}
                  </DrawerTitle>
                </div>
                <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={handleBackFromChangeTime}>
                  Cancel
                </Button>
              </div>

              {changeMode === "presets" ? (
                <div className="flex flex-col gap-1">
                  {SCHEDULE_PRESETS.map((preset) => (
                    <DrawerMenuButton
                      key={preset.label}
                      onClick={() => handleChangeTimePreset(computeScheduledAt(preset, new Date(), timezone))}
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {preset.label}
                    </DrawerMenuButton>
                  ))}
                  <DrawerMenuButton onClick={openChangeTimeCustom}>
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                    Pick a time…
                  </DrawerMenuButton>
                </div>
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
      </DrawerContent>
    </Drawer>
  )
}

function DrawerMenuButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn("w-full justify-start gap-3 h-11 text-sm font-normal px-3", className)}
    >
      {children}
    </Button>
  )
}

function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
