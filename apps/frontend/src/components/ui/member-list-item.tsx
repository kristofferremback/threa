import { getInitials } from "@/lib/initials"
import { getAvatarColor } from "@/lib/avatar-color"
import type { SearchableListItem } from "./searchable-list"

export interface MemberItem extends SearchableListItem {
  slug: string
  name: string
}

export function MemberListItem({ item }: { item: MemberItem }) {
  const initials = getInitials(item.name || item.slug)
  const color = getAvatarColor(item.id)

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2">
      <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium shrink-0 ${color}`}>
        {initials}
      </div>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{item.label}</span>
        <span className="text-xs text-muted-foreground truncate">{item.description}</span>
      </div>
    </div>
  )
}

export function renderMemberItem(item: MemberItem, _highlighted: boolean) {
  return <MemberListItem item={item} />
}
