import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { workspacesApi } from "@/api/workspaces"

export function MemberSetupPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const browserLocale = navigator.language

  const [slug, setSlug] = useState("")
  const [timezone, setTimezone] = useState(browserTimezone)
  const [locale, setLocale] = useState(browserLocale)

  const setupMutation = useMutation({
    mutationFn: () =>
      workspacesApi.completeMemberSetup(workspaceId!, {
        slug: slug || undefined,
        timezone,
        locale,
      }),
    onSuccess: () => {
      navigate(`/w/${workspaceId}`, { replace: true })
    },
  })

  if (!workspaceId) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground">Complete your profile to get started</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slug">Display slug</Label>
            <Input
              id="slug"
              placeholder="e.g. kristoffer-remback"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Used for @mentions. Leave blank to auto-generate from your name.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="locale">Locale</Label>
            <Input id="locale" value={locale} onChange={(e) => setLocale(e.target.value)} />
          </div>

          {setupMutation.isError && (
            <p className="text-sm text-destructive">
              {setupMutation.error instanceof Error ? setupMutation.error.message : "Setup failed. Please try again."}
            </p>
          )}

          <Button className="w-full" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
            {setupMutation.isPending ? "Setting up..." : "Complete Setup"}
          </Button>
        </div>
      </div>
    </div>
  )
}
