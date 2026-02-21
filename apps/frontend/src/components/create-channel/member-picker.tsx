import { useState, useMemo, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { SearchableList } from "@/components/ui/searchable-list"
import { renderMemberItem, type MemberItem } from "@/components/ui/member-list-item"
import { UserPlus, X } from "lucide-react"
import { workspaceKeys } from "@/hooks"
import { getInitials } from "@/lib/initials"
import { getAvatarColor } from "@/lib/avatar-color"
import type { WorkspaceBootstrap } from "@threa/types"

interface MemberPickerProps {
  workspaceId: string
  currentMemberId: string
  selectedMemberIds: string[]
  onChange: (memberIds: string[]) => void
}

export function MemberPicker({ workspaceId, currentMemberId, selectedMemberIds, onChange }: MemberPickerProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")

  // Cache-only observer for workspace bootstrap
  const { data: wsBootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const workspaceMembers = wsBootstrap?.users ?? wsBootstrap?.members ?? []
  const selectedSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds])

  // Members available to add: not current user, not already selected
  const availableToAdd = useMemo((): MemberItem[] => {
    if (!search) return []
    const q = search.toLowerCase()
    return workspaceMembers
      .filter(
        (m) =>
          m.id !== currentMemberId &&
          !selectedSet.has(m.id) &&
          (m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q))
      )
      .map((m) => ({
        id: m.id,
        label: m.name || m.slug,
        description: `@${m.slug}`,
        slug: m.slug,
        name: m.name,
      }))
  }, [workspaceMembers, currentMemberId, selectedSet, search])

  // Resolve selected member details for chips
  const selectedMembers = useMemo(() => {
    return selectedMemberIds
      .map((id) => workspaceMembers.find((m) => m.id === id))
      .filter(Boolean) as typeof workspaceMembers
  }, [selectedMemberIds, workspaceMembers])

  const handleSelect = useCallback(
    (item: MemberItem) => {
      onChange([...selectedMemberIds, item.id])
      setSearch("")
    },
    [selectedMemberIds, onChange]
  )

  const handleRemove = (memberId: string) => {
    onChange(selectedMemberIds.filter((id) => id !== memberId))
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Members</Label>
      <p className="text-xs text-muted-foreground -mt-1.5">You'll be added automatically as the creator</p>

      {/* Selected members as removable chips */}
      {selectedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedMembers.map((member) => {
            const initials = getInitials(member.name || member.slug)
            const color = getAvatarColor(member.id)

            return (
              <Badge key={member.id} variant="secondary" className="gap-1.5 pl-1 pr-1.5 py-0.5 text-xs font-medium">
                <span
                  className={`inline-flex items-center justify-center h-4.5 w-4.5 rounded-full text-[9px] font-semibold leading-none shrink-0 ${color}`}
                  style={{ width: 18, height: 18 }}
                >
                  {initials}
                </span>
                {member.name || member.slug}
                <button
                  type="button"
                  onClick={() => handleRemove(member.id)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5 -mr-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
        </div>
      )}

      {/* Searchable member list with keyboard navigation */}
      <SearchableList
        items={availableToAdd}
        renderItem={renderMemberItem}
        onSelect={handleSelect}
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by name or handle..."
        emptyMessage="No matching members"
        icon={UserPlus}
      />
    </div>
  )
}
