import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  const queryKey = ["bots", workspaceId]
  const [watchListUntil] = useState(() => Date.now() + 15_000)

  const { data: bots = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => botsApi.list(workspaceId),
    refetchInterval: () => (Date.now() < watchListUntil ? 500 : false),
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
    retry: 5,
  })

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)

  const createMutation = useMutation({
    mutationFn: (data: CreateBotInput) => botsApi.create(workspaceId, data),
    onSuccess: (bot) => {
      setName("")
      setSlug("")
      setDescription("")
      setSlugTouched(false)
      setShowCreateForm(false)
      queryClient.invalidateQueries({ queryKey })
      onSelectBot(bot.id)
    },
  })

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
    createMutation.mutate({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Bots ({bots.length})</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Integration identities that send messages via API keys.
          </p>
        </div>
        {!showCreateForm && (
          <Button size="sm" className="shrink-0 ml-4" onClick={() => setShowCreateForm(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New bot
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bot-name" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Name
            </Label>
            <Input
              id="bot-name"
              placeholder="e.g. GitHub Bot, Deploy Notifier"
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
            <Label
              htmlFor="bot-description"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateForm(false)
                setName("")
                setSlug("")
                setDescription("")
                setSlugTouched(false)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || !slug.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create bot"}
            </Button>
          </div>

          {createMutation.error && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Failed to create bot. Please try again."}
            </p>
          )}
        </div>
      )}

      {/* Bot list */}
      {bots.length > 0 && (
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
      )}

      {/* Empty state */}
      {bots.length === 0 && !showCreateForm && (
        <div className="rounded-lg border border-dashed py-8 flex flex-col items-center gap-2">
          <BotIcon className="h-5 w-5 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No bots yet</p>
        </div>
      )}
    </div>
  )
}
