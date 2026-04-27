import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { StreamTypes, Visibilities, type StreamType } from "@threa/types"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useWorkspaceStreams, useWorkspaceStreamMemberships } from "@/stores/workspace-store"
import { getStreamName, streamFallbackLabel, STREAM_ICONS } from "@/lib/streams"
import { queueShareHandoff } from "@/stores/share-handoff-store"
import { navigateAfterShareHandoff } from "@/lib/share-navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import type { SharedMessageAttrs } from "@/components/editor/shared-message-extension"

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
 * Cross-stream picker for sharing a message as a pointer. Filters the
 * workspace's accessible top-level streams (channel / dm / scratchpad,
 * not archived) — same access semantics as backend `checkStreamAccess`.
 * On select, queues the share node for the target's composer via
 * `queueShareHandoff` and navigates; commentary + send happen in the
 * target's normal composer rather than a modal-owned editor.
 *
 * Renders through `ResponsiveDialog`, which routes to a centered Dialog
 * on desktop and a snap-pointed Drawer on mobile — same primitive the
 * quick-switcher (a sibling stream picker) uses, so the affordance stays
 * consistent.
 *
 * Privacy boundaries are enforced at send time: the backend rejects with
 * `SHARE_PRIVACY_CONFIRMATION_REQUIRED` and the queue surfaces a
 * "Share anyway / Cancel" toast (`surfacePrivacyBlockToast`).
 */
export function ShareMessageModal({ open, onOpenChange, workspaceId, attrs }: ShareMessageModalProps) {
  const [search, setSearch] = useState("")
  const navigate = useNavigate()
  const location = useLocation()
  const streams = useWorkspaceStreams(workspaceId)
  const memberships = useWorkspaceStreamMemberships(workspaceId)
  // The Drawer/Dialog split is owned by ResponsiveDialog; isMobile here only
  // governs the post-select navigation contract (mobile strips `?panel=…`).
  const isMobile = useIsMobile()

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
      const accessible = s.visibility === Visibilities.PUBLIC || memberStreamIds.has(s.id)
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

  // Wrap the parent's open-change so search resets on every close path
  // (Esc, backdrop, X, programmatic). Without this, dismissing without
  // selecting leaves the previous query in place when the modal reopens.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSearch("")
    onOpenChange(next)
  }

  const handleSelect = (targetStreamId: string) => {
    queueShareHandoff(targetStreamId, attrs)
    handleOpenChange(false)
    // Same navigation contract as the fast-path entries in
    // `message-event.tsx` — strip search params on mobile so the panel
    // doesn't shadow the parent composer, no-op when target === current.
    navigateAfterShareHandoff({ workspaceId, targetStreamId, location, navigate, isMobile })
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent
        className="overflow-hidden p-0"
        desktopClassName="sm:max-w-lg"
        // Mobile drawer keeps ResponsiveDialog's default 80%-snap full-height
        // shell; the `flex flex-col` lets the Command list claim the
        // remaining space below the header rather than overflowing.
        drawerClassName="flex flex-col"
      >
        <ResponsiveDialogHeader className="border-b px-4 py-3">
          <ResponsiveDialogTitle className="text-base">Share message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Pick a stream to insert this share into the composer.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
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
                    const Icon = STREAM_ICONS[stream.type]
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
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
