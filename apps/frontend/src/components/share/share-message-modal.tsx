import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Hash, MessageSquare, FileText } from "lucide-react"
import { StreamTypes, type StreamType } from "@threa/types"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useWorkspaceStreams, useWorkspaceStreamMemberships } from "@/stores/workspace-store"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { queueShareHandoff } from "@/stores/share-handoff-store"
import type { SharedMessageAttrs } from "@/components/editor/shared-message-extension"

const PICKER_ICONS: Record<StreamType, React.ComponentType<{ className?: string }>> = {
  [StreamTypes.SCRATCHPAD]: FileText,
  [StreamTypes.CHANNEL]: Hash,
  [StreamTypes.DM]: MessageSquare,
  [StreamTypes.THREAD]: MessageSquare,
  [StreamTypes.SYSTEM]: MessageSquare,
}

const TARGET_GROUPS: { id: "channel" | "dm" | "scratchpad"; heading: string; type: StreamType }[] = [
  { id: "channel", heading: "Channels", type: StreamTypes.CHANNEL },
  { id: "dm", heading: "Direct messages", type: StreamTypes.DM },
  { id: "scratchpad", heading: "Your scratchpads", type: StreamTypes.SCRATCHPAD },
]

interface ShareMessageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  attrs: SharedMessageAttrs
}

/**
 * Slice 2 share-to-anywhere picker. Reuses the pointer hand-off pattern from
 * Slice 1's share-to-parent: on select we queue the share node for the target
 * stream's composer (`queueShareHandoff`) and navigate. The user types optional
 * commentary in the target stream and sends via the normal send button — no
 * second editor surface is introduced (D-Alt-1 rejected).
 *
 * Privacy boundary handling lives in the message queue (`use-message-queue` →
 * `surfacePrivacyBlockToast`): when the backend rejects with
 * `SHARE_PRIVACY_CONFIRMATION_REQUIRED`, the queue surfaces a toast offering
 * "Share anyway" / "Cancel". Slice 3 lifts that into a step-2 confirm step
 * inside this modal, with a pre-flight `share-preview` endpoint.
 *
 * Filter rules:
 * - Top-level streams only (no threads, no system) — plan target scope.
 * - Streams the user can read: public visibility OR direct member. Same
 *   semantics as backend `checkStreamAccess`.
 * - Same-stream targets are allowed (D5): if the user picks the stream
 *   they're already viewing, the hand-off lands in the current composer.
 * - Archived streams are excluded — sharing into an archive feels like a
 *   gesture mismatch, and Slice 3 will revisit if users ask.
 */
export function ShareMessageModal({ open, onOpenChange, workspaceId, attrs }: ShareMessageModalProps) {
  const [search, setSearch] = useState("")
  const navigate = useNavigate()
  const streams = useWorkspaceStreams(workspaceId)
  const memberships = useWorkspaceStreamMemberships(workspaceId)

  const memberStreamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of memberships) ids.add(m.streamId)
    return ids
  }, [memberships])

  const streamsByGroup = useMemo(() => {
    const lower = search.toLowerCase()
    const matchable = streams.filter((s) => {
      if (s.archivedAt) return false
      if (s.rootStreamId) return false
      if (s.type === StreamTypes.THREAD || s.type === StreamTypes.SYSTEM) return false
      const accessible = s.visibility === "public" || memberStreamIds.has(s.id)
      if (!accessible) return false
      if (!lower) return true
      const name = (getStreamName(s) ?? streamFallbackLabel(s.type, "generic")).toLowerCase()
      return name.includes(lower)
    })
    const byType = new Map<StreamType, typeof matchable>()
    for (const s of matchable) {
      const list = byType.get(s.type) ?? []
      list.push(s)
      byType.set(s.type, list)
    }
    for (const [, list] of byType) {
      list.sort((a, b) => {
        const an = getStreamName(a) ?? streamFallbackLabel(a.type, "generic")
        const bn = getStreamName(b) ?? streamFallbackLabel(b.type, "generic")
        return an.localeCompare(bn)
      })
    }
    return byType
  }, [streams, memberStreamIds, search])

  const handleSelect = (targetStreamId: string) => {
    queueShareHandoff(targetStreamId, attrs)
    onOpenChange(false)
    setSearch("")
    navigate(`/w/${workspaceId}/s/${targetStreamId}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">Share message</DialogTitle>
          <DialogDescription>Pick a stream to insert this share into the composer.</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-none">
          <CommandInput placeholder="Search streams…" value={search} onValueChange={setSearch} className="border-b" />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>No matching streams.</CommandEmpty>
            {TARGET_GROUPS.map((group) => {
              const list = streamsByGroup.get(group.type)
              if (!list || list.length === 0) return null
              return (
                <CommandGroup key={group.id} heading={group.heading}>
                  {list.map((stream) => {
                    const Icon = PICKER_ICONS[stream.type]
                    const label = getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic")
                    return (
                      <CommandItem key={stream.id} value={stream.id} onSelect={() => handleSelect(stream.id)}>
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span>{label}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
