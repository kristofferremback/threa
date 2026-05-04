import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SW_MSG_SHOW_VIBRATION_TEST } from "@/lib/sw-messages"

// Temporary diagnostic page for tuning push notification vibration patterns.
// Triggers showNotification via the service worker so we exercise the same
// code path push notifications use (and not just navigator.vibrate, which
// can behave differently from notification-driven vibration on Android).

interface Preset {
  name: string
  pattern: string
  description: string
}

const PRESETS: Preset[] = [
  { name: "OS default (none)", pattern: "", description: "What we ship today — falls through to the OS default" },
  { name: "Tap", pattern: "40", description: "Single short tap" },
  { name: "Double tap", pattern: "30,40,30", description: "Quick dzt-dzt — Messenger-ish" },
  { name: "Triple tap", pattern: "20,30,20,30,20", description: "Three quick taps in a row" },
  { name: "Long buzz", pattern: "200", description: "One sustained buzz" },
  { name: "Mention burst", pattern: "60,40,60,40,120", description: "Two taps then a longer hit — for @mentions" },
  { name: "Heartbeat", pattern: "30,40,30,180,30,40,30", description: "Da-dum...da-dum" },
  { name: "Standard OS pattern", pattern: "200,100,200", description: "Roughly the Android default dzzt-dzzt" },
]

function parsePattern(text: string): number[] | null {
  const trimmed = text.trim()
  if (trimmed === "") return []
  const parts = trimmed.split(/[,\s]+/).filter(Boolean)
  const nums: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
    nums.push(n)
  }
  return nums
}

export function VibrationLabPage() {
  const [title, setTitle] = useState("Threa vibration test")
  const [body, setBody] = useState("Pattern: ")
  const [patternText, setPatternText] = useState("30,40,30")
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({
    kind: "idle",
    message: "",
  })

  const parsed = useMemo(() => parsePattern(patternText), [patternText])
  const isValid = parsed !== null

  const sendNotification = useCallback(async () => {
    if (parsed === null) {
      setStatus({ kind: "error", message: "Pattern must be comma- or space-separated non-negative integers (ms)." })
      return
    }
    if (typeof Notification === "undefined") {
      setStatus({ kind: "error", message: "Notification API unavailable in this browser." })
      return
    }
    if (Notification.permission !== "granted") {
      const result = await Notification.requestPermission()
      if (result !== "granted") {
        setStatus({ kind: "error", message: `Notification permission ${result}.` })
        return
      }
    }

    // Wait for an active SW. .ready resolves only when one exists, so this
    // also guards the dev path where the SW hasn't installed yet.
    const registration = await navigator.serviceWorker?.ready
    const target = navigator.serviceWorker?.controller ?? registration?.active
    if (!target) {
      setStatus({ kind: "error", message: "Service worker not controlling this page yet — reload and try again." })
      return
    }

    const resolvedBody = body.includes("Pattern: ")
      ? body.replace("Pattern: ", `Pattern: [${parsed.join(", ")}]`)
      : body

    target.postMessage({
      type: SW_MSG_SHOW_VIBRATION_TEST,
      title,
      body: resolvedBody,
      vibrate: parsed,
    })

    setStatus({
      kind: "ok",
      message: parsed.length === 0 ? "Sent (no pattern — OS default applies)." : `Sent vibrate=[${parsed.join(", ")}].`,
    })
  }, [parsed, title, body])

  const vibrateInPage = useCallback(() => {
    if (parsed === null) {
      setStatus({ kind: "error", message: "Invalid pattern." })
      return
    }
    if (typeof navigator.vibrate !== "function") {
      setStatus({ kind: "error", message: "navigator.vibrate not supported on this device." })
      return
    }
    const ok = navigator.vibrate(parsed.length > 0 ? parsed : 0)
    setStatus({
      kind: ok ? "ok" : "error",
      message: ok ? `Triggered navigator.vibrate([${parsed.join(", ")}]).` : "navigator.vibrate returned false.",
    })
  }, [parsed])

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Vibration lab</h1>
        <p className="text-sm text-muted-foreground">
          Feel candidate notification vibration patterns on this device. Patterns are alternating vibrate / pause
          durations in milliseconds. Custom <code>vibrate</code> on notifications is honored on Android Chromium PWAs;
          iOS and most desktop browsers ignore it.
        </p>
      </header>

      <section className="space-y-3">
        <Label htmlFor="vibration-pattern">Pattern (ms, comma- or space-separated)</Label>
        <Input
          id="vibration-pattern"
          inputMode="numeric"
          value={patternText}
          onChange={(e) => setPatternText(e.target.value)}
          placeholder="e.g. 30,40,30"
          aria-invalid={!isValid}
        />
        {!isValid && (
          <p className="text-sm text-destructive">Use non-negative integers separated by commas or spaces.</p>
        )}
      </section>

      <section className="space-y-3">
        <Label htmlFor="vibration-title">Title</Label>
        <Input id="vibration-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Label htmlFor="vibration-body">Body</Label>
        <Input id="vibration-body" value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          The string <code>Pattern: </code> in the body is replaced with the parsed array on send.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={sendNotification} disabled={!isValid}>
            Send notification
          </Button>
          <Button variant="outline" onClick={vibrateInPage} disabled={!isValid}>
            Vibrate in-page (no notification)
          </Button>
        </div>
        {status.kind !== "idle" && (
          <p className={status.kind === "ok" ? "text-sm text-foreground" : "text-sm text-destructive"}>
            {status.message}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Presets</h2>
        <ul className="space-y-2">
          {PRESETS.map((preset) => (
            <li key={preset.name} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{preset.name}</div>
                <div className="text-xs text-muted-foreground">{preset.description}</div>
                <code className="mt-1 block text-xs text-muted-foreground">[{preset.pattern || "(empty)"}]</code>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPatternText(preset.pattern)}>
                Load
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
