import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
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
import { ChannelSlugInput } from "./channel-slug-input"
import { useUpdateStream, useArchiveStream, useUnarchiveStream, useSetNotificationLevel } from "@/hooks"
import {
  StreamTypes,
  Visibilities,
  NOTIFICATION_CONFIG,
  type Stream,
  type StreamType,
  type NotificationLevel,
} from "@threa/types"
import { toast } from "sonner"

interface GeneralTabProps {
  workspaceId: string
  stream: Stream
  currentMemberId: string
  notificationLevel: NotificationLevel | null
}

export function GeneralTab({ workspaceId, stream, currentMemberId, notificationLevel }: GeneralTabProps) {
  const isChannel = stream.type === StreamTypes.CHANNEL
  const isScratchpad = stream.type === StreamTypes.SCRATCHPAD

  return (
    <div className="space-y-6 p-1">
      <NotificationSection
        workspaceId={workspaceId}
        streamId={stream.id}
        streamType={stream.type}
        notificationLevel={notificationLevel}
      />

      <Separator />

      {isChannel && <VisibilitySection workspaceId={workspaceId} stream={stream} />}
      {isScratchpad && <VisibilityDisplay />}

      <Separator />

      {isChannel && <SlugSection workspaceId={workspaceId} stream={stream} />}
      {isScratchpad && <DisplayNameSection workspaceId={workspaceId} stream={stream} />}

      {isChannel && (
        <>
          <Separator />
          <DescriptionSection workspaceId={workspaceId} stream={stream} />
        </>
      )}

      <Separator />
      <ArchiveSection workspaceId={workspaceId} stream={stream} currentMemberId={currentMemberId} />
    </div>
  )
}

const NOTIFICATION_OPTION_META: Record<string, { label: string; description: string }> = {
  default: { label: "Default", description: "Use workspace notification settings" },
  everything: { label: "Everything", description: "All messages and activity" },
  activity: { label: "Activity", description: "Mentions, reactions, and thread replies" },
  mentions: { label: "Mentions only", description: "Only when you're @mentioned" },
  muted: { label: "Muted", description: "No notifications from this stream" },
}

function NotificationSection({
  workspaceId,
  streamId,
  streamType,
  notificationLevel,
}: {
  workspaceId: string
  streamId: string
  streamType: StreamType
  notificationLevel: NotificationLevel | null
}) {
  const mutation = useSetNotificationLevel(workspaceId, streamId)
  const currentValue = notificationLevel ?? "default"
  const { allowedLevels, defaultLevel } = NOTIFICATION_CONFIG[streamType]
  const defaultMeta = NOTIFICATION_OPTION_META[defaultLevel]
  const defaultDescription = defaultMeta
    ? `Use stream default (${defaultMeta.label.toLowerCase()})`
    : "Use stream default"

  const handleChange = (value: string) => {
    const level = value === "default" ? null : (value as NotificationLevel)
    mutation.mutate(level, {
      onSuccess: () => toast.success("Notification preference updated"),
      onError: () => toast.error("Failed to update notification preference"),
    })
  }

  const options = [
    { value: "default", label: "Default", description: defaultDescription },
    ...allowedLevels.map((level) => ({
      value: level,
      ...NOTIFICATION_OPTION_META[level],
    })),
  ]

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Notifications</Label>
      <Select value={currentValue} onValueChange={handleChange} disabled={mutation.isPending}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="font-medium">{opt.label}</span>
              <span className="text-muted-foreground ml-2 text-xs">{opt.description}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function VisibilitySection({ workspaceId, stream }: { workspaceId: string; stream: Stream }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<"public" | "private" | null>(null)
  const updateMutation = useUpdateStream(workspaceId, stream.id)

  const handleVisibilityChange = (value: string) => {
    if (value === stream.visibility) return
    setPendingVisibility(value as "public" | "private")
    setConfirmOpen(true)
  }

  const handleConfirm = () => {
    if (!pendingVisibility) return
    updateMutation.mutate(
      { visibility: pendingVisibility },
      {
        onSuccess: () => toast.success("Visibility updated"),
        onError: () => toast.error("Failed to update visibility"),
      }
    )
    setConfirmOpen(false)
    setPendingVisibility(null)
  }

  const handleCancel = () => {
    setConfirmOpen(false)
    setPendingVisibility(null)
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Visibility</Label>
      <RadioGroup value={stream.visibility} onValueChange={handleVisibilityChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value={Visibilities.PUBLIC} id="vis-public" />
          <Label htmlFor="vis-public" className="font-normal">
            Public — visible to all workspace members
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value={Visibilities.PRIVATE} id="vis-private" />
          <Label htmlFor="vis-private" className="font-normal">
            Private — only visible to members
          </Label>
        </div>
      </RadioGroup>

      <AlertDialog open={confirmOpen} onOpenChange={handleCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change visibility?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVisibility === Visibilities.PRIVATE
                ? "Making this channel private will hide it from non-members. They won't be able to find or join it."
                : "Making this channel public will make it visible to all workspace members. Anyone will be able to join."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function VisibilityDisplay() {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Visibility</Label>
      <RadioGroup value="private" disabled>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="private" id="vis-private-disabled" />
          <Label htmlFor="vis-private-disabled" className="font-normal text-muted-foreground">
            Private — scratchpads are always private
          </Label>
        </div>
      </RadioGroup>
    </div>
  )
}

function SlugSection({ workspaceId, stream }: { workspaceId: string; stream: Stream }) {
  const [slug, setSlug] = useState(stream.slug ?? "")
  const [isValid, setIsValid] = useState(true)
  const updateMutation = useUpdateStream(workspaceId, stream.id)
  const hasChanged = slug !== (stream.slug ?? "")

  const handleSave = () => {
    if (!isValid || !hasChanged) return
    updateMutation.mutate(
      { slug },
      {
        onSuccess: () => toast.success("Channel slug updated"),
        onError: () => toast.error("Failed to update slug"),
      }
    )
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Channel name</Label>
      <ChannelSlugInput
        workspaceId={workspaceId}
        streamId={stream.id}
        currentSlug={stream.slug ?? ""}
        value={slug}
        onChange={setSlug}
        onValidityChange={setIsValid}
      />
      {hasChanged && (
        <Button size="sm" onClick={handleSave} disabled={!isValid || updateMutation.isPending}>
          {updateMutation.isPending ? "Saving..." : "Save"}
        </Button>
      )}
    </div>
  )
}

function DisplayNameSection({ workspaceId, stream }: { workspaceId: string; stream: Stream }) {
  const [name, setName] = useState(stream.displayName ?? "")
  const updateMutation = useUpdateStream(workspaceId, stream.id)
  const hasChanged = name !== (stream.displayName ?? "")

  const handleSave = () => {
    if (!name.trim() || !hasChanged) return
    updateMutation.mutate(
      { displayName: name.trim() },
      {
        onSuccess: () => toast.success("Name updated"),
        onError: () => toast.error("Failed to update name"),
      }
    )
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Display name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scratchpad name" maxLength={100} />
      {hasChanged && (
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || updateMutation.isPending}>
          {updateMutation.isPending ? "Saving..." : "Save"}
        </Button>
      )}
    </div>
  )
}

function DescriptionSection({ workspaceId, stream }: { workspaceId: string; stream: Stream }) {
  const [description, setDescription] = useState(stream.description ?? "")
  const updateMutation = useUpdateStream(workspaceId, stream.id)
  const hasChanged = description !== (stream.description ?? "")

  const handleSave = () => {
    if (!hasChanged) return
    updateMutation.mutate(
      { description },
      {
        onSuccess: () => toast.success("Description updated"),
        onError: () => toast.error("Failed to update description"),
      }
    )
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Description</Label>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is this channel about?"
        maxLength={500}
        rows={3}
      />
      <div className="flex items-center justify-between">
        {hasChanged && (
          <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{description.length}/500</span>
      </div>
    </div>
  )
}

function ArchiveSection({
  workspaceId,
  stream,
  currentMemberId,
}: {
  workspaceId: string
  stream: Stream
  currentMemberId: string
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const archiveMutation = useArchiveStream(workspaceId)
  const unarchiveMutation = useUnarchiveStream(workspaceId)
  const isCreator = stream.createdBy === currentMemberId
  const isArchived = stream.archivedAt !== null

  if (!isCreator) return null

  const handleAction = () => {
    if (isArchived) {
      unarchiveMutation.mutate(stream.id, {
        onSuccess: () => toast.success("Stream unarchived"),
        onError: () => toast.error("Failed to unarchive"),
      })
    } else {
      archiveMutation.mutate(stream.id, {
        onSuccess: () => toast.success("Stream archived"),
        onError: () => toast.error("Failed to archive"),
      })
    }
    setConfirmOpen(false)
  }

  const streamName = stream.slug ? `#${stream.slug}` : (stream.displayName ?? "this stream")

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium text-muted-foreground">Danger zone</Label>
      <div className="rounded-lg border border-destructive/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{isArchived ? "Unarchive" : "Archive"} stream</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isArchived
                ? "Restore this stream to the sidebar for all members."
                : "Hide this stream from the sidebar. You can unarchive it later."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={() => setConfirmOpen(true)}
          >
            {isArchived ? "Unarchive" : "Archive"}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isArchived ? "Unarchive" : "Archive"} {streamName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isArchived
                ? "This stream will be visible in the sidebar again."
                : "This stream will be hidden from the sidebar. You can unarchive it later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction}>{isArchived ? "Unarchive" : "Archive"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
