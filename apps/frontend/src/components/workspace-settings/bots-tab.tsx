import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { botsApi, type CreateBotInput, type CreateBotKeyInput } from "@/api/bots"
import { getBotAvatarUrl, StreamTypes, type WorkspaceBootstrap } from "@threa/types"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFormattedDate } from "@/hooks/use-formatted-date"
import { API_KEY_PERMISSIONS, BOT_KEY_PREFIX, type ApiKeyScope, type BotApiKey } from "@threa/types"
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  BotIcon,
  Hash,
  Trash2,
  Upload,
  X,
} from "lucide-react"

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(API_KEY_PERMISSIONS.map((p) => [p.slug, p.name]))

function BotAvatar({
  bot,
  workspaceId,
  size = 36,
}: {
  bot: { avatarUrl?: string | null; avatarEmoji?: string | null; name: string }
  workspaceId: string
  size?: number
}) {
  const avatarUrl = getBotAvatarUrl(workspaceId, bot.avatarUrl, size > 64 ? 256 : 64)

  return (
    <div
      className="rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      {avatarUrl && <img src={avatarUrl} alt={bot.name} className="w-full h-full object-cover" />}
      {!avatarUrl && bot.avatarEmoji && <span style={{ fontSize: size * 0.5 }}>{bot.avatarEmoji}</span>}
      {!avatarUrl && !bot.avatarEmoji && (
        <BotIcon className="text-emerald-600" style={{ width: size * 0.45, height: size * 0.45 }} />
      )}
    </div>
  )
}

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

// ─── Bot List ───────────────────────────────────────────────────────────────

function BotList({ workspaceId, onSelectBot }: { workspaceId: string; onSelectBot: (id: string) => void }) {
  const queryClient = useQueryClient()
  const queryKey = ["bots", workspaceId]

  const { data: bots = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => botsApi.list(workspaceId),
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

// ─── Bot Detail ─────────────────────────────────────────────────────────────

function BotDetail({ workspaceId, botId, onBack }: { workspaceId: string; botId: string; onBack: () => void }) {
  const queryClient = useQueryClient()
  const botQueryKey = ["bots", workspaceId, botId]
  const keysQueryKey = ["bot-keys", workspaceId, botId]
  const { formatDate } = useFormattedDate()

  const { data: bot, isLoading: botLoading } = useQuery({
    queryKey: botQueryKey,
    queryFn: () => botsApi.get(workspaceId, botId),
  })

  const { data: keys = [], isLoading: keysLoading } = useQuery({
    queryKey: keysQueryKey,
    queryFn: () => botsApi.listKeys(workspaceId, botId),
  })

  const grantsQueryKey = ["bot-stream-grants", workspaceId, botId]
  const { data: streamGrants = [] } = useQuery({
    queryKey: grantsQueryKey,
    queryFn: () => botsApi.listStreamGrants(workspaceId, botId),
  })

  // Workspace streams for the channel picker
  const { data: wsBootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  // Profile editing state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editSlug, setEditSlug] = useState("")
  const [editDescription, setEditDescription] = useState("")

  // Key creation state
  const [showKeyForm, setShowKeyForm] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [keyScopes, setKeyScopes] = useState<Set<ApiKeyScope>>(new Set())
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null)
  const [showKeyValue, setShowKeyValue] = useState(false)
  const [copied, setCopied] = useState(false)

  // Key revocation state
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)
  const [revokedOpen, setRevokedOpen] = useState(false)

  // Archive state
  const [archiveTarget, setArchiveTarget] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; slug?: string; description?: string | null }) =>
      botsApi.update(workspaceId, botId, data),
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: botQueryKey })
      queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => botsApi.archive(workspaceId, botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] })
      onBack()
    },
  })

  const restoreMutation = useMutation({
    mutationFn: () => botsApi.restore(workspaceId, botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: botQueryKey })
      queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] })
    },
  })

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => botsApi.uploadAvatar(workspaceId, botId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: botQueryKey })
      queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] })
    },
  })

  const removeAvatarMutation = useMutation({
    mutationFn: () => botsApi.removeAvatar(workspaceId, botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: botQueryKey })
      queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] })
    },
  })

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadAvatarMutation.mutate(file)
    }
    e.target.value = ""
  }

  const [channelSearch, setChannelSearch] = useState("")

  const grantStreamMutation = useMutation({
    mutationFn: (streamId: string) => botsApi.grantStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grantsQueryKey })
      setChannelSearch("")
    },
  })

  const revokeStreamMutation = useMutation({
    mutationFn: (streamId: string) => botsApi.revokeStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: grantsQueryKey }),
  })

  const grantedStreamIds = useMemo(() => new Set(streamGrants.map((g) => g.streamId)), [streamGrants])

  const availableChannels = useMemo(() => {
    if (!channelSearch || !wsBootstrap?.streams) return []
    const q = channelSearch.toLowerCase()
    return wsBootstrap.streams
      .filter(
        (s) =>
          s.type === StreamTypes.CHANNEL &&
          !s.archivedAt &&
          !grantedStreamIds.has(s.id) &&
          (s.slug?.toLowerCase().includes(q) || s.displayName?.toLowerCase().includes(q))
      )
      .slice(0, 10)
  }, [wsBootstrap, channelSearch, grantedStreamIds])

  const grantedStreams = useMemo(() => {
    if (!wsBootstrap?.streams) return []
    return streamGrants
      .map((g) => {
        const stream = wsBootstrap.streams.find((s) => s.id === g.streamId)
        return stream ? { ...g, slug: stream.slug, displayName: stream.displayName } : null
      })
      .filter(Boolean) as Array<{
      streamId: string
      grantedBy: string
      grantedAt: string
      slug: string | null
      displayName: string | null
    }>
  }, [streamGrants, wsBootstrap])

  const createKeyMutation = useMutation({
    mutationFn: (data: CreateBotKeyInput) => botsApi.createKey(workspaceId, botId, data),
    onSuccess: (data) => {
      setCreatedKeyValue(data.value)
      setShowKeyValue(true)
      setCopied(false)
      setKeyName("")
      setKeyScopes(new Set())
      setShowKeyForm(false)
      queryClient.invalidateQueries({ queryKey: keysQueryKey })
    },
  })

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: string) => botsApi.revokeKey(workspaceId, botId, keyId),
    onSuccess: () => {
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey: keysQueryKey })
    },
    onError: () => {
      setRevokeTarget(null)
    },
  })

  const startEditing = () => {
    if (!bot) return
    setEditName(bot.name)
    setEditSlug(bot.slug ?? "")
    setEditDescription(bot.description ?? "")
    setEditing(true)
  }

  const handleSave = () => {
    if (!editName.trim() || !editSlug.trim()) return
    updateMutation.mutate({
      name: editName.trim(),
      slug: editSlug.trim(),
      description: editDescription.trim() || null,
    })
  }

  const toggleScope = (scope: ApiKeyScope) => {
    setKeyScopes((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) {
        next.delete(scope)
      } else {
        next.add(scope)
      }
      return next
    })
  }

  const handleCreateKey = () => {
    if (!keyName.trim() || keyScopes.size === 0) return
    createKeyMutation.mutate({ name: keyName.trim(), scopes: [...keyScopes] })
  }

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable
    }
  }, [])

  if (botLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (!bot) {
    return (
      <div className="p-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        <p className="text-sm text-muted-foreground mt-4">Bot not found.</p>
      </div>
    )
  }

  const activeKeys = keys.filter((k: BotApiKey) => !k.revokedAt)
  const revokedKeys = keys.filter((k: BotApiKey) => k.revokedAt)
  const isArchived = !!bot.archivedAt

  return (
    <div className="space-y-6 p-1">
      {/* Back + title */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <BotAvatar bot={bot} workspaceId={workspaceId} size={32} />
        <div>
          <h3 className="text-sm font-medium">{bot.name}</h3>
          {bot.slug && <p className="text-xs text-muted-foreground">@{bot.slug}</p>}
        </div>
        {isArchived && (
          <Badge variant="secondary" className="ml-auto text-xs">
            Archived
          </Badge>
        )}
      </div>

      {/* Profile section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Profile</h4>
          {!isArchived && !editing && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>

        {/* Avatar upload */}
        {!isArchived && (
          <div className="flex items-center gap-3">
            <BotAvatar bot={bot} workspaceId={workspaceId} size={56} />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadAvatarMutation.isPending}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  {uploadAvatarMutation.isPending ? "Uploading..." : "Upload image"}
                </Button>
                {bot.avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => removeAvatarMutation.mutate()}
                    disabled={removeAvatarMutation.isPending}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 50MB.</p>
              {uploadAvatarMutation.error && (
                <p className="text-xs text-destructive">
                  {uploadAvatarMutation.error instanceof Error ? uploadAvatarMutation.error.message : "Upload failed."}
                </p>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
        )}

        {editing ? (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Slug</Label>
              <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!editName.trim() || !editSlug.trim() || updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            {updateMutation.error && (
              <p className="text-sm text-destructive">
                {updateMutation.error instanceof Error ? updateMutation.error.message : "Failed to save."}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border px-3 py-2.5 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-medium">{bot.name}</p>
              {bot.slug && <span className="text-xs text-muted-foreground font-mono">@{bot.slug}</span>}
            </div>
            {bot.description && <p className="text-xs text-muted-foreground">{bot.description}</p>}
            {!bot.description && <p className="text-xs text-muted-foreground italic">No description</p>}
          </div>
        )}
      </section>

      <Separator />

      {/* API Keys section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">API Keys</h4>
          {!isArchived && !showKeyForm && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowKeyForm(true)}>
              <Plus className="h-3 w-3 mr-1" />
              New key
            </Button>
          )}
        </div>

        {/* Key reveal banner */}
        {createdKeyValue && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Key className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Your new bot key</p>
                <p className="text-xs text-muted-foreground">
                  Copy this key now. For security, it won't be displayed again.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-xs bg-background border p-2.5 rounded-md break-all font-mono select-all">
                {showKeyValue
                  ? createdKeyValue
                  : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setShowKeyValue(!showKeyValue)}
                  >
                    {showKeyValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showKeyValue ? "Hide" : "Reveal"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={() => copyToClipboard(createdKeyValue)}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
              </Tooltip>
            </div>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setCreatedKeyValue(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Create key form */}
        {showKeyForm && (
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Key name</Label>
              <Input
                placeholder="e.g. production, staging"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Permissions</Label>
              <div className="rounded-md border divide-y">
                {API_KEY_PERMISSIONS.map((perm) => (
                  <label
                    key={perm.slug}
                    className="block px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors first:rounded-t-md last:rounded-b-md"
                  >
                    <span className="flex items-center gap-3">
                      <Checkbox checked={keyScopes.has(perm.slug)} onCheckedChange={() => toggleScope(perm.slug)} />
                      <span className="text-sm font-medium">{perm.name}</span>
                    </span>
                    <p className="text-xs text-muted-foreground leading-relaxed ml-7 mt-0.5">{perm.description}</p>
                  </label>
                ))}
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowKeyForm(false)
                  setKeyName("")
                  setKeyScopes(new Set())
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateKey}
                disabled={!keyName.trim() || keyScopes.size === 0 || createKeyMutation.isPending}
              >
                {createKeyMutation.isPending ? "Creating..." : "Create key"}
              </Button>
            </div>
            {createKeyMutation.error && (
              <p className="text-sm text-destructive">
                {createKeyMutation.error instanceof Error ? createKeyMutation.error.message : "Failed to create key."}
              </p>
            )}
          </div>
        )}

        {/* Active keys */}
        {keysLoading && <Skeleton className="h-16 w-full" />}

        {!keysLoading && activeKeys.length > 0 && (
          <div className="rounded-lg border divide-y">
            {activeKeys.map((key: BotApiKey) => (
              <div key={key.id} className="flex items-center gap-3 px-3 py-3 group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium truncate">{key.name}</span>
                    <code className="text-[11px] text-muted-foreground/70 font-mono hidden sm:inline">
                      {BOT_KEY_PREFIX}
                      {key.keyPrefix}...
                    </code>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {key.scopes.map((scope: string) => (
                      <Badge key={scope} variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                        {SCOPE_LABELS[scope] ?? scope}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Created {formatDate(new Date(key.createdAt))}
                    {key.lastUsedAt && (
                      <>
                        <span className="mx-1 text-border">&middot;</span>
                        Last used {formatDate(new Date(key.lastUsedAt))}
                      </>
                    )}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Revoke key</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {!keysLoading && activeKeys.length === 0 && !showKeyForm && (
          <div className="rounded-lg border border-dashed py-6 flex flex-col items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No API keys yet. Create one to start sending messages.</p>
          </div>
        )}

        {/* Revoked keys */}
        {revokedKeys.length > 0 && (
          <Collapsible open={revokedOpen} onOpenChange={setRevokedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-1 group">
              <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
              {revokedKeys.length} revoked key{revokedKeys.length > 1 ? "s" : ""}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-1">
                {revokedKeys.map((key: BotApiKey) => (
                  <div key={key.id} className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground/50">
                    <span className="text-sm line-through truncate">{key.name}</span>
                    <code className="text-[10px] font-mono">
                      {BOT_KEY_PREFIX}
                      {key.keyPrefix}...
                    </code>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>

      <Separator />

      {/* Channel access section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel Access</h4>
        </div>

        <p className="text-xs text-muted-foreground">
          Bots can access all public channels. Grant access to specific private channels below.
        </p>

        {/* Granted channels */}
        {grantedStreams.length > 0 && (
          <div className="rounded-md border divide-y">
            {grantedStreams.map((grant) => (
              <div key={grant.streamId} className="flex items-center justify-between px-3 py-2 group">
                <div className="flex items-center gap-2 min-w-0">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">{grant.slug ?? grant.displayName ?? grant.streamId}</span>
                </div>
                {!isArchived && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                    onClick={() => revokeStreamMutation.mutate(grant.streamId)}
                    disabled={revokeStreamMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {grantedStreams.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No private channel access granted.</p>
        )}

        {/* Add channel picker */}
        {!isArchived && (
          <div className="space-y-1.5">
            <Input
              placeholder="Search channels to grant access..."
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              className="h-8"
            />
            {availableChannels.length > 0 && (
              <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                {availableChannels.map((stream) => (
                  <button
                    key={stream.id}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                    onClick={() => grantStreamMutation.mutate(stream.id)}
                  >
                    <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{stream.slug ?? stream.displayName}</span>
                    <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                      {stream.visibility}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
            {channelSearch && availableChannels.length === 0 && (
              <p className="text-xs text-muted-foreground py-1">No matching channels</p>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* Danger zone */}
      <section className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Danger zone</h4>
        {isArchived ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
          >
            <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />
            {restoreMutation.isPending ? "Restoring..." : "Restore bot"}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setArchiveTarget(true)}>
            <Archive className="h-3.5 w-3.5 mr-1.5" />
            Archive bot
          </Button>
        )}
      </section>

      {/* Revoke key confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke <strong className="text-foreground">{revokeTarget?.name}</strong>. Any
              applications using this key will lose access immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeKeyMutation.mutate(revokeTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeKeyMutation.isPending ? "Revoking..." : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation */}
      <AlertDialog open={archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive bot</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <strong className="text-foreground">{bot.name}</strong> and revoke all its API keys.
              Existing messages from this bot will remain visible. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {archiveMutation.isPending ? "Archiving..." : "Archive bot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
