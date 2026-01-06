import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { usePreferences } from "@/contexts"
import { THEME_OPTIONS, MESSAGE_DISPLAY_OPTIONS, type Theme, type MessageDisplay } from "@threa/types"

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
}

const MESSAGE_DISPLAY_LABELS: Record<MessageDisplay, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
}

const MESSAGE_DISPLAY_DESCRIPTIONS: Record<MessageDisplay, string> = {
  compact: "More messages visible at once",
  comfortable: "More spacing between messages",
}

export function AppearanceSettings() {
  const { preferences, updatePreference } = usePreferences()

  const theme = preferences?.theme ?? "system"
  const messageDisplay = preferences?.messageDisplay ?? "comfortable"

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Choose how Threa looks to you</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme}
            onValueChange={(value) => updatePreference("theme", value as Theme)}
            className="grid grid-cols-3 gap-4"
          >
            {THEME_OPTIONS.map((option) => (
              <div key={option}>
                <RadioGroupItem value={option} id={`theme-${option}`} className="peer sr-only" />
                <Label
                  htmlFor={`theme-${option}`}
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  {THEME_LABELS[option]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message Display</CardTitle>
          <CardDescription>Choose how messages are displayed</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={messageDisplay}
            onValueChange={(value) => updatePreference("messageDisplay", value as MessageDisplay)}
            className="space-y-3"
          >
            {MESSAGE_DISPLAY_OPTIONS.map((option) => (
              <div key={option} className="flex items-start space-x-3">
                <RadioGroupItem value={option} id={`display-${option}`} className="mt-1" />
                <div className="grid gap-1">
                  <Label htmlFor={`display-${option}`} className="cursor-pointer">
                    {MESSAGE_DISPLAY_LABELS[option]}
                  </Label>
                  <p className="text-sm text-muted-foreground">{MESSAGE_DISPLAY_DESCRIPTIONS[option]}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  )
}
