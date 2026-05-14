import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { WORKSPACE_PERMISSION_SCOPES } from "@threa/types"
import { botsApi, type CreateBotInput } from "@/api/bots"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Plus, BotIcon } from "lucide-react"
import { BotAvatar } from "./bot-avatar"
import { BotDetail } from "./bot-detail"
import { useCachedWorkspaceBootstrap, workspaceKeys } from "@/hooks/use-workspaces"
import { hasPermission } from "@/lib/permissions"
import { useWorkspaceBots } from "@/stores/workspace-store"

interface BotsTabProps {
  workspaceId: string
}

export function BotsTab({ workspaceId }: BotsTabProps) {
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)

  if (selectedBotId) {
    return <BotDetail workspaceId={workspaceId} botId={selectedBotId} onBack={() => setSelectedBotId(null)} />
  }

  return <BotList workspaceId={workspaceId} onSelectBot={setSelectedBotId} />
}

function BotList({ workspaceId, onSelectBot }: { workspaceId: string; onSelectBot: (id: string) => void }) {
  const queryClient = useQueryClient()
  const bootstrap = useCachedWorkspaceBootstrap(workspaceId)
  const allCachedBots = useWorkspaceBots(workspaceId)

  const canManageShared = hasPermission(bootstrap?.viewerPermissions, WORKSPACE_PERMISSION_SCOPES.BOTS_MANAGE)
  const canCreateShared = hasPermission(bootstrap?.viewerPermissions, WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_SHARED)
  const canCreatePersonal = hasPermission(
    bootstrap?.viewerPermissions,
    WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_PERSONAL
  )

  const showSharedSection = canManageShared || canCreateShared
  const showPersonalSection = canCreatePersonal

  const sharedBotsQueryKey = ["bots", workspaceId, "shared"]
  const { data: sharedBots = [], isLoading: sharedLoading } = useQuery({
    queryKey: sharedBotsQueryKey,
    queryFn: () => botsApi.list(workspaceId),
    enabled: showSharedSection,
    refetchOnMount: "always",
  })

  // Personal bots come from the bootstrap-synced IDB cache filtered by type.
  const personalBots = allCachedBots.filter((b) => b.type === "personal" && !b.archivedAt)

  const [showCreateSharedForm, setShowCreateSharedForm] = useState(false)
  const [showCreatePersonalForm, setShowCreatePersonalForm] = useState(false)

  const sharedCreateMutation = useMutation({
    mutationFn: (data: CreateBotInput) => botsApi.create(workspaceId, { ...data, type: "shared" }),
    onSuccess: (bot) => {
      setShowCreateSharedForm(false)
      queryClient.invalidateQueries({ queryKey: sharedBotsQueryKey })
      onSelectBot(bot.id)
    },
  })

  const personalCreateMutation = useMutation({
    mutationFn: (data: CreateBotInput) => botsApi.create(workspaceId, { ...data, type: "personal" }),
    onSuccess: (bot) => {
      setShowCreatePersonalForm(false)
      queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
      onSelectBot(bot.id)
    },
  })

  if (showSharedSection && sharedLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-1">
      {showSharedSection && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Workspace bots ({sharedBots.length})</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shared integration identities managed by workspace admins.
              </p>
            </div>
            {!showCreateSharedForm && canCreateShared && (
              <Button size="sm" className="shrink-0 ml-4" onClick={() => setShowCreateSharedForm(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New bot
              </Button>
            )}
          </div>

          {showCreateSharedForm && (
            <CreateBotForm
              placeholder="e.g. GitHub Bot, Deploy Notifier"
              isPending={sharedCreateMutation.isPending}
              error={sharedCreateMutation.error}
              onCancel={() => setShowCreateSharedForm(false)}
              onCreate={(data) => sharedCreateMutation.mutate(data)}
            />
          )}

          <BotListItems bots={sharedBots} workspaceId={workspaceId} onSelectBot={onSelectBot} />

          {sharedBots.length === 0 && !showCreateSharedForm && <EmptyBotsState label="No workspace bots yet" />}
        </section>
      )}

      {showSharedSection && showPersonalSection && <Separator />}

      {showPersonalSection && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">My bots ({personalBots.length})</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Personal bots you own and manage independently.</p>
            </div>
            {!showCreatePersonalForm && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 ml-4"
                onClick={() => setShowCreatePersonalForm(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New bot
              </Button>
            )}
          </div>

          {showCreatePersonalForm && (
            <CreateBotForm
              placeholder="e.g. OpenClaw, Hermes"
              isPending={personalCreateMutation.isPending}
              error={personalCreateMutation.error}
              onCancel={() => setShowCreatePersonalForm(false)}
              onCreate={(data) => personalCreateMutation.mutate(data)}
            />
          )}

          <BotListItems bots={personalBots} workspaceId={workspaceId} onSelectBot={onSelectBot} />

          {personalBots.length === 0 && !showCreatePersonalForm && <EmptyBotsState label="No personal bots yet" />}
        </section>
      )}

      {!showSharedSection && !showPersonalSection && (
        <EmptyBotsState label="You don't have permission to create or manage bots." />
      )}
    </div>
  )
}

interface CreateBotFormProps {
  placeholder: string
  isPending: boolean
  error: Error | null
  onCancel: () => void
  onCreate: (data: Omit<CreateBotInput, "type">) => void
}

function CreateBotForm({ placeholder, isPending, error, onCancel, onCreate }: CreateBotFormProps) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      )
    }
  }

  const handleCreate = () => {
    if (!name.trim() || !slug.trim()) return
    onCreate({ name: name.trim(), slug: slug.trim(), description: description.trim() || null })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="bot-name" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Name
        </Label>
        <Input
          id="bot-name"
          placeholder={placeholder}
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bot-slug" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Slug
        </Label>
        <Input
          id="bot-slug"
          placeholder="e.g. github-bot"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(e.target.value)
          }}
        />
        <p className="text-xs text-muted-foreground">Unique identifier. Lowercase letters, numbers, and hyphens.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bot-description" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Description
        </Label>
        <Textarea
          id="bot-description"
          placeholder="What does this bot do?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !slug.trim() || isPending}>
          {isPending ? "Creating..." : "Create bot"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to create bot. Please try again."}
        </p>
      )}
    </div>
  )
}

interface BotListItem {
  id: string
  name: string
  slug: string | null
  description: string | null
  avatarUrl: string | null
  avatarEmoji: string | null
}

function BotListItems({
  bots,
  workspaceId,
  onSelectBot,
}: {
  bots: BotListItem[]
  workspaceId: string
  onSelectBot: (id: string) => void
}) {
  if (bots.length === 0) return null

  return (
    <div className="rounded-lg border divide-y">
      {bots.map((bot) => (
        <button
          key={bot.id}
          className="w-full flex items-center gap-3 px-3 py-3 hover:bg-accent/50 transition-colors text-left"
          onClick={() => onSelectBot(bot.id)}
        >
          <BotAvatar bot={bot} workspaceId={workspaceId} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium truncate">{bot.name}</span>
              {bot.slug && (
                <code className="text-[11px] text-muted-foreground/70 font-mono hidden sm:inline">@{bot.slug}</code>
              )}
            </div>
            {bot.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{bot.description}</p>}
          </div>
        </button>
      ))}
    </div>
  )
}

function EmptyBotsState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed py-8 flex flex-col items-center gap-2">
      <BotIcon className="h-5 w-5 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
