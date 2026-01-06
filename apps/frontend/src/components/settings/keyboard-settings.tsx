import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { usePreferences } from "@/contexts"
import {
  SHORTCUT_ACTIONS,
  getShortcutsByCategory,
  getEffectiveKeyBinding,
  formatKeyBinding,
  detectConflicts,
} from "@/lib/keyboard-shortcuts"

export function KeyboardSettings() {
  const { preferences } = usePreferences()

  const customBindings = preferences?.keyboardShortcuts ?? {}
  const shortcuts = useMemo(() => getShortcutsByCategory(), [])
  const conflicts = useMemo(() => detectConflicts(customBindings), [customBindings])

  const hasConflicts = conflicts.size > 0

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
