import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import limax from "limax"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TimezonePicker } from "@/components/ui/timezone-picker"
import { LocalePicker } from "@/components/ui/locale-picker"
import { useUser } from "@/auth"
import { workspacesApi } from "@/api/workspaces"

function generateSlug(name: string): string {
  return limax(name, { tone: false }).slice(0, 50)
}

type SlugStatus = "idle" | "checking" | "available" | "taken"

export function MemberSetupPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const user = useUser()

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const browserLocale = navigator.language

  const [name, setName] = useState(() => user?.name ?? "")
  const [slug, setSlug] = useState(() => generateSlug(user?.name ?? ""))
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle")
  const [timezone, setTimezone] = useState(browserTimezone)
  const [locale, setLocale] = useState(browserLocale)

  const slugCheckTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const slugCheckAbort = useRef<AbortController>(null)

  const checkSlug = useCallback(
    (slugToCheck: string) => {
      // Always invalidate the previous check so stale responses cannot overwrite newer input state.
      slugCheckAbort.current?.abort()

      if (!workspaceId || slugToCheck.length === 0) {
        slugCheckAbort.current = null
        setSlugStatus("idle")
        return
      }

      const controller = new AbortController()
      slugCheckAbort.current = controller

      setSlugStatus("checking")

      workspacesApi
        .checkSlugAvailable(workspaceId, slugToCheck)
        .then((available) => {
          if (controller.signal.aborted || slugCheckAbort.current !== controller) return
          setSlugStatus(available ? "available" : "taken")
        })
        .catch(() => {
          if (controller.signal.aborted || slugCheckAbort.current !== controller) return
          setSlugStatus("idle")
        })
    },
    [workspaceId]
  )

  const debouncedCheckSlug = useCallback(
    (slugToCheck: string) => {
      if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
      slugCheckTimer.current = setTimeout(() => checkSlug(slugToCheck), 500)
    },
    [checkSlug]
  )

  function handleNameChange(newName: string) {
    setName(newName)
    if (!slugManuallyEdited) {
      const derived = generateSlug(newName)
      setSlug(derived)
      debouncedCheckSlug(derived)
    }
  }

  function handleSlugChange(newSlug: string) {
    setSlugManuallyEdited(true)
    setSlug(newSlug)
    debouncedCheckSlug(newSlug)
  }

  // Check initial slug on mount
  useEffect(() => {
    if (slug.length > 0) {
      debouncedCheckSlug(slug)
    }
    return () => {
      if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
      slugCheckAbort.current?.abort()
    }
  }, [])

  const trimmedSlug = slug.trim()

  const setupMutation = useMutation({
    mutationFn: () =>
      workspacesApi.completeMemberSetup(workspaceId!, {
        name: name || undefined,
        slug: trimmedSlug || undefined,
        timezone,
        locale,
      }),
    onSuccess: () => {
      navigate(`/w/${workspaceId}`, { replace: true })
    },
  })

  if (!workspaceId) return null

  const isSlugBlank = trimmedSlug.length === 0
  const canSubmit = (isSlugBlank || (slugStatus !== "taken" && slugStatus !== "checking")) && !setupMutation.isPending

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground">Complete your profile to get started</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              placeholder="e.g. Kristoffer Remback"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">How others will see you in this workspace.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Display slug</Label>
            <div className="relative">
              <Input
                id="slug"
                placeholder="e.g. kristoffer-remback"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className="pr-8"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {slugStatus === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {slugStatus === "available" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {slugStatus === "taken" && <XCircle className="h-4 w-4 text-destructive" />}
              </div>
            </div>
            {slugStatus === "taken" && (
              <p className="text-xs text-destructive">This slug is already taken in this workspace.</p>
            )}
            {slugStatus !== "taken" && (
              <p className="text-xs text-muted-foreground">
                Used for @mentions. Leave blank to auto-generate from your name.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <TimezonePicker value={timezone} onChange={setTimezone} />
          </div>

          <div className="space-y-2">
            <Label>Locale</Label>
            <LocalePicker value={locale} onChange={setLocale} />
          </div>

          {setupMutation.isError && (
            <p className="text-sm text-destructive">
              {setupMutation.error instanceof Error ? setupMutation.error.message : "Setup failed. Please try again."}
            </p>
          )}

          <Button className="w-full" onClick={() => setupMutation.mutate()} disabled={!canSubmit}>
            {setupMutation.isPending ? "Setting up..." : "Complete Setup"}
          </Button>
        </div>
      </div>
    </div>
  )
}
