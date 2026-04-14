import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { usePreferences } from "@/contexts"
import {
  THEME_OPTIONS,
  MESSAGE_DISPLAY_OPTIONS,
  CODE_BLOCK_COLLAPSE_THRESHOLD_MIN,
  CODE_BLOCK_COLLAPSE_THRESHOLD_MAX,
  DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD,
  BLOCKQUOTE_COLLAPSE_THRESHOLD_MIN,
  BLOCKQUOTE_COLLAPSE_THRESHOLD_MAX,
  DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD,
  type Theme,
  type MessageDisplay,
} from "@threa/types"

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
  const codeBlockThreshold = preferences?.codeBlockCollapseThreshold ?? DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD
  const blockquoteThreshold = preferences?.blockquoteCollapseThreshold ?? DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD

  // Local input state so users can type freely without each keystroke
  // hitting the preferences mutation. We commit on blur / Enter only.
  const [codeThresholdDraft, setCodeThresholdDraft] = useState<string>(String(codeBlockThreshold))
  useEffect(() => {
    setCodeThresholdDraft(String(codeBlockThreshold))
  }, [codeBlockThreshold])

  const [blockquoteThresholdDraft, setBlockquoteThresholdDraft] = useState<string>(String(blockquoteThreshold))
  useEffect(() => {
    setBlockquoteThresholdDraft(String(blockquoteThreshold))
  }, [blockquoteThreshold])

  const commitCodeThreshold = () => {
    const parsed = Number.parseInt(codeThresholdDraft, 10)
    if (!Number.isFinite(parsed)) {
      setCodeThresholdDraft(String(codeBlockThreshold))
      return
    }
    const clamped = Math.min(CODE_BLOCK_COLLAPSE_THRESHOLD_MAX, Math.max(CODE_BLOCK_COLLAPSE_THRESHOLD_MIN, parsed))
    if (clamped === codeBlockThreshold) {
      setCodeThresholdDraft(String(clamped))
      return
    }
    void updatePreference("codeBlockCollapseThreshold", clamped)
  }

  const commitBlockquoteThreshold = () => {
    const parsed = Number.parseInt(blockquoteThresholdDraft, 10)
    if (!Number.isFinite(parsed)) {
      setBlockquoteThresholdDraft(String(blockquoteThreshold))
      return
    }
    const clamped = Math.min(BLOCKQUOTE_COLLAPSE_THRESHOLD_MAX, Math.max(BLOCKQUOTE_COLLAPSE_THRESHOLD_MIN, parsed))
    if (clamped === blockquoteThreshold) {
      setBlockquoteThresholdDraft(String(clamped))
      return
    }
    void updatePreference("blockquoteCollapseThreshold", clamped)
  }

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

      <Card>
        <CardHeader>
          <CardTitle>Code Blocks</CardTitle>
          <CardDescription>Collapse long code blocks by default to keep messages scannable</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="grid gap-1 flex-1">
              <Label htmlFor="code-block-collapse-threshold" className="cursor-pointer">
                Collapse threshold
              </Label>
              <p className="text-sm text-muted-foreground">
                Code blocks with more than this many lines start collapsed. You can always click to expand or collapse
                individual blocks.
              </p>
            </div>
            <Input
              id="code-block-collapse-threshold"
              type="number"
              inputMode="numeric"
              min={CODE_BLOCK_COLLAPSE_THRESHOLD_MIN}
              max={CODE_BLOCK_COLLAPSE_THRESHOLD_MAX}
              value={codeThresholdDraft}
              onChange={(event) => setCodeThresholdDraft(event.target.value)}
              onBlur={commitCodeThreshold}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitCodeThreshold()
                }
              }}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Block Quotes</CardTitle>
          <CardDescription>
            Collapse long quotes and quote replies by default to keep messages scannable
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="grid gap-1 flex-1">
              <Label htmlFor="blockquote-collapse-threshold" className="cursor-pointer">
                Collapse threshold
              </Label>
              <p className="text-sm text-muted-foreground">
                Block quotes and quote replies with more than this many lines start collapsed. You can always click to
                expand or collapse individual quotes.
              </p>
            </div>
            <Input
              id="blockquote-collapse-threshold"
              type="number"
              inputMode="numeric"
              min={BLOCKQUOTE_COLLAPSE_THRESHOLD_MIN}
              max={BLOCKQUOTE_COLLAPSE_THRESHOLD_MAX}
              value={blockquoteThresholdDraft}
              onChange={(event) => setBlockquoteThresholdDraft(event.target.value)}
              onBlur={commitBlockquoteThreshold}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitBlockquoteThreshold()
                }
              }}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
