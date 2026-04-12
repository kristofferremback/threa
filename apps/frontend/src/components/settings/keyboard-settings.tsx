import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { RotateCcw } from "lucide-react"
import { usePreferences } from "@/contexts"
import {
  SHORTCUT_ACTIONS,
  getShortcutsByCategory,
  getEffectiveKeyBinding,
  formatKeyBinding,
  detectConflicts,
  keyEventToBinding,
  type ShortcutAction,
} from "@/lib/keyboard-shortcuts"
import { MESSAGE_SEND_MODE_OPTIONS, type MessageSendMode } from "@threa/types"

const SEND_MODE_CONFIG: Record<MessageSendMode, { label: string; description: string }> = {
  enter: {
    label: "Enter to send",
    description: "Press Enter to send, Shift+Enter for new line",
  },
  cmdEnter: {
    label: "⌘/Ctrl + Enter to send",
    description: "Press ⌘+Enter (Mac) or Ctrl+Enter (Windows) to send",
  },
}

function getBadgeLabel(
  isCapturing: boolean,
  conflictInfo: { binding: string } | null,
  binding: string | undefined
): string {
  if (isCapturing) {
    return conflictInfo ? formatKeyBinding(conflictInfo.binding) : "Press keys..."
  }
  return binding ? formatKeyBinding(binding) : "—"
}

interface ShortcutRowProps {
  action: ShortcutAction
  customBindings: Record<string, string>
  capturingId: string | null
  onStartCapture: (id: string) => void
  onCancelCapture: () => void
  onSaveBinding: (actionId: string, binding: string) => void
  onResetBinding: (actionId: string) => void
}

function ShortcutRow({
  action,
  customBindings,
  capturingId,
  onStartCapture,
  onCancelCapture,
  onSaveBinding,
  onResetBinding,
}: ShortcutRowProps) {
  const isCapturing = capturingId === action.id
  const [pendingBinding, setPendingBinding] = useState<string | null>(null)
  const [conflictInfo, setConflictInfo] = useState<{ binding: string; conflictIds: string[] } | null>(null)
  const badgeRef = useRef<HTMLButtonElement>(null)
  const binding = getEffectiveKeyBinding(action.id, customBindings)
  const isCustom = action.id in customBindings && customBindings[action.id] !== action.defaultKey

  // Handle keydown during capture mode
  useEffect(() => {
    if (!isCapturing) {
      setPendingBinding(null)
      setConflictInfo(null)
      return
    }

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()

      // Escape cancels capture
      if (e.key === "Escape") {
        onCancelCapture()
        return
      }

      const captured = keyEventToBinding(e)
      if (!captured) return

      // Check for conflicts
      const testBindings = { ...customBindings, [action.id]: captured }
      const conflicts = detectConflicts(testBindings)
      const conflicting = conflicts.get(captured)?.filter((id) => id !== action.id) ?? []

      if (conflicting.length > 0) {
        setPendingBinding(captured)
        setConflictInfo({ binding: captured, conflictIds: conflicting })
      } else {
        onSaveBinding(action.id, captured)
      }
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [isCapturing, action.id, customBindings, onCancelCapture, onSaveBinding])

  // Focus badge when entering capture mode
  useEffect(() => {
    if (isCapturing) {
      badgeRef.current?.focus()
    }
  }, [isCapturing])

  const handleConfirmConflict = useCallback(() => {
    if (!pendingBinding || !conflictInfo) return
    onSaveBinding(action.id, pendingBinding)
  }, [action.id, pendingBinding, conflictInfo, onSaveBinding])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{action.label}</p>
          <p className="text-xs text-muted-foreground">{action.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isCustom && !isCapturing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onResetBinding(action.id)}
              title="Reset to default"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
          <button
            ref={badgeRef}
            type="button"
            onClick={() => (isCapturing ? onCancelCapture() : onStartCapture(action.id))}
            className={
              isCapturing
                ? "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-mono font-semibold border-primary bg-primary/10 text-primary animate-pulse cursor-pointer focus:outline-none"
                : "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-mono font-semibold border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            }
          >
            {getBadgeLabel(isCapturing, conflictInfo, binding)}
          </button>
        </div>
      </div>

      {/* Conflict resolution inline */}
      {isCapturing && conflictInfo && (
        <div className="flex items-center gap-2 ml-1 text-xs">
          <span className="text-destructive">
            Conflicts with{" "}
            {conflictInfo.conflictIds
              .map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label)
              .filter(Boolean)
              .join(", ")}
          </span>
          <Button variant="outline" size="sm" className="h-5 px-2 text-xs" onClick={handleConfirmConflict}>
            Override
          </Button>
          <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={onCancelCapture}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function ShortcutCategory({
  title,
  description,
  actions,
  customBindings,
  capturingId,
  onStartCapture,
  onCancelCapture,
  onSaveBinding,
  onResetBinding,
}: {
  title: string
  description: string
  actions: ShortcutAction[]
  customBindings: Record<string, string>
  capturingId: string | null
  onStartCapture: (id: string) => void
  onCancelCapture: () => void
  onSaveBinding: (actionId: string, binding: string) => void
  onResetBinding: (actionId: string) => void
}) {
  if (actions.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.map((action) => (
            <ShortcutRow
              key={action.id}
              action={action}
              customBindings={customBindings}
              capturingId={capturingId}
              onStartCapture={onStartCapture}
              onCancelCapture={onCancelCapture}
              onSaveBinding={onSaveBinding}
              onResetBinding={onResetBinding}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function KeyboardSettings() {
  const { preferences, updatePreference, updateKeyboardShortcut, resetKeyboardShortcut, resetAllKeyboardShortcuts } =
    usePreferences()

  const customBindings = preferences?.keyboardShortcuts ?? {}
  const shortcuts = useMemo(() => getShortcutsByCategory(), [])
  const conflicts = useMemo(() => detectConflicts(customBindings), [customBindings])
  const hasConflicts = conflicts.size > 0
  const hasCustomBindings = Object.keys(customBindings).length > 0
  const messageSendMode = preferences?.messageSendMode ?? "enter"

  const [capturingId, setCapturingId] = useState<string | null>(null)

  // Click outside to cancel capture
  useEffect(() => {
    if (!capturingId) return
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      // Don't cancel if clicking inside a shortcut row
      if (target.closest("[data-shortcut-row]")) return
      setCapturingId(null)
    }
    // Use timeout to avoid immediately cancelling from the click that started capture
    const id = setTimeout(() => {
      document.addEventListener("click", handleClick)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener("click", handleClick)
    }
  }, [capturingId])

  const handleSaveBinding = useCallback(
    (actionId: string, binding: string) => {
      // If the new binding conflicts with other actions, clear those conflicting bindings
      const testBindings = { ...customBindings, [actionId]: binding }
      const newConflicts = detectConflicts(testBindings)
      const conflicting = newConflicts.get(binding)?.filter((id) => id !== actionId) ?? []

      // Clear conflicting bindings by setting them to "none"
      for (const conflictId of conflicting) {
        updateKeyboardShortcut(conflictId, "none")
      }

      updateKeyboardShortcut(actionId, binding)
      setCapturingId(null)
    },
    [customBindings, updateKeyboardShortcut]
  )

  const handleResetBinding = useCallback(
    (actionId: string) => {
      resetKeyboardShortcut(actionId)
    },
    [resetKeyboardShortcut]
  )

  const handleCancelCapture = useCallback(() => {
    setCapturingId(null)
  }, [])

  const handleStartCapture = useCallback((id: string) => {
    setCapturingId(id)
  }, [])

  const sharedProps = {
    customBindings,
    capturingId,
    onStartCapture: handleStartCapture,
    onCancelCapture: handleCancelCapture,
    onSaveBinding: handleSaveBinding,
    onResetBinding: handleResetBinding,
  }

  return (
    <div className="space-y-6">
      {hasConflicts && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Shortcut Conflicts</CardTitle>
            <CardDescription>Some shortcuts are using the same key binding</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {Array.from(conflicts.entries()).map(([key, actionIds]) => (
                <li key={key}>
                  <Badge variant="outline" className="font-mono mr-2">
                    {formatKeyBinding(key)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {actionIds
                      .map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label)
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Send Messages</CardTitle>
          <CardDescription>Choose how to send messages in the composer</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={messageSendMode}
            onValueChange={(value) => updatePreference("messageSendMode", value as MessageSendMode)}
            className="space-y-3"
          >
            {MESSAGE_SEND_MODE_OPTIONS.map((option) => (
              <div key={option} className="flex items-start space-x-3">
                <RadioGroupItem value={option} id={`send-mode-${option}`} className="mt-1" />
                <div className="grid gap-0.5">
                  <Label htmlFor={`send-mode-${option}`} className="cursor-pointer font-medium">
                    {SEND_MODE_CONFIG[option].label}
                  </Label>
                  <p className="text-sm text-muted-foreground">{SEND_MODE_CONFIG[option].description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <ShortcutCategory
        title="Navigation"
        description="Keyboard shortcuts for navigating Threa"
        actions={shortcuts.navigation}
        {...sharedProps}
      />

      <ShortcutCategory
        title="View"
        description="Keyboard shortcuts for view controls"
        actions={shortcuts.view}
        {...sharedProps}
      />

      <ShortcutCategory
        title="Editing"
        description="Keyboard shortcuts for formatting in the editor"
        actions={shortcuts.editing}
        {...sharedProps}
      />

      {hasCustomBindings && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={resetAllKeyboardShortcuts}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset all shortcuts
          </Button>
        </div>
      )}
    </div>
  )
}
