import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { usePreferences } from "@/contexts"
import {
  SHORTCUT_ACTIONS,
  getShortcutsByCategory,
  getEffectiveKeyBinding,
  formatKeyBinding,
  detectConflicts,
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

export function KeyboardSettings() {
  const { preferences, updatePreference } = usePreferences()

  const customBindings = preferences?.keyboardShortcuts ?? {}
  const shortcuts = useMemo(() => getShortcutsByCategory(), [])
  const conflicts = useMemo(() => detectConflicts(customBindings), [customBindings])

  const hasConflicts = conflicts.size > 0
  const messageSendMode = preferences?.messageSendMode ?? "cmdEnter"

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

      <Card>
        <CardHeader>
          <CardTitle>Navigation</CardTitle>
          <CardDescription>Keyboard shortcuts for navigating Threa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {shortcuts.navigation.map((action) => {
              const binding = getEffectiveKeyBinding(action.id, customBindings)
              return (
                <div key={action.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{action.label}</p>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    {binding ? formatKeyBinding(binding) : "—"}
                  </Badge>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {shortcuts.view.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>View</CardTitle>
            <CardDescription>Keyboard shortcuts for view controls</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {shortcuts.view.map((action) => {
                const binding = getEffectiveKeyBinding(action.id, customBindings)
                return (
                  <div key={action.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{action.label}</p>
                      <p className="text-sm text-muted-foreground">{action.description}</p>
                    </div>
                    <Badge variant="secondary" className="font-mono">
                      {binding ? formatKeyBinding(binding) : "—"}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {shortcuts.editing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Editing</CardTitle>
            <CardDescription>Keyboard shortcuts for editing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {shortcuts.editing.map((action) => {
                const binding = getEffectiveKeyBinding(action.id, customBindings)
                return (
                  <div key={action.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{action.label}</p>
                      <p className="text-sm text-muted-foreground">{action.description}</p>
                    </div>
                    <Badge variant="secondary" className="font-mono">
                      {binding ? formatKeyBinding(binding) : "—"}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Customization</CardTitle>
          <CardDescription>Shortcut customization coming soon</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The ability to rebind keyboard shortcuts will be available in a future update. For now, you can view the
            available shortcuts above.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
